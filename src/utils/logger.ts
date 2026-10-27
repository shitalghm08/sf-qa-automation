import * as fs from 'fs';
import * as path from 'path';
import { env } from '../config/env';
import { runName } from './runInfo';

type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const logDir = path.resolve(__dirname, '../../logs');
// one file per run, named like the run's folder in runs/ (see runInfo.ts); run.log if there is no run id
export const logFile = path.join(logDir, process.env.RUN_STARTED ? `${runName()}.log` : 'run.log');
let dirReady = false;

function ensureDir() {
  if (dirReady) return;
  fs.mkdirSync(logDir, { recursive: true });
  dirReady = true;
}

let formatter: Intl.DateTimeFormat | undefined;

/** 2026-10-27 16:42:41.642+08:00 in the LOG_TZ zone (this machine's by default), so the offset is explicit */
function timestamp(date: Date): string {
  if (!formatter) {
    const options: Intl.DateTimeFormatOptions = {
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      timeZoneName: 'longOffset',
    };
    const zone = env.logTimeZone;
    try {
      formatter = new Intl.DateTimeFormat('en-GB', zone.toLowerCase() === 'local' ? options : { ...options, timeZone: zone });
    } catch {
      // an unknown zone in LOG_TZ must not break the run, fall back to this machine's zone
      formatter = new Intl.DateTimeFormat('en-GB', options);
    }
  }
  const part = (type: string) => formatter!.formatToParts(date).find((p) => p.type === type)?.value ?? '';
  const offset = part('timeZoneName').replace('GMT', '') || '+00:00';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}.${part('fractionalSecond')}${offset}`;
}

function write(level: Level, scope: string, msg: string, extra?: unknown) {
  if (order[level] < order[env.logLevel as Level] && env.logLevel in order) return;

  const worker = process.env.TEST_WORKER_INDEX ?? '-';
  const ts = timestamp(new Date());
  const tail = extra === undefined ? '' : ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra));
  const line = `${ts} [w${worker}] ${level.toUpperCase().padEnd(5)} ${scope}: ${msg}${tail}`;

  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : console.log)(line);
  try {
    ensureDir();
    fs.appendFileSync(logFile, line + '\n');
  } catch {
    // logging must never fail a test
  }
}

export function getLogger(scope: string) {
  return {
    debug: (m: string, x?: unknown) => write('debug', scope, m, x),
    info: (m: string, x?: unknown) => write('info', scope, m, x),
    warn: (m: string, x?: unknown) => write('warn', scope, m, x),
    error: (m: string, x?: unknown) => write('error', scope, m, x),
  };
}

export type Logger = ReturnType<typeof getLogger>;

/** keep secrets out of logs: 123456 -> 12**56 */
export function mask(value: string, keep = 2): string {
  if (value.length <= keep * 2) return '*'.repeat(value.length);
  return value.slice(0, keep) + '*'.repeat(value.length - keep * 2) + value.slice(-keep);
}

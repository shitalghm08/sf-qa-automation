import * as fs from 'fs';
import * as path from 'path';
import { env } from '../config/env';

type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const logDir = path.resolve(__dirname, '../../logs');
const logFile = path.join(logDir, 'run.log');
let dirReady = false;

function ensureDir() {
  if (dirReady) return;
  fs.mkdirSync(logDir, { recursive: true });
  dirReady = true;
}

function write(level: Level, scope: string, msg: string, extra?: unknown) {
  if (order[level] < order[env.logLevel as Level] && env.logLevel in order) return;

  const worker = process.env.TEST_WORKER_INDEX ?? '-';
  const ts = new Date().toISOString();
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

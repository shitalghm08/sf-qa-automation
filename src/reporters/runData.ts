import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';
import { logFile } from '../utils/logger';
import { runName, runStartedAt } from '../utils/runInfo';

/**
 * Keeps every run. Playwright empties test-results/ and rewrites playwright-report/ at the start of
 * each run, so on their own they only ever show the latest one. This reporter archives a copy of both,
 * plus the data the tests used, into one folder per run (gitignored, like the other output):
 *
 *   runs/<start time>_seed<seed>/
 *     test-data.json       what each test used and created (the ids, the lead data)
 *     playwright-report/   the HTML report of that run    open: npx playwright show-report runs/<run>/playwright-report
 *     test-results/        screenshots, videos, traces, junit.xml, report.json of that run
 *     run.log              the timestamped log lines of that run (a copy of logs/<run>.log)
 *   runs/index.csv         one line per run, to find the one you want
 *
 * The usual locations (test-results/, playwright-report/, --last-failed, npm run report) are untouched
 * and keep showing the latest run.
 *
 * What goes into test-data.json for a test is whatever it attached under one of the names in KEEP (the lead
 * data it typed in, the ids it ended up with), plus its annotations. The convert request / response are left
 * out on purpose: they are large and are in the HTML report.
 */
const KEEP = new Set(['lead-data.json', 'converted-ids.json', 'convert-json-paths.json', 'shared-ids.json']);

interface Entry {
  project: string;
  file: string;
  test: string;
  status: TestResult['status'];
  retry: number;
  durationMs: number;
  annotations: Array<{ type: string; description?: string }>;
  data: Record<string, unknown>;
  error?: string;
}

export default class RunDataReporter implements Reporter {
  private config!: FullConfig;
  private readonly startedAt = runStartedAt();
  private readonly entries: Entry[] = [];
  private runDir?: string;

  onBegin(config: FullConfig): void {
    this.config = config;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const data: Record<string, unknown> = {};
    for (const attachment of result.attachments) {
      if (!KEEP.has(attachment.name) || !attachment.body) continue;
      try {
        data[attachment.name.replace(/\.json$/, '')] = JSON.parse(attachment.body.toString('utf8'));
      } catch {
        // not json, nothing worth keeping
      }
    }

    this.entries.push({
      project: test.parent.project()?.name ?? '',
      file: path.basename(test.location.file),
      // titlePath() starts with '', the project and the file
      test: test.titlePath().slice(3).join(' > '),
      status: result.status,
      retry: result.retry,
      durationMs: result.duration,
      annotations: test.annotations.map((a) => ({ type: a.type, description: a.description })),
      data,
      error: result.error?.message?.split('\n').find((l) => l.trim()),
    });
  }

  onEnd(result: FullResult): void {
    // --list and other runs that executed nothing have nothing to record
    if (process.argv.includes('--list') || this.entries.length === 0) return;

    const seed = process.env.TEST_SEED ?? 'none';
    const finishedAt = new Date();
    const count = (status: string) => this.entries.filter((e) => e.status === status).length;
    const totals = {
      passed: count('passed'),
      failed: count('failed') + count('timedOut'),
      skipped: count('skipped'),
      interrupted: count('interrupted'),
    };

    // config.rootDir is the tests folder, the runs live next to the config file
    const projectDir = this.config.configFile ? path.dirname(this.config.configFile) : process.cwd();
    const runsDir = path.join(projectDir, 'runs');
    const name = runName();
    this.runDir = path.join(runsDir, name);
    fs.mkdirSync(this.runDir, { recursive: true });

    fs.writeFileSync(
      path.join(this.runDir, 'test-data.json'),
      JSON.stringify(
        {
          run: {
            startedAt: this.startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - this.startedAt.getTime(),
            status: result.status,
            seed,
            workers: this.config.workers,
            projects: [...new Set(this.entries.map((e) => e.project))],
            arguments: process.argv.slice(2).join(' '),
          },
          totals,
          tests: this.entries,
        },
        null,
        2,
      ),
    );

    const index = path.join(runsDir, 'index.csv');
    // the note column stays empty for a complete archive; it is for runs that could only be kept in part
    if (!fs.existsSync(index)) fs.writeFileSync(index, 'started,seed,status,passed,failed,skipped,folder,note\n');
    fs.appendFileSync(
      index,
      `${this.startedAt.toISOString()},${seed},${result.status},${totals.passed},${totals.failed},${totals.skipped},${name},\n`,
    );
  }

  /**
   * onExit runs after every reporter has finished its onEnd, so the HTML report and junit.xml are
   * complete by now and can be copied. A failure to copy must never fail the run.
   */
  async onExit(): Promise<void> {
    if (!this.runDir) return;
    const projectDir = this.config.configFile ? path.dirname(this.config.configFile) : process.cwd();
    const sources: Array<[string, string]> = [
      [path.join(projectDir, 'playwright-report'), 'playwright-report'],
      [this.config.projects[0]?.outputDir ?? path.join(projectDir, 'test-results'), 'test-results'],
    ];

    for (const [from, name] of sources) {
      try {
        if (fs.existsSync(from)) fs.cpSync(from, path.join(this.runDir, name), { recursive: true });
      } catch (err) {
        console.warn(`Run archive: could not copy ${name}: ${(err as Error).message}`);
      }
    }
    try {
      if (fs.existsSync(logFile)) fs.copyFileSync(logFile, path.join(this.runDir, 'run.log'));
    } catch (err) {
      console.warn(`Run archive: could not copy the log: ${(err as Error).message}`);
    }
    console.log(`Run archived: runs/${path.basename(this.runDir)}`);
  }

  printsToStdio(): boolean {
    return false;
  }
}

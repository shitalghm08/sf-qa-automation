/**
 * What identifies one run. playwright.config.ts sets RUN_STARTED once in the main process and the workers
 * inherit it, so the logger (in the workers) and the archive reporter (in the main process) agree on the
 * name: logs/<run name>.log and runs/<run name>/.
 */
export function runStartedAt(): Date {
  const fromEnv = process.env.RUN_STARTED;
  const parsed = fromEnv ? new Date(fromEnv) : undefined;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
}

/** e.g. 2026-10-27T00-42-37-021Z_seed1008430437 (start time in UTC, then the random data seed) */
export function runName(): string {
  const stamp = runStartedAt().toISOString().replace(/[:.]/g, '-');
  return `${stamp}_seed${process.env.TEST_SEED ?? 'none'}`;
}

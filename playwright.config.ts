import { defineConfig, devices } from '@playwright/test';
import './src/config/env'; // side effect: loads .env
import { storageStatePath } from './src/config/env';

// One seed for the whole run, shared with the workers through the environment, so the random test data
// can be replayed: TEST_SEED=<number> npx playwright test ...  (see README, "Replaying a run")
if (!process.env.TEST_SEED) process.env.TEST_SEED = String(Math.floor(Math.random() * 2 ** 31));
if (!process.env.TEST_WORKER_INDEX) console.log(`TEST_SEED=${process.env.TEST_SEED}`);

const isCI = !!process.env.CI;

// What to keep for each test. The default keeps a screenshot, a video and a trace for passing tests as
// well as failing ones, so every run can be looked at afterwards. ARTIFACTS=failures keeps only what a
// failure needs, which is faster and much smaller (use it for quick local runs).
const keepAll = (process.env.ARTIFACTS ?? 'all') !== 'failures';
const baseURL = (process.env.SF_LIGHTNING_URL ?? 'https://set-SF_LIGHTNING_URL-in-env.invalid').replace(/\/+$/, '');

// tests that should never run as part of the normal authenticated projects
const specialSpecs = [/auth\.setup\.ts/, /shared-data\.setup\.ts/, /fresh-login\.spec\.ts/, /signup\.spec\.ts/, /unit[\\/]/];

// lightning collapses buttons into overflow menus on narrow screens, so keep a desktop viewport
const desktop = { viewport: { width: 1440, height: 900 } };

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : 3,

  // salesforce is slow on cold orgs, so generous but bounded
  timeout: 120_000,
  expect: { timeout: 15_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/report.json' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    // one file per run in logs/runs/, so the data of earlier runs survives the next run
    ['./src/reporters/runData.ts'],
  ],

  use: {
    baseURL,
    locale: 'en-US',
    timezoneId: 'Asia/Singapore',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    trace: keepAll ? 'on' : 'on-first-retry',
    screenshot: keepAll ? 'on' : 'only-on-failure',
    video: keepAll ? 'on' : 'retain-on-failure',
  },

  projects: [
    // --- offline unit tests for the helpers (no browser, no org) ---
    {
      name: 'unit',
      testMatch: /unit[\\/].*\.spec\.ts/,
    },

    // --- session bootstrap, one per engine (cookies are cheap to get, but kept separate on purpose) ---
    {
      name: 'setup-chromium',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], ...desktop },
    },
    {
      name: 'setup-webkit',
      // chained on purpose: two logins at the same time would both ask for a code and
      // the mailbox reader could hand one browser the other browser's code
      dependencies: ['setup-chromium'],
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Safari'], ...desktop },
    },

    // the Account / Contact that the "already exists" conversion scenarios link to, created once and kept
    {
      name: 'seed-shared',
      dependencies: ['setup-chromium'],
      testMatch: /shared-data\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], ...desktop, storageState: storageStatePath('chromium') },
    },

    // --- the real suite ---
    {
      name: 'chromium',
      dependencies: ['setup-chromium', 'seed-shared'],
      testIgnore: specialSpecs,
      use: { ...devices['Desktop Chrome'], ...desktop, storageState: storageStatePath('chromium') },
    },
    {
      // webkit only runs what's tagged @smoke
      name: 'webkit-smoke',
      dependencies: ['setup-webkit'],
      grep: /@smoke/,
      testIgnore: specialSpecs,
      // lightning modals render noticeably slower in webkit (a click on "New" was still in progress
      // after 15 s while the modal was opening), so give it more room than chromium
      expect: { timeout: 30_000 },
      use: {
        ...devices['Desktop Safari'],
        ...desktop,
        storageState: storageStatePath('webkit'),
        actionTimeout: 30_000,
      },
    },

    // --- opt-in projects, not part of a plain `npx playwright test` unless asked for by name ---
    {
      // proves the full login + email code path with no cached session
      name: 'fresh-login',
      testMatch: /fresh-login\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], ...desktop },
    },
    {
      name: 'signup',
      testMatch: /signup\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], ...desktop },
    },
  ],
});

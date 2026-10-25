import { defineConfig, devices } from '@playwright/test';
import './src/config/env'; // side effect: loads .env
import { storageStatePath } from './src/config/env';

const isCI = !!process.env.CI;
const baseURL = (process.env.SF_LIGHTNING_URL ?? 'https://set-SF_LIGHTNING_URL-in-env.invalid').replace(/\/+$/, '');

// tests that should never run as part of the normal authenticated projects
const specialSpecs = [/auth\.setup\.ts/, /fresh-login\.spec\.ts/, /signup\.spec\.ts/];

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
  ],

  use: {
    baseURL,
    locale: 'en-US',
    timezoneId: 'Asia/Singapore',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
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

    // --- the real suite ---
    {
      name: 'chromium',
      dependencies: ['setup-chromium'],
      testIgnore: specialSpecs,
      use: { ...devices['Desktop Chrome'], ...desktop, storageState: storageStatePath('chromium') },
    },
    {
      // webkit only runs what's tagged @smoke
      name: 'webkit-smoke',
      dependencies: ['setup-webkit'],
      grep: /@smoke/,
      testIgnore: specialSpecs,
      use: { ...devices['Desktop Safari'], ...desktop, storageState: storageStatePath('webkit') },
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

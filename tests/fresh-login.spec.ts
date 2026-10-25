import { expect, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { env } from '../src/config/env';
import { HomePage } from '../src/pages/HomePage';
import { LoginPage } from '../src/pages/LoginPage';

/**
 * Exercises the whole login path with an empty browser: credentials -> (email code) -> home -> cache.
 * Kept out of the normal run because every fresh browser makes salesforce send a code, and two of
 * these racing each other would fight over the same mailbox. Run it on its own:  npm run test:fresh-login
 */
test.skip(!process.env.RUN_FRESH_LOGIN, 'opt-in: use `npm run test:fresh-login`');

test('fresh browser login (with email verification when asked) and session reuse', async ({ page, browser }, testInfo) => {
  const stateFile = path.resolve(__dirname, '../auth/state.fresh-login.json');

  const result = await test.step('log in from scratch', async () => {
    return new LoginPage(page).login();
  });
  testInfo.annotations.push({
    type: 'email-verification',
    description: result.usedVerification ? 'code fetched from mailbox' : 'not requested by salesforce',
  });

  await test.step('cache the session', async () => {
    await page.context().storageState({ path: stateFile });
    expect(fs.existsSync(stateFile)).toBeTruthy();
  });

  await test.step('a second browser context reuses the cache without any verification', async () => {
    const reused = await browser.newContext({ baseURL: env.lightningUrl, storageState: stateFile });
    try {
      const p = await reused.newPage();
      const home = new HomePage(p);
      await home.goto();
      await home.expectLoggedIn();
    } finally {
      await reused.close();
    }
  });
});

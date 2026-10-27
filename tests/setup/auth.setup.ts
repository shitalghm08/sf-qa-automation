import { Browser, expect, test as setup, TestInfo } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { env, storageStatePath } from '../../src/config/env';
import { LoginPage } from '../../src/pages/LoginPage';
import { getLogger } from '../../src/utils/logger';

const log = getLogger('auth.setup');

// A trace records what is typed and the request bodies, which would put the password in it
setup.use({ trace: 'off' });

/**
 * Is the cached session still usable?  Checked by actually opening the org with
 * it - file age alone proves nothing (password reset, admin killed the session,
 * org policy changed...). Anything doubtful returns false and we log in again.
 */
async function cachedSessionWorks(browser: Browser, file: string, info: TestInfo): Promise<boolean> {
  if (!fs.existsSync(file)) {
    log.info('no cached session yet');
    return false;
  }

  const ageHours = (Date.now() - fs.statSync(file).mtimeMs) / 3_600_000;
  if (ageHours > env.sessionMaxAgeHours) {
    log.info(`cached session is ${ageHours.toFixed(1)}h old (limit ${env.sessionMaxAgeHours}h), discarding`);
    return false;
  }

  const { userAgent, viewport, locale, timezoneId } = info.project.use;
  const context = await browser.newContext({
    baseURL: env.lightningUrl,
    storageState: file,
    userAgent,
    viewport,
    locale,
    timezoneId,
  });

  try {
    const page = await context.newPage();
    await page.goto('/lightning/page/home', { waitUntil: 'domcontentloaded' });
    // if the session is dead we get bounced to the login / verification page and this never shows
    await expect(page.getByRole('button', { name: 'App Launcher' })).toBeVisible({ timeout: 25_000 });
    log.info(`cached session is still valid (${ageHours.toFixed(1)}h old), skipping login`);
    return true;
  } catch {
    log.warn('cached session did not get us into lightning, will log in again');
    return false;
  } finally {
    await context.close();
  }
}

setup('authenticate and cache session', async ({ page, browser }, testInfo) => {
  // setup-chromium -> chromium, setup-webkit -> webkit
  const engine = testInfo.project.name.replace('setup-', '');
  const file = storageStatePath(engine);

  if (await cachedSessionWorks(browser, file, testInfo)) return;

  const { usedVerification } = await new LoginPage(page).login();
  testInfo.annotations.push({ type: 'email-verification', description: usedVerification ? 'required' : 'skipped' });

  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.context().storageState({ path: file });
  log.info(`session cached at auth/${path.basename(file)}`);
});

import { expect, test } from '@playwright/test';
import { HomePage } from '../src/pages/HomePage';

// storageState comes from the project config (auth.setup.ts has already run by now)
test.describe('Part A - login with cached session', () => {
  test('lands on lightning home with app launcher and global search @smoke', async ({ page }) => {
    const home = new HomePage(page);

    await test.step('open the org home page using the cached session', async () => {
      await home.goto();
    });

    await test.step('header controls prove we are logged in', async () => {
      await home.expectLoggedIn();
    });

    await test.step('we were not bounced to a login / verification screen', async () => {
      await expect(page).toHaveURL(/lightning\.force\.com|\.my\.salesforce\.com/);
      await expect(page).not.toHaveURL(/login|verification/i);
    });
  });
});

import { expect, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class HomePage extends BasePage {
  get appLauncher(): Locator {
    return this.page.getByRole('button', { name: 'App Launcher' });
  }

  /**
   * The global search is a button that *looks* like an input in current releases,
   * and a real <input> in older ones. Accept either.
   */
  get globalSearch(): Locator {
    return this.page
      .getByRole('button', { name: /^search/i })
      .or(this.page.getByPlaceholder(/^search/i))
      .first();
  }

  get currentAppName(): Locator {
    return this.page.locator('one-appnav').locator('.appName, .slds-context-bar__app-name').first();
  }

  async goto(): Promise<void> {
    await this.open('/lightning/page/home');
  }

  /** Part A.4 - logged in means the lightning shell rendered the header controls */
  async expectLoggedIn(): Promise<void> {
    await expect(this.appLauncher, 'App Launcher icon should be visible after login').toBeVisible({ timeout: 30_000 });
    await expect.soft(this.globalSearch, 'global search bar should be visible after login').toBeVisible();
  }

  async openApp(appName: string): Promise<void> {
    if (await this.isInApp(appName)) {
      this.log.info(`already in the ${appName} app`);
      return;
    }

    this.log.info(`opening ${appName} from the app launcher`);
    await this.appLauncher.click();

    const search = this.page.getByPlaceholder(/search apps and items/i);
    await search.fill(appName);

    // data-label is set on the launcher tiles; role+name is the fallback if that ever changes
    const tile = this.page
      .locator(`one-app-launcher-menu-item a[data-label="${appName}"]`)
      .or(this.page.getByRole('link', { name: appName, exact: true }))
      .first();

    try {
      await tile.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
      const labels = await this.page.locator('one-app-launcher-menu-item a[data-label]').evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-label')),
      );
      throw new Error(
        `App "${appName}" not found in the App Launcher. Visible apps: ${labels.join(', ') || '(none)'}. ` +
          'Check SF_SALES_APP_NAME in .env.',
      );
    }
    await tile.click();

    await this.waitForLightningIdle();
    await expect(this.currentAppName).toHaveText(appName, { timeout: 30_000 });
  }

  private async isInApp(appName: string): Promise<boolean> {
    const name = await this.currentAppName.textContent({ timeout: 5_000 }).catch(() => null);
    return name?.trim() === appName;
  }
}

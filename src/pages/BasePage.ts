import { expect, Locator, Page } from '@playwright/test';
import { getLogger, Logger } from '../utils/logger';

/** escape user supplied text before dropping it into a RegExp */
export function esc(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** accessible names of required lightning inputs look like "*Last Name", hence the optional star */
export function exactLabel(label: string): RegExp {
  return new RegExp(`^\\*?\\s*${esc(label)}\\s*$`, 'i');
}

/** picklist buttons sometimes carry the current value in their name ("Lead Source --None--") */
export function looseLabel(label: string): RegExp {
  return new RegExp(esc(label), 'i');
}

export abstract class BasePage {
  protected readonly log: Logger;

  constructor(protected readonly page: Page) {
    this.log = getLogger(this.constructor.name);
  }

  /** go somewhere inside the org using a path relative to baseURL */
  async open(path: string): Promise<void> {
    this.log.debug(`goto ${path}`);
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    await this.waitForLightningIdle();
  }

  /**
   * Lightning has no single "page loaded" event. What I can rely on is that the
   * blocking spinners are gone, so wait on that instead of sleeping.
   */
  async waitForLightningIdle(): Promise<void> {
    const spinners = this.page.locator('lightning-spinner:visible, .slds-spinner_container:visible');
    await expect(spinners).toHaveCount(0, { timeout: 30_000 });
  }

  /** toast with some text, e.g. 'was created' */
  toast(text: string | RegExp): Locator {
    return this.page.locator('[role="alert"], [role="status"], .toastMessage, .slds-notify_toast').filter({ hasText: text }).first();
  }

  /**
   * Highlight-panel buttons collapse into a "Show more actions" menu depending on
   * viewport and layout. Try the button first, then fall back to the overflow menu.
   */
  async clickRecordAction(name: string): Promise<void> {
    const direct = this.page.getByRole('button', { name, exact: true });
    const directLink = this.page.getByRole('link', { name, exact: true });
    const visibleDirect = direct.or(directLink).first();

    if (await visibleDirect.isVisible().catch(() => false)) {
      await visibleDirect.click();
      return;
    }

    this.log.debug(`"${name}" not visible on the highlights panel, trying overflow menu`);
    await this.page.getByRole('button', { name: /show more actions/i }).first().click();
    await this.page.getByRole('menuitem', { name, exact: true }).click();
  }

  /** pull the 18 char record id out of /lightning/r/<Object>/<id>/view */
  async recordIdFromUrl(objectApiName: string, idPrefix: string): Promise<string> {
    const re = new RegExp(`/lightning/r/${objectApiName}/(${idPrefix}[A-Za-z0-9]{15})/view`);
    await this.page.waitForURL(re, { timeout: 30_000 });
    const m = this.page.url().match(re);
    if (!m) throw new Error(`Could not read ${objectApiName} id from url ${this.page.url()}`);
    return m[1];
  }
}

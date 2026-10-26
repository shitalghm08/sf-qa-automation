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

  /** open the record's Details tab: that is where the fields are rendered on a default record page */
  async openDetailsTab(): Promise<void> {
    const tab = this.page.getByRole('tab', { name: 'Details', exact: true });
    if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
    await this.waitForLightningIdle();
    await this.logFieldHooks();
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
    const visibleDirect = direct.or(directLink).filter({ visible: true }).first();
    const overflow = this.page.getByRole('button', { name: /show more actions/i }).filter({ visible: true }).first();

    // isVisible() doesn't wait, so let the panel render first or a late button looks like it's in the menu
    await expect(
      visibleDirect.or(overflow).first(),
      `expected "${name}" or the "Show more actions" menu on the highlights panel`,
    ).toBeVisible({ timeout: 30_000 });

    if (await visibleDirect.isVisible()) {
      await visibleDirect.click();
      return;
    }

    this.log.debug(`"${name}" not visible on the highlights panel, trying overflow menu`);
    // a record page that is still refreshing (right after a save, for instance) closes an open menu,
    // so let it settle first and then retry open + click as one unit instead of opening it only once
    await this.waitForLightningIdle();

    const item = this.page.getByRole('menuitem', { name, exact: true });
    try {
      await expect(async () => {
        // clicking the trigger of an open menu closes it, so only click it while it is closed
        if ((await overflow.getAttribute('aria-expanded')) !== 'true') await overflow.click();
        await item.click({ timeout: 4_000 });
      }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });
    } catch (err) {
      const available = await this.page.getByRole('menuitem').allInnerTexts().catch(() => [] as string[]);
      throw new Error(
        `Record action "${name}" not found. Overflow menu has: [${available
          .map((t) => t.trim())
          .filter(Boolean)
          .join(' | ')}]. Original error: ${(err as Error).message}`,
      );
    }
  }

  /**
   * A field on a record page (detail view). Primary hook is the field api name that
   * lightning stamps on the wrapper (data-target-selection-name="sfdc:RecordField.Lead.Company"),
   * which survives layout changes and translations. The label attribute is the fallback.
   */
  recordField(objectApiName: string, apiNames: string[], label: string): Locator {
    const byApi = apiNames
      .map((a) => `[data-target-selection-name="sfdc:RecordField.${objectApiName}.${a}"]`)
      .join(', ');
    const byLabel = `records-record-layout-item[field-label="${label}"]`;
    return this.page.locator(`${byApi}, ${byLabel}`).filter({ visible: true }).first();
  }

  /**
   * Debug aid for the first live run: logs the field hooks lightning actually rendered,
   * so a wrong api name (OwnerId vs Owner, ...) is visible without opening devtools.
   */
  protected async logFieldHooks(): Promise<void> {
    const hooks = await this.page
      .locator('[data-target-selection-name]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-target-selection-name')))
      .catch(() => [] as (string | null)[]);
    this.log.debug('field hooks on the page', { hooks: [...new Set(hooks)].filter(Boolean) });
  }

  /** the modal that is currently on top */
  activeDialog(): Locator {
    return this.page.getByRole('dialog').filter({ visible: true }).last();
  }

  /** pull the 18 char record id out of /lightning/r/<Object>/<id>/view (some orgs leave the object out) */
  async recordIdFromUrl(objectApiName: string, idPrefix: string): Promise<string> {
    const re = new RegExp(`/lightning/r/(?:${objectApiName}/)?(${idPrefix}[A-Za-z0-9]{15})/view`);
    await this.page.waitForURL(re, { timeout: 30_000 });
    const m = this.page.url().match(re);
    if (!m) throw new Error(`Could not read ${objectApiName} id from url ${this.page.url()}`);
    return m[1];
  }
}

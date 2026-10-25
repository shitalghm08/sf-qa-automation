import { expect, Locator } from '@playwright/test';
import { waitForConvertCall, CapturedCall } from '../api/conversionCapture';
import { BasePage } from './BasePage';
import { LightningLookup } from './components/LightningLookup';

export type LinkMode = 'existing' | 'new';

export interface ConversionResult {
  accountId: string;
  contactId: string;
  opportunityId: string;
}

const ID_PREFIX = { account: '001', contact: '003', opportunity: '006' } as const;

export class LeadConvertPage extends BasePage {
  /** the "Convert Lead" modal */
  get dialog(): Locator {
    return this.page.getByRole('dialog').filter({ hasText: /convert lead/i }).last();
  }

  private get lookups(): LightningLookup {
    return new LightningLookup(this.dialog);
  }

  async waitUntilOpen(): Promise<void> {
    await expect(this.dialog).toBeVisible({ timeout: 30_000 });
    await this.waitForLightningIdle();
  }

  /**
   * The existence check the brief asks for. We search the lookup for the name we
   * expect and look at what comes back:
   *   - a real match      -> pick it                     ('existing')
   *   - only the "New ..." entry -> pick that            ('new')
   * The search text is the full name, so whichever branch fires the outcome is
   * predictable and can be asserted by the caller.
   */
  private async linkOrCreate(lookupLabel: string, searchText: string): Promise<LinkMode> {
    const input = this.lookups.input(lookupLabel);

    // the field is pre-filled with a "new record" pill, which has to go before we can search
    const clear = this.dialog.getByRole('button', { name: /clear selection|remove selected/i }).first();
    if (await clear.isVisible()) await clear.click();

    await input.click();
    await input.pressSequentially(searchText, { delay: 25 });

    const options = this.dialog.getByRole('option');
    // wait for the dropdown to settle on *something* before reading it
    await expect(options.first()).toBeVisible({ timeout: 15_000 });

    const isNewEntry = /^\s*(\+\s*)?(new|create new)\b/i;
    const match = options.filter({ hasText: searchText }).filter({ hasNotText: isNewEntry });

    if ((await match.count()) > 0) {
      this.log.info(`${lookupLabel}: found an existing record for "${searchText}", linking to it`);
      await match.first().click();
      return 'existing';
    }

    this.log.info(`${lookupLabel}: nothing existing for "${searchText}", creating a new one`);
    await options.filter({ hasText: isNewEntry }).first().click();
    return 'new';
  }

  linkAccount(companyName: string): Promise<LinkMode> {
    return this.linkOrCreate('Account Name', companyName);
  }

  linkContact(fullName: string): Promise<LinkMode> {
    return this.linkOrCreate('Contact Name', fullName);
  }

  /**
   * Click Convert while listening for the backend call the UI fires, then read the
   * confirmation dialog. Both are returned so the spec can cross-check them.
   */
  async submit(): Promise<{ result: ConversionResult; call: CapturedCall }> {
    const convertButton = this.dialog.getByRole('button', { name: 'Convert', exact: true });
    await expect(convertButton).toBeEnabled();

    // listener first, click second - otherwise a fast response is missed
    const [call] = await Promise.all([waitForConvertCall(this.page), convertButton.click()]);

    const done = this.page.getByRole('dialog').filter({ hasText: /your lead has been converted/i });
    await expect(done).toBeVisible({ timeout: 45_000 });

    const result = await this.readResult(done);
    this.log.info('lead converted', result);
    return { result, call };
  }

  /** ids come from the links in the confirmation dialog, matched by key prefix */
  private async readResult(done: Locator): Promise<ConversionResult> {
    const hrefs = await done.getByRole('link').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    const pick = (prefix: string): string => {
      const re = new RegExp(`\\b(${prefix}[A-Za-z0-9]{15})\\b`);
      for (const h of hrefs) {
        const m = h.match(re);
        if (m) return m[1];
      }
      throw new Error(`No ${prefix}... record link in the conversion confirmation. Links seen: ${hrefs.join(', ')}`);
    };

    return {
      accountId: pick(ID_PREFIX.account),
      contactId: pick(ID_PREFIX.contact),
      opportunityId: pick(ID_PREFIX.opportunity),
    };
  }

  /** Part B "navigate to the newly created opportunity" - through the link a user would click */
  async goToOpportunity(opportunityId: string): Promise<void> {
    const done = this.page.getByRole('dialog').filter({ hasText: /your lead has been converted/i });
    await done.locator(`a[href*="${opportunityId}"]`).first().click();
    await this.recordIdFromUrl('Opportunity', ID_PREFIX.opportunity);
    await this.waitForLightningIdle();
  }
}

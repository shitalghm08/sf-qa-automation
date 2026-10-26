import { expect, Locator } from '@playwright/test';
import { waitForConvertCall, CapturedCall } from '../api/conversionCapture';
import { BasePage } from './BasePage';
import { NOT_A_RECORD_ROW } from './components/LightningLookup';

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

  /**
   * The "Your lead has been converted" dialog. Matched by its accessible name: the Convert Lead
   * modal is still in the page underneath and its text contains the same sentence, so matching
   * by text alone hits both dialogs.
   */
  get confirmation(): Locator {
    return this.page.getByRole('dialog', { name: /your lead has been converted/i });
  }

  async waitUntilOpen(): Promise<void> {
    await expect(this.dialog).toBeVisible({ timeout: 30_000 });
    await this.waitForLightningIdle();
  }

  private radio(name: string): Locator {
    return this.dialog.getByRole('radio', { name, exact: true });
  }

  /**
   * The radios are aura inputs with a styled label on top, and a toast can sit over them right
   * after the status change, so a pointer click may land on the wrong element ("did not change
   * its state"). A native click on the input itself always toggles it and fires the handlers.
   */
  private async choose(radio: Locator): Promise<void> {
    await radio.evaluate((el) => (el as HTMLInputElement).click());
    await expect(radio).toBeChecked();
  }

  /**
   * The existence check the brief asks for. The modal offers "Create New X" or "Choose
   * Existing X" per section, each with its own "X Search" box, so the check is: does the
   * search find a record for the name we expect?
   *   - yes -> Choose Existing, pick it   ('existing')
   *   - no  -> Create New                 ('new')
   * The search text is the full name, so the outcome is predictable and the caller can assert it.
   * The dropdown's "Search for matching ... in Account" row is not a record, see NOT_A_RECORD_ROW.
   */
  private async linkBySearch(kind: 'Account' | 'Contact', searchText: string, patienceMs: number): Promise<LinkMode> {
    const chooseExisting = this.radio(`Choose Existing ${kind}`);
    const createNew = this.radio(`Create New ${kind}`);
    await expect(chooseExisting, `Convert Lead modal should offer "Choose Existing ${kind}"`).toBeVisible({ timeout: 15_000 });

    // the radio is disabled while the modal has no automatic match ("0 Account Matches detected"),
    // but the search box still works, so only tick it when it can be ticked
    if (await chooseExisting.isEnabled()) await this.choose(chooseExisting);

    const search = this.dialog.getByRole('combobox', { name: new RegExp(`${kind} search`, 'i') });
    const options = this.dialog.getByRole('option');
    const match = options.filter({ hasNotText: NOT_A_RECORD_ROW }).filter({ hasText: searchText });

    // a search box that is greyed out means there is nothing to link to
    if (!(await search.isEnabled())) {
      this.log.info(`${kind}: search is disabled, creating a new one`);
      if (!(await createNew.isChecked())) await this.choose(createNew);
      return 'new';
    }

    // A new record only becomes searchable after the search index catches up, which took 45 to 60 s
    // in the dev org. Look at least twice, and keep looking while the caller says the record should
    // exist (patienceMs); a "nothing should exist" caller doesn't pay for the wait.
    const deadline = Date.now() + patienceMs;
    for (let attempt = 1; ; attempt++) {
      await search.click();
      await search.fill('');
      await search.pressSequentially(searchText, { delay: 25 });

      const found = await expect
        .poll(() => match.count(), { timeout: 5_000, intervals: [250, 500, 1_000] })
        .toBeGreaterThan(0)
        .then(
          () => true,
          () => false,
        );
      const rows = (await options.allInnerTexts().catch(() => [] as string[])).map((t) => t.replace(/\s+/g, ' ').trim());
      this.log.info(`${kind} Search rows for "${searchText}"`, { attempt, rows });

      if (found) {
        this.log.info(`${kind}: found an existing record for "${searchText}", linking to it`);
        await match.first().click();
        return 'existing';
      }
      if (attempt >= 2 && Date.now() >= deadline) break;
    }

    this.log.info(`${kind}: nothing existing for "${searchText}", creating a new one`);
    await search.fill('');
    if (!(await createNew.isChecked())) await this.choose(createNew);
    return 'new';
  }

  /** `patienceMs`: how long to keep searching when the record is expected to exist (search index lag) */
  linkAccount(companyName: string, opts: { patienceMs?: number } = {}): Promise<LinkMode> {
    return this.linkBySearch('Account', companyName, opts.patienceMs ?? 0);
  }

  linkContact(fullName: string, opts: { patienceMs?: number } = {}): Promise<LinkMode> {
    return this.linkBySearch('Contact', fullName, opts.patienceMs ?? 0);
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

    const done = this.confirmation;
    await expect(done).toBeVisible({ timeout: 45_000 });

    const result = await this.readResult(done);
    this.log.info('lead converted', result);
    return { result, call };
  }

  /** ids come from the links in the confirmation dialog, matched by key prefix */
  private async readResult(done: Locator): Promise<ConversionResult> {
    const readHrefs = () => done.getByRole('link').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    const find = (hrefs: string[], prefix: string): string | undefined => {
      const re = new RegExp(`\\b(${prefix}[A-Za-z0-9]{15})\\b`);
      for (const h of hrefs) {
        const m = h.match(re);
        if (m) return m[1];
      }
      return undefined;
    };
    const readIds = async (): Promise<Partial<ConversionResult>> => {
      const hrefs = await readHrefs();
      return {
        accountId: find(hrefs, ID_PREFIX.account),
        contactId: find(hrefs, ID_PREFIX.contact),
        opportunityId: find(hrefs, ID_PREFIX.opportunity),
      };
    };

    // the dialog text can show up a moment before its links do, so wait for all three ids
    await expect
      .poll(async () => Object.values(await readIds()).every(Boolean), { timeout: 15_000, intervals: [250, 500, 1_000] })
      .toBe(true)
      .catch(async (err) => {
        const hrefs = await readHrefs();
        const text = (await done.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
        throw new Error(
          `Could not read the account / contact / opportunity ids from the conversion confirmation. ` +
            `Dialog text: "${text}". Links seen: [${hrefs.join(', ')}]. Original error: ${(err as Error).message}`,
        );
      });

    return (await readIds()) as ConversionResult;
  }

  /** Part B "navigate to the newly created opportunity" - through the link a user would click */
  async goToOpportunity(opportunityId: string): Promise<void> {
    const done = this.confirmation;
    await done.locator(`a[href*="${opportunityId}"]`).first().click();
    await this.recordIdFromUrl('Opportunity', ID_PREFIX.opportunity);
    await this.waitForLightningIdle();
  }
}

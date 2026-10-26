import { expect, Locator } from '@playwright/test';
import { getLogger } from '../../utils/logger';
import { esc, looseLabel } from '../BasePage';

const log = getLogger('LightningLookup');

/**
 * Rows of a lookup dropdown that are not records: the "search all" row ('Show All Results for x'
 * or '"x" in Accounts', the quotes are often drawn by css so they are not in the text) and the
 * "New ..." shortcut. Clicking the first one opens the Advanced Search screen.
 */
export const NOT_A_RECORD_ROW =
  /show all results|^\s*["“]|\s+in\s+(accounts?|contacts?|leads?|opportunit(y|ies))\s*$|^\s*(\+\s*)?new\b/i;

/**
 * Lookup fields (Account Name on a Contact, etc). Typing has to look like a real
 * user, otherwise the search request never fires, so pressSequentially not fill().
 */
export class LightningLookup {
  constructor(private readonly scope: Locator) {}

  input(label: string): Locator {
    return this.scope.getByRole('combobox', { name: looseLabel(label) }).first();
  }

  /** the rows in the dropdown, including the non-record ones, see NOT_A_RECORD_ROW */
  results(): Locator {
    return this.scope.getByRole('option');
  }

  async search(label: string, text: string): Promise<void> {
    const input = this.input(label);
    await input.click();
    await input.pressSequentially(text, { delay: 25 });
  }

  async select(label: string, text: string): Promise<void> {
    await this.search(label, text);

    // a record row starts with the record's name. Anything else that merely contains it is a
    // "search all" style row that opens the Advanced Search screen.
    const startsWithName = new RegExp(`^\\s*${esc(text)}`, 'i');
    const record = this.results().filter({ hasText: startsWithName }).filter({ hasNotText: NOT_A_RECORD_ROW }).first();
    try {
      await record.waitFor({ state: 'visible', timeout: 15_000 });
    } catch (err) {
      const rows = await this.rowTexts();
      throw new Error(
        `Lookup "${label}": no record row for "${text}". Rows shown: [${rows.join(' | ')}]. Original error: ${(err as Error).message}`,
      );
    }
    const rows = await this.rowTexts();
    log.info(`lookup "${label}" rows for "${text}"`, { rows });

    // The dropdown can close between listing the rows and clicking one (the list re-renders when
    // the recent / search results arrive). Then the typed text is left in the field, flagged invalid.
    // On a failed click, reopen the dropdown by typing the search again and retry.
    const input = this.input(label);
    let retry = false;
    await expect(async () => {
      if (retry) {
        log.info(`lookup "${label}": dropdown closed before the click, searching again`);
        await input.click();
        await input.fill('');
        await input.pressSequentially(text, { delay: 25 });
        await record.waitFor({ state: 'visible', timeout: 8_000 });
      }
      retry = true;
      await record.click({ timeout: 4_000 });
    }).toPass({ timeout: 40_000 });

    const advancedSearch = this.scope.page().getByRole('heading', { name: /advanced search/i });
    if (await advancedSearch.waitFor({ state: 'visible', timeout: 1_500 }).then(() => true, () => false)) {
      throw new Error(`Lookup "${label}": clicked a row that opened Advanced Search instead of selecting. Rows were: [${rows.join(' | ')}]`);
    }
  }

  private async rowTexts(): Promise<string[]> {
    const rows = await this.results().allInnerTexts().catch(() => [] as string[]);
    return rows.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
}

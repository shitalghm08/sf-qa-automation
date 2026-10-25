import { Locator } from '@playwright/test';
import { looseLabel } from '../BasePage';

/**
 * Lookup fields (Account Name on a Contact, etc). Typing has to look like a real
 * user, otherwise the search request never fires, so pressSequentially not fill().
 */
export class LightningLookup {
  constructor(private readonly scope: Locator) {}

  input(label: string): Locator {
    return this.scope.getByRole('combobox', { name: looseLabel(label) }).first();
  }

  /** the rows in the dropdown, minus the "New ..." shortcut rows */
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
    await this.results().filter({ hasText: text }).first().click();
  }
}

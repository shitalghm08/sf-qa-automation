import { expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class ContactPage extends BasePage {
  async openRecord(id: string): Promise<void> {
    await this.open(`/lightning/r/Contact/${id}/view`);
  }

  /** a contact's Account Name field is a link, its href carries the account id */
  async expectLinkedToAccount(contactId: string, accountId: string, accountName: string): Promise<void> {
    await this.openRecord(contactId);
    const account = this.recordField('Contact', ['AccountId', 'Account'], 'Account Name');
    await expect(account).toContainText(accountName);
    await expect(account.getByRole('link').first()).toHaveAttribute('href', new RegExp(accountId));
  }
}

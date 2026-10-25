import { expect } from '@playwright/test';
import { BasePage, exactLabel } from './BasePage';
import { LightningLookup } from './components/LightningLookup';

/**
 * Creates the "already exists" Accounts / Contacts that the conversion scenarios need.
 * Done through the UI on purpose (see README, "Test data strategy"): no connected app or
 * OAuth setup needed, and it reuses the same page-object plumbing as the rest of the suite.
 */
export class RecordSeeder extends BasePage {
  private async openNewDialog(objectApiName: 'Account' | 'Contact'): Promise<void> {
    await this.open(`/lightning/o/${objectApiName}/list?filterName=Recent`);
    await this.page
      .getByRole('button', { name: 'New', exact: true })
      .or(this.page.getByRole('link', { name: 'New', exact: true }))
      .first()
      .click();

    // some orgs put a record type picker in front of the form
    const dialog = this.activeDialog();
    const heading = dialog.getByRole('heading', { name: new RegExp(`new ${objectApiName}`, 'i') });
    const picker = dialog.getByText(/select a record type/i);
    await expect(heading.or(picker).first()).toBeVisible();

    if (await picker.isVisible()) {
      this.log.info('record type picker shown, accepting the default');
      await dialog.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(heading).toBeVisible();
    }
  }

  async createAccount(name: string): Promise<string> {
    await this.openNewDialog('Account');
    const dialog = this.activeDialog();

    await dialog.getByLabel(exactLabel('Account Name')).first().fill(name);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(this.toast(/was created/i)).toBeVisible();
    const id = await this.recordIdFromUrl('Account', '001');
    this.log.info(`seeded account "${name}"`, { id });
    return id;
  }

  async createContact(data: { firstName: string; lastName: string; email: string; accountName: string }): Promise<string> {
    await this.openNewDialog('Contact');
    const dialog = this.activeDialog();

    await dialog.getByLabel(exactLabel('First Name')).first().fill(data.firstName);
    await dialog.getByLabel(exactLabel('Last Name')).first().fill(data.lastName);
    await dialog.getByLabel(exactLabel('Email')).first().fill(data.email);
    await new LightningLookup(dialog).select('Account Name', data.accountName);

    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(this.toast(/was created/i)).toBeVisible();
    const id = await this.recordIdFromUrl('Contact', '003');
    this.log.info(`seeded contact "${data.firstName} ${data.lastName}"`, { id });
    return id;
  }
}

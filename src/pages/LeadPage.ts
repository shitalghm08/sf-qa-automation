import { expect, Locator } from '@playwright/test';
import { env } from '../config/env';
import { fullName, LeadData } from '../utils/randomData';
import { BasePage, exactLabel } from './BasePage';
import { LightningCombobox } from './components/LightningCombobox';

export type SaveOutcome = 'saved' | 'duplicate-alert' | 'validation-errors';

export class LeadPage extends BasePage {
  // ---------- list / new lead modal ----------

  async openList(): Promise<void> {
    await this.open('/lightning/o/Lead/list?filterName=Recent');
  }

  private get newButton(): Locator {
    return this.page
      .getByRole('button', { name: 'New', exact: true })
      .or(this.page.getByRole('link', { name: 'New', exact: true }))
      .first();
  }

  /** the New Lead / Edit Lead form */
  get form(): Locator {
    return this.activeDialog();
  }

  async startNewLead(): Promise<void> {
    await this.openList();
    await this.newButton.click();
    await expect(this.form.getByRole('heading', { name: /new lead/i })).toBeVisible();
  }

  private input(label: string): Locator {
    return this.form.getByLabel(exactLabel(label)).first();
  }

  /**
   * Fills the open New Lead form. Required fields (last name, company) are always
   * filled when present in `data`; pass a partial object to leave things empty on purpose.
   */
  async fillForm(data: Partial<LeadData> & { status?: string }): Promise<void> {
    const picklists = new LightningCombobox(this.form);

    if (data.firstName !== undefined) await this.input('First Name').fill(data.firstName);
    if (data.lastName !== undefined) await this.input('Last Name').fill(data.lastName);
    if (data.company !== undefined) await this.input('Company').fill(data.company);
    if (data.title !== undefined) await this.input('Title').fill(data.title);
    if (data.phone !== undefined) await this.input('Phone').fill(data.phone);
    if (data.email !== undefined) await this.input('Email').fill(data.email);
    if (data.website !== undefined) await this.input('Website').fill(data.website);
    if (data.employees !== undefined) await this.input('No. of Employees').fill(data.employees);

    if (data.status !== undefined) await picklists.select('Lead Status', data.status);
    if (data.leadSource !== undefined) await picklists.select('Lead Source', data.leadSource);
    if (data.industry !== undefined) await picklists.select('Industry', data.industry);
    if (data.rating !== undefined) await picklists.select('Rating', data.rating);
  }

  private get saveButton(): Locator {
    // "Save & New" lives next to it, hence exact
    return this.form.getByRole('button', { name: 'Save', exact: true });
  }

  /** click Save and work out what the UI did about it */
  async save(): Promise<SaveOutcome> {
    await this.saveButton.click();

    const savedUrl = /\/lightning\/r\/Lead\/00Q[A-Za-z0-9]{15}\/view/;
    const outcome = await Promise.race([
      this.page.waitForURL(savedUrl, { timeout: 30_000 }).then(() => 'saved' as const),
      this.duplicateAlert.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'duplicate-alert' as const),
      this.validationSummary.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'validation-errors' as const),
    ]);
    this.log.debug(`save outcome: ${outcome}`);
    return outcome;
  }

  /** happy path: fill, save, return the new record id */
  async createLead(data: LeadData, status = env.leadStatusInitial): Promise<string> {
    await this.startNewLead();
    await this.fillForm({ ...data, status });
    const outcome = await this.save();
    if (outcome !== 'saved') {
      throw new Error(`Creating lead ${fullName(data)} did not save, got: ${outcome}`);
    }
    await expect(this.toast(/was created/i)).toBeVisible();
    return this.recordIdFromUrl('Lead', '00Q');
  }

  // ---------- validation / duplicate banners ----------

  get validationSummary(): Locator {
    return this.form.getByText(/review the following fields|review the errors|we hit a snag/i).first();
  }

  get fieldErrors(): Locator {
    return this.form.getByText(/complete this field/i);
  }

  get duplicateAlert(): Locator {
    return this.form.getByText(/use one of these records|you.re creating a duplicate|duplicate/i).first();
  }

  async cancelForm(): Promise<void> {
    await this.form.getByRole('button', { name: 'Cancel', exact: true }).click();
  }

  // ---------- record page ----------

  async openRecord(id: string): Promise<void> {
    await this.open(`/lightning/r/Lead/${id}/view`);
  }

  async openDetailsTab(): Promise<void> {
    const tab = this.page.getByRole('tab', { name: 'Details', exact: true });
    if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
    await this.waitForLightningIdle();
  }

  field(api: string[], label: string): Locator {
    return this.recordField('Lead', api, label);
  }

  /** Part B.4 - the details view shows what we typed in */
  async expectDetails(data: LeadData, status: string): Promise<void> {
    await this.openDetailsTab();

    await expect.soft(this.field(['Name'], 'Name')).toContainText(data.firstName);
    await expect.soft(this.field(['Name'], 'Name')).toContainText(data.lastName);
    await expect.soft(this.field(['Company'], 'Company')).toContainText(data.company);
    await expect.soft(this.field(['Title'], 'Title')).toContainText(data.title);
    await expect.soft(this.field(['Email'], 'Email')).toContainText(data.email);
    await expect.soft(this.field(['Phone'], 'Phone')).toContainText(data.phone);
    await expect.soft(this.field(['Website'], 'Website')).toContainText(new URL(data.website).hostname);
    await expect.soft(this.field(['LeadSource'], 'Lead Source')).toContainText(data.leadSource);
    await expect.soft(this.field(['Industry'], 'Industry')).toContainText(data.industry);
    await expect.soft(this.field(['Rating'], 'Rating')).toContainText(data.rating);
    await expect.soft(this.field(['NumberOfEmployees'], 'No. of Employees')).toContainText(
      Number(data.employees).toLocaleString('en-US'),
    );
    await expect.soft(this.field(['Status'], 'Lead Status')).toContainText(status);
  }

  async currentStatus(): Promise<string> {
    return (await this.field(['Status'], 'Lead Status').innerText()).replace(/\s+/g, ' ').trim();
  }

  /** name of the lead owner, used later to check the opportunity owner */
  async ownerName(): Promise<string> {
    await this.openDetailsTab();
    const link = this.field(['OwnerId', 'Owner'], 'Lead Owner').getByRole('link').first();
    return (await link.innerText()).trim();
  }

  /** Part B.5 - change the status through the Edit form */
  async changeStatus(newStatus: string): Promise<void> {
    await this.clickRecordAction('Edit');
    await expect(this.form.getByRole('heading', { name: /edit/i })).toBeVisible();

    await new LightningCombobox(this.form).select('Lead Status', newStatus);
    await this.saveButton.click();

    await expect(this.toast(/was saved/i)).toBeVisible();
    await expect(this.form).toBeHidden();
  }

  async clickConvert(): Promise<void> {
    await this.clickRecordAction('Convert');
  }
}

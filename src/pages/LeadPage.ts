import { expect, Locator } from '@playwright/test';
import { env } from '../config/env';
import { fullName, LeadData } from '../utils/randomData';
import { BasePage, exactLabel } from './BasePage';
import { LightningCombobox } from './components/LightningCombobox';

// after a duplicate alert the button reads "Save (Ignore Alert)"
const SAVE_BUTTON = /^\s*Save(\s*\(ignore alert\))?\s*$/i;

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

  /**
   * The New Lead / Edit Lead form. Not simply "the top dialog": the error popover
   * ("We hit a snag") is a dialog too and sits on top, so pick the one with a Save button.
   */
  get form(): Locator {
    // CSS based on purpose: getByRole can't see the form while a popover is open
    return this.page
      .locator('[role="dialog"]')
      .filter({ has: this.page.locator('button').filter({ hasText: SAVE_BUTTON }) })
      .filter({ visible: true })
      .last();
  }

  async startNewLead(): Promise<void> {
    await this.openList();
    await this.newButton.click();

    // orgs with several lead record types ask for one first ("Select a Record Type" -> Next)
    // the record type step has no Save button, so it isn't `this.form`
    const next = this.activeDialog().getByRole('button', { name: 'Next', exact: true });
    await expect(next.or(this.input('Last Name')).first()).toBeVisible();
    if (await next.isVisible()) {
      this.log.info('record type step shown, accepting the default record type');
      await next.click();
    }

    await expect(this.form.getByRole('heading', { name: /new lead/i })).toBeVisible();
  }

  private input(label: string): Locator {
    return this.form.getByLabel(exactLabel(label)).first();
  }

  /** fill a text input; if the label isn't there, say which labels the form does have */
  private async fillText(label: string, value: string): Promise<void> {
    try {
      await this.input(label).fill(value, { timeout: 8_000 });
    } catch (err) {
      const labels = await this.form.locator('label, legend').allInnerTexts().catch(() => [] as string[]);
      const seen = [...new Set(labels.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean))];
      throw new Error(
        `Lead form: could not fill "${label}". Labels on the form: [${seen.join(' | ')}]. Original error: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Fills the open New Lead form. Required fields (last name, company) are always
   * filled when present in `data`; pass a partial object to leave things empty on purpose.
   * Picklists go first: once name / company / email are in, the duplicate popover can appear
   * and it closes any dropdown that is still being opened.
   */
  async fillForm(data: Partial<LeadData> & { status?: string }): Promise<void> {
    const picklists = new LightningCombobox(this.form);

    if (data.status !== undefined) await picklists.select('Lead Status', data.status);
    if (data.leadSource !== undefined) await picklists.select('Lead Source', data.leadSource);
    if (data.industry !== undefined) await picklists.select('Industry', data.industry);
    if (data.rating !== undefined) await picklists.select('Rating', data.rating);

    if (data.firstName !== undefined) await this.fillText('First Name', data.firstName);
    if (data.lastName !== undefined) await this.fillText('Last Name', data.lastName);
    if (data.company !== undefined) await this.fillText('Company', data.company);
    if (data.title !== undefined) await this.fillText('Title', data.title);
    if (data.phone !== undefined) await this.fillText('Phone', data.phone);
    if (data.email !== undefined) await this.fillText('Email', data.email);
    if (data.website !== undefined) await this.fillText('Website', data.website);
    if (data.employees !== undefined) await this.fillText('No. of Employees', data.employees);
  }

  private get saveButton(): Locator {
    // "Save & New" lives next to it, hence the anchored regex
    return this.form.locator('button').filter({ hasText: SAVE_BUTTON });
  }

  // some orgs leave the object name out of the url: /lightning/r/<id>/view
  private readonly savedUrl = /\/lightning\/r\/(?:Lead\/)?00Q[A-Za-z0-9]{15}\/view/;

  /** click Save and work out what the UI did about it */
  async save(): Promise<SaveOutcome> {
    // some orgs raise the duplicate alert while the form is still being filled, no click needed then
    if (!(await this.duplicateAlert.isVisible())) await this.saveButton.click();

    let outcome: SaveOutcome;
    try {
      outcome = await Promise.race([
        this.page.waitForURL(this.savedUrl, { timeout: 30_000 }).then(() => 'saved' as const),
        this.duplicateAlert.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'duplicate-alert' as const),
        this.validationSummary.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'validation-errors' as const),
      ]);
    } catch (err) {
      // none of the three matched: show what the page actually said, so a wording difference is obvious
      const shown = (await this.form.innerText({ timeout: 2_000 }).catch(() => '(form not visible)')).replace(/\s+/g, ' ').trim();
      throw new Error(
        `Save gave no recognised outcome (saved / duplicate alert / validation errors). Url: ${this.page.url()}. ` +
          `Form text: "${shown.slice(0, 600)}". Original error: ${(err as Error).message}`,
      );
    }
    // The live duplicate check can answer just as the save goes through, so the alert flashes up on a
    // lead that did get saved. If the url moves to the new record, the save wins.
    if (outcome === 'duplicate-alert' && (await this.page.waitForURL(this.savedUrl, { timeout: 2_000 }).then(() => true, () => false))) {
      this.log.debug('duplicate alert appeared but the lead was saved anyway');
      outcome = 'saved';
    }
    this.log.debug(`save outcome: ${outcome}`);
    return outcome;
  }

  /** happy path: fill, save, return the new record id */
  async createLead(data: LeadData, status = env.leadStatusInitial): Promise<string> {
    await this.startNewLead();
    await this.fillForm({ ...data, status });
    const outcome = await this.save();
    if (outcome === 'duplicate-alert') {
      // e.g. a contact with the same name / email was seeded for the conversion scenarios. The rule
      // only warns, so save again (the button may now read "Save (Ignore Alert)").
      this.log.info(`duplicate alert while creating ${fullName(data)}, saving anyway`);
      await this.saveButton.click();
      await this.page.waitForURL(this.savedUrl, { timeout: 30_000 });
    } else if (outcome !== 'saved') {
      throw new Error(`Creating lead ${fullName(data)} did not save, got: ${outcome}`);
    }
    await expect(this.toast(/was created/i)).toBeVisible();
    return this.recordIdFromUrl('Lead', '00Q');
  }

  // ---------- validation / duplicate banners ----------

  // the summary is a popover next to the form, not inside it
  get validationSummary(): Locator {
    return this.page.getByText(/review the following fields|review the errors|we hit a snag/i).filter({ visible: true }).first();
  }

  /** a failing field as listed in the summary popover (compound fields are listed by group: "Name", not "Last Name") */
  summaryLink(label: string): Locator {
    return this.page
      .getByRole('dialog')
      .filter({ hasText: /review the following fields|review the errors|we hit a snag/i })
      .getByRole('link', { name: label, exact: true })
      .first();
  }

  // While the summary / duplicate popover is open lightning takes the form out of the accessibility
  // tree, so role based locators can't see it. Text locators can, hence page level getByText below.
  get fieldErrors(): Locator {
    return this.page.getByText(/complete this field/i).filter({ visible: true });
  }

  get duplicateAlert(): Locator {
    return this.page
      .getByText(/similar records exist|use one of these records|looks like an existing record|creating a duplicate/i)
      .filter({ visible: true })
      .first();
  }

  get viewDuplicatesLink(): Locator {
    return this.page.getByText(/view duplicates/i).filter({ visible: true }).first();
  }

  async cancelForm(): Promise<void> {
    await this.page.locator('button').filter({ hasText: /^\s*Cancel\s*$/ }).filter({ visible: true }).last().click();
  }

  // ---------- record page ----------

  async openRecord(id: string): Promise<void> {
    await this.open(`/lightning/r/Lead/${id}/view`);
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

  async currentLeadSource(): Promise<string> {
    return (await this.field(['LeadSource'], 'Lead Source').innerText()).replace(/\s+/g, ' ').trim();
  }

  /** name of the lead owner, used later to check the opportunity owner */
  async ownerName(): Promise<string> {
    await this.openDetailsTab();
    const link = this.field(['OwnerId', 'Owner'], 'Lead Owner').getByRole('link').first();
    return (await link.innerText()).trim();
  }

  /** change one picklist through the Edit form */
  private async editPicklist(label: string, value: string): Promise<void> {
    await this.clickRecordAction('Edit');
    await expect(this.form.getByRole('heading', { name: /edit/i })).toBeVisible();

    await new LightningCombobox(this.form).select(label, value);
    await this.saveButton.click();

    await expect(this.toast(/was saved/i)).toBeVisible();
    await expect(this.form).toBeHidden();
  }

  /** Part B.5 - change the status through the Edit form */
  async changeStatus(newStatus: string): Promise<void> {
    await this.editPicklist('Lead Status', newStatus);
  }

  async changeLeadSource(source: string): Promise<void> {
    await this.editPicklist('Lead Source', source);
  }

  async clickConvert(): Promise<void> {
    await this.clickRecordAction('Convert');
  }
}

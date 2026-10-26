import { expect, test } from '../src/fixtures';
import { env } from '../src/config/env';
import { buildLead } from '../src/utils/randomData';

test.describe('Negative scenarios - leads', () => {
  test.beforeEach(async ({ home }) => {
    await home.goto();
    await home.openApp(env.salesAppName);
  });

  // last name and company are the two required fields on the standard Lead object.
  // The summary popover lists the compound "Name" field, not "Last Name", hence `inSummary`.
  const LAST_NAME = { label: 'Last Name', inSummary: 'Name' };
  const COMPANY = { label: 'Company', inSummary: 'Company' };
  const missingCases = [
    { title: 'nothing filled in', fill: {}, missing: [LAST_NAME, COMPANY] },
    { title: 'company missing', fill: { lastName: 'OnlyLastName' }, missing: [COMPANY] },
    { title: 'last name missing', fill: { company: 'QA_AUTO Only Company' }, missing: [LAST_NAME] },
  ];

  for (const c of missingCases) {
    test(`missing mandatory fields: ${c.title}`, async ({ leads, page }, testInfo) => {
      await testInfo.attach('lead-data.json', {
        body: JSON.stringify({ typedIn: c.fill, expectedToBeFlagged: c.missing.map((m) => m.label) }, null, 2),
        contentType: 'application/json',
      });
      await leads.startNewLead();
      await leads.fillForm(c.fill);

      const outcome = await leads.save();
      expect(outcome, 'form should refuse to save').toBe('validation-errors');

      await test.step('error banner is shown', async () => {
        await expect(leads.validationSummary).toBeVisible();
      });

      await test.step('every missing field is flagged, and only those', async () => {
        await expect(leads.fieldErrors).toHaveCount(c.missing.length);
        for (const field of c.missing) {
          // the summary lists each failing field as a link; the plain label is always on the form, so it proves nothing
          await expect(leads.summaryLink(field.inSummary), `${field.label} should be listed in the error summary`).toBeVisible();
        }
      });

      await test.step('nothing was saved, the form is still open', async () => {
        // inline errors only exist while the form is open (the form itself is hidden from role queries behind the popover)
        await expect(leads.fieldErrors.first()).toBeVisible();
        await expect(page).not.toHaveURL(/\/lightning\/r\/(?:Lead\/)?00Q/);
      });
    });
  }

  test('duplicate lead (same email / name / company) raises the duplicate alert', async ({ leads }, testInfo) => {
    const original = buildLead();
    await testInfo.attach('lead-data.json', { body: JSON.stringify({ original }, null, 2), contentType: 'application/json' });

    await test.step('create the first lead', async () => {
      await leads.createLead(original);
    });

    await test.step('try to create a second lead with the same email, name and company', async () => {
      await leads.startNewLead();
      // only the fields the duplicate rule looks at: this org shows the alert as soon as they are
      // filled in, and the popover then closes any picklist that is still being opened
      await leads.fillForm({
        firstName: original.firstName,
        lastName: original.lastName,
        company: original.company,
        email: original.email,
      });
    });

    const outcome = await leads.save();

    // the brief says "if the environment supports it": duplicate rules can be switched off in an org
    if (outcome === 'saved') {
      testInfo.annotations.push({
        type: 'environment',
        description: 'org has no active lead duplicate rule - second lead saved without an alert',
      });
      test.skip(true, 'duplicate detection is not active in this org');
    }

    await test.step('duplicate alert is shown and offers the existing records', async () => {
      expect(outcome).toBe('duplicate-alert');
      await expect(leads.duplicateAlert).toBeVisible();
      await expect(leads.viewDuplicatesLink).toBeVisible();
    });

    await test.step('cancelling leaves just the one lead', async () => {
      await leads.cancelForm();
      await expect(leads.duplicateAlert).toBeHidden();
    });
  });
});

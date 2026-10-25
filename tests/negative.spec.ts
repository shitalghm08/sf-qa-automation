import { expect, test } from '../src/fixtures';
import { env } from '../src/config/env';
import { buildLead } from '../src/utils/randomData';

test.describe('Negative scenarios - leads', () => {
  test.beforeEach(async ({ home }) => {
    await home.goto();
    await home.openApp(env.salesAppName);
  });

  // last name and company are the two required fields on the standard Lead object
  const missingCases = [
    { title: 'nothing filled in', fill: {}, missing: ['Last Name', 'Company'] },
    { title: 'company missing', fill: { lastName: 'OnlyLastName' }, missing: ['Company'] },
    { title: 'last name missing', fill: { company: 'QA_AUTO Only Company' }, missing: ['Last Name'] },
  ];

  for (const c of missingCases) {
    test(`missing mandatory fields: ${c.title}`, async ({ leads, page }) => {
      await leads.startNewLead();
      await leads.fillForm(c.fill);

      const outcome = await leads.save();
      expect(outcome, 'form should refuse to save').toBe('validation-errors');

      await test.step('error banner is shown', async () => {
        await expect(leads.validationSummary).toBeVisible();
      });

      await test.step('every missing field is flagged, and only those', async () => {
        await expect(leads.fieldErrors).toHaveCount(c.missing.length);
        for (const label of c.missing) {
          await expect(leads.form.getByRole('link', { name: label }).or(leads.form.getByText(label, { exact: true })).first()).toBeVisible();
        }
      });

      await test.step('nothing was saved, the form is still open', async () => {
        await expect(leads.form).toBeVisible();
        await expect(page).not.toHaveURL(/\/lightning\/r\/Lead\//);
      });
    });
  }

  test('duplicate lead (same email / name / company) raises the duplicate alert', async ({ leads }, testInfo) => {
    const original = buildLead();

    await test.step('create the first lead', async () => {
      await leads.createLead(original);
    });

    await test.step('try to create a second lead with the same email, name and company', async () => {
      await leads.startNewLead();
      await leads.fillForm({ ...original });
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

    await test.step('duplicate alert is shown and points at the original lead', async () => {
      expect(outcome).toBe('duplicate-alert');
      await expect(leads.duplicateAlert).toBeVisible();
      await expect(leads.form.getByText(original.lastName).first()).toBeVisible();
    });

    await test.step('cancelling leaves just the one lead', async () => {
      await leads.cancelForm();
      await expect(leads.form).toBeHidden();
    });
  });
});

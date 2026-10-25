import { env } from '../src/config/env';
import { expect, test } from '../src/fixtures';
import { buildLead, fullName } from '../src/utils/randomData';

test.describe('Part B - lead creation and management', () => {
  test('create a lead, verify the details view, then qualify it @smoke', async ({ home, leads }, testInfo) => {
    // every run (and every parallel worker) gets its own lead
    const lead = buildLead();
    testInfo.annotations.push({ type: 'lead', description: `${fullName(lead)} / ${lead.company}` });
    await testInfo.attach('lead-data.json', { body: JSON.stringify(lead, null, 2), contentType: 'application/json' });

    await test.step('go to the Sales app', async () => {
      await home.goto();
      await home.openApp(env.salesAppName);
    });

    let leadId = '';
    await test.step('create the lead and save it', async () => {
      leadId = await leads.createLead(lead);
    });

    await test.step('the lead has a unique 18 character id', async () => {
      expect(leadId).toHaveLength(18);
      expect(leadId).toMatch(/^00Q[A-Za-z0-9]{15}$/);
      testInfo.annotations.push({ type: 'lead-id', description: leadId });
    });

    await test.step('details view shows the data we entered', async () => {
      await leads.expectDetails(lead, env.leadStatusInitial);
    });

    await test.step(`edit the lead: ${env.leadStatusInitial} -> ${env.leadStatusUpdated}`, async () => {
      await leads.changeStatus(env.leadStatusUpdated);
    });

    await test.step('status reads back as updated', async () => {
      await expect.poll(() => leads.currentStatus(), { timeout: 15_000 }).toContain(env.leadStatusUpdated);
    });
  });
});

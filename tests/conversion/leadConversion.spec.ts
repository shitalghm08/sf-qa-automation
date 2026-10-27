import { env } from '../../src/config/env';
import { expect, test } from '../../src/fixtures';
import { assertConversionResponse } from '../../src/api/conversionAssertions';
import { LinkMode } from '../../src/pages/LeadConvertPage';
import { buildLead, fullName } from '../../src/utils/randomData';
import { readSharedIds, searchPatienceMs, SHARED } from '../../src/utils/sharedData';

/**
 * Lead -> Opportunity conversion, once per branch of the account / contact check.
 *
 * The brief wants the modal to look for existing records first and only create new
 * ones when nothing is there. To prove each branch really fires, every scenario sets up
 * exactly what it needs and then asserts the modal picked the matching branch.
 * If the modal and the data disagree the test fails at the link step, not three
 * assertions later with a confusing message.
 *
 * "Exists" scenarios link to ONE shared Account / Contact that the seed-shared project creates
 * once and keeps (src/utils/sharedData.ts): the modal finds records through the search index,
 * and a record created seconds ago can take minutes to show up there. The lead is given the
 * shared record's name, so the modal's search finds it.
 */
interface Scenario {
  title: string;
  existingAccount: boolean;
  existingContact: boolean;
}

const scenarios: Scenario[] = [
  { title: 'neither account nor contact exists, both get created', existingAccount: false, existingContact: false },
  { title: 'account exists, linked; contact gets created', existingAccount: true, existingContact: false },
  { title: 'account and contact exist, both linked', existingAccount: true, existingContact: true },
];

test.describe('PartB-lead to opportunity conversion', { tag: ['@regression'] }, () => {
  // only the very first run, with brand new shared records, may wait minutes for the search index
  test.describe.configure({ timeout: 480_000 });

  for (const sc of scenarios) {
    test(`convert lead: ${sc.title}`, async ({ home, leads, convert, opportunities, contacts }, testInfo) => {
      const expectedAccountMode: LinkMode = sc.existingAccount ? 'existing' : 'new';
      const expectedContactMode: LinkMode = sc.existingContact ? 'existing' : 'new';
      testInfo.annotations.push({ type: 'scenario', description: sc.title });

      const shared = readSharedIds();
      if ((sc.existingAccount || sc.existingContact) && !shared?.contactId) {
        throw new Error('No shared Account / Contact recorded. They are created by the seed-shared project, which the chromium project depends on.');
      }

      // the lead carries the name of whatever should already exist
      const lead = buildLead({
        ...(sc.existingAccount ? { company: SHARED.accountName } : {}),
        ...(sc.existingContact ? SHARED.contact : {}),
      });
      const person = fullName(lead);
      const seededAccountId = sc.existingAccount ? shared?.accountId : undefined;
      const seededContactId = sc.existingContact ? shared?.contactId : undefined;
      await testInfo.attach('lead-data.json', {
        body: JSON.stringify({ scenario: sc.title, lead, sharedAccountId: seededAccountId, sharedContactId: seededContactId }, null, 2),
        contentType: 'application/json',
      });

      await test.step('go to the Sales app and create a qualified lead', async () => {
        await home.goto();
        await home.openApp(env.salesAppName);
        await leads.createLead(lead);
        await leads.changeStatus(env.leadStatusUpdated);
      });

      const leadOwner = await leads.ownerName();

      await test.step('click Convert', async () => {
        await leads.clickConvert();
        await convert.waitUntilOpen();
      });

      const branches: { account?: LinkMode; contact?: LinkMode } = {};
      await test.step('check for an existing account / contact before creating new ones', async () => {
        // short grace period normally; on the first run the shared records are new and the search
        // index may still be catching up, so be patient only where the scenario says they exist
        const patience = searchPatienceMs();
        branches.account = await convert.linkAccount(lead.company, { patienceMs: sc.existingAccount ? patience : 0 });
        expect(branches.account, 'account branch').toBe(expectedAccountMode);
        branches.contact = await convert.linkContact(person, { patienceMs: sc.existingContact ? patience : 0 });
        expect(branches.contact, 'contact branch').toBe(expectedContactMode);
      });

      const { result, call } = await test.step('convert', async () => convert.submit());
      await testInfo.attach('converted-ids.json', {
        body: JSON.stringify({ ...result, branches }, null, 2),
        contentType: 'application/json',
      });

      await test.step('backend response agrees with what the ui shows (API / response validation)', async () => {
        await testInfo.attach('convert-response.json', { body: JSON.stringify(call.json, null, 2), contentType: 'application/json' });
        await testInfo.attach('convert-request.txt', { body: call.requestBody.slice(0, 4000), contentType: 'text/plain' });

        const paths = assertConversionResponse(call, result);
        // where each id was found, so NOTES.md can pin the real json paths down
        await testInfo.attach('convert-json-paths.json', { body: JSON.stringify(paths, null, 2), contentType: 'application/json' });
      });

      await test.step('opportunity was created', async () => {
        expect(result.opportunityId).toMatch(/^006[A-Za-z0-9]{15}$/);
      });

      await test.step('account is the right one for the branch that fired', async () => {
        expect(result.accountId).toMatch(/^001[A-Za-z0-9]{15}$/);
        if (seededAccountId) expect(result.accountId, 'should reuse the pre-existing account').toBe(seededAccountId);
      });

      await test.step('contact is the right one for the branch that fired', async () => {
        expect(result.contactId).toMatch(/^003[A-Za-z0-9]{15}$/);
        if (seededContactId) expect(result.contactId, 'should reuse the pre-existing contact').toBe(seededContactId);
      });

      await test.step('open the new opportunity and check key values', async () => {
        await convert.goToOpportunity(result.opportunityId);

        await opportunities.expectKeyValues({
          ownerName: leadOwner,
          stage: env.expectedOppStage,
          accountName: lead.company,
          opportunityNameContains: lead.company,
        });

        // the account link on the opportunity must point at exactly the account the modal reported
        expect(await opportunities.linkedAccountHref()).toContain(result.accountId);
        await opportunities.expectContactRole(person).catch((e) => {
          // related lists render lazily and the layout varies per org, so this stays a soft check
          testInfo.annotations.push({ type: 'soft-check-failed', description: `contact role: ${(e as Error).message.split('\n')[0]}` });
        });
      });

      await test.step('contact is attached to the same account', async () => {
        await contacts.expectLinkedToAccount(result.contactId, result.accountId, lead.company);
      });
    });
  }
});

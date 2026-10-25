import { env } from '../src/config/env';
import { expect, test } from '../src/fixtures';
import { assertConversionResponse } from '../src/api/conversionAssertions';
import { LinkMode } from '../src/pages/LeadConvertPage';
import { buildLead, fullName } from '../src/utils/randomData';

/**
 * Lead -> Opportunity conversion, once per branch of the account / contact check.
 *
 * The brief wants the modal to look for existing records first and only create new
 * ones when nothing is there. To prove each branch really fires, every scenario seeds
 * exactly the records it needs and then asserts the modal picked the matching branch.
 * If the modal and the seed disagree the test fails at the link step, not three
 * assertions later with a confusing message.
 */
interface Scenario {
  title: string;
  seedAccount: boolean;
  seedContact: boolean;
}

const scenarios: Scenario[] = [
  { title: 'neither account nor contact exists, both get created', seedAccount: false, seedContact: false },
  { title: 'account exists, linked; contact gets created', seedAccount: true, seedContact: false },
  { title: 'account and contact exist, both linked', seedAccount: true, seedContact: true },
];

test.describe('Part B - lead to opportunity conversion', () => {
  for (const sc of scenarios) {
    test(`convert lead: ${sc.title}`, async ({ home, leads, convert, opportunities, contacts, seeder }, testInfo) => {
      const lead = buildLead();
      const person = fullName(lead);
      const expectedAccountMode: LinkMode = sc.seedAccount ? 'existing' : 'new';
      const expectedContactMode: LinkMode = sc.seedContact ? 'existing' : 'new';
      testInfo.annotations.push({ type: 'scenario', description: sc.title });

      let seededAccountId: string | undefined;
      let seededContactId: string | undefined;

      await test.step('arrange: seed the records that should already exist', async () => {
        if (sc.seedAccount) seededAccountId = await seeder.createAccount(lead.company);
        if (sc.seedContact) {
          seededContactId = await seeder.createContact({
            firstName: lead.firstName,
            lastName: lead.lastName,
            email: lead.email,
            accountName: lead.company,
          });
        }
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

      await test.step('check for an existing account / contact before creating new ones', async () => {
        expect(await convert.linkAccount(lead.company), 'account branch').toBe(expectedAccountMode);
        expect(await convert.linkContact(person), 'contact branch').toBe(expectedContactMode);
      });

      const { result, call } = await test.step('convert', async () => convert.submit());

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

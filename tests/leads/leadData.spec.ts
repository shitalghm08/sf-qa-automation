import { env } from '../../src/config/env';
import { expect, test } from '../../src/fixtures';
import {
  buildLead,
  LeadData,
  LEAD_SOURCES,
  MAX_COMPANY,
  MAX_FIRST_NAME,
  MAX_LAST_NAME,
  nameOfLength,
  uniqueSuffix,
} from '../../src/utils/randomData';

/**
 * Data variations the other specs don't touch: names that need escaping or are as long as the field
 * allows, and every Lead Source value the framework knows. Each one is created through the UI and
 * read back from the details page.
 *
 * Not on the @smoke list: it adds a few minutes and adds nothing to the WebKit check.
 */
interface Variation {
  title: string;
  make: (suffix: string) => LeadData;
}

const variations: Variation[] = [
  {
    title: 'apostrophes in the names',
    make: (s) => buildLead({ firstName: "D'Arcy", lastName: `O'Neil${s}` }),
  },
  {
    title: 'accented and hyphenated names',
    make: (s) => buildLead({ firstName: 'Zoë', lastName: `Müller-Ñandú${s}` }),
  },
  {
    title: 'company with an ampersand and a hyphen',
    make: (s) => buildLead({ company: `QA_AUTO Smith & Sons - Östlund ${s}` }),
  },
  {
    title: 'first, last name and company at their maximum length',
    make: (s) =>
      buildLead({
        firstName: nameOfLength('Longfirstname', '', MAX_FIRST_NAME),
        lastName: nameOfLength('Longlastname', s, MAX_LAST_NAME),
        company: nameOfLength('QA_AUTO Long Company ', s, MAX_COMPANY),
      }),
  },
];

test.describe('PartB-lead data variations', { tag: ['@data', '@regression'] }, () => {
  for (const v of variations) {
    test(`create a lead with ${v.title}`, async ({ home, leads }, testInfo) => {
      const lead = v.make(uniqueSuffix());
      testInfo.annotations.push({ type: 'variation', description: v.title });
      await testInfo.attach('lead-data.json', { body: JSON.stringify(lead, null, 2), contentType: 'application/json' });

      await test.step('go to the Sales app', async () => {
        await home.goto();
        await home.openApp(env.salesAppName);
      });

      await test.step('create the lead and save it', async () => {
        await leads.createLead(lead);
      });

      await test.step('details view shows the data exactly as entered', async () => {
        await leads.expectDetails(lead, env.leadStatusInitial);
      });
    });
  }

  test('every Lead Source value can be saved and read back', async ({ home, leads }, testInfo) => {
    // one create plus one edit per remaining value
    test.setTimeout(300_000);

    const [first, ...rest] = LEAD_SOURCES;
    const lead = buildLead({ leadSource: first });
    await testInfo.attach('lead-data.json', { body: JSON.stringify(lead, null, 2), contentType: 'application/json' });

    await test.step('create the lead with the first value', async () => {
      await home.goto();
      await home.openApp(env.salesAppName);
      await leads.createLead(lead);
      await leads.expectDetails(lead, env.leadStatusInitial);
    });

    for (const source of rest) {
      await test.step(`Lead Source: ${source}`, async () => {
        await leads.changeLeadSource(source);
        await expect.poll(() => leads.currentLeadSource(), { timeout: 15_000 }).toContain(source);
      });
    }
  });
});

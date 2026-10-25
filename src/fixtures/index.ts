import { test as base } from '@playwright/test';
import { ContactPage } from '../pages/ContactPage';
import { HomePage } from '../pages/HomePage';
import { LeadConvertPage } from '../pages/LeadConvertPage';
import { LeadPage } from '../pages/LeadPage';
import { OpportunityPage } from '../pages/OpportunityPage';
import { RecordSeeder } from '../pages/RecordSeeder';

type Pages = {
  home: HomePage;
  leads: LeadPage;
  contacts: ContactPage;
  convert: LeadConvertPage;
  opportunities: OpportunityPage;
  seeder: RecordSeeder;
};

/**
 * One place that builds page objects, so specs read as "what happens" and not as
 * "how do I construct things". Add new pages here as they appear.
 */
export const test = base.extend<Pages>({
  home: async ({ page }, use) => {
    await use(new HomePage(page));
  },
  leads: async ({ page }, use) => {
    await use(new LeadPage(page));
  },
  contacts: async ({ page }, use) => {
    await use(new ContactPage(page));
  },
  convert: async ({ page }, use) => {
    await use(new LeadConvertPage(page));
  },
  opportunities: async ({ page }, use) => {
    await use(new OpportunityPage(page));
  },
  seeder: async ({ page }, use) => {
    await use(new RecordSeeder(page));
  },
});

export { expect } from '@playwright/test';

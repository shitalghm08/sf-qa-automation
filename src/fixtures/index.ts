import { test as base } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { LeadPage } from '../pages/LeadPage';

type Pages = {
  home: HomePage;
  leads: LeadPage;
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
});

export { expect } from '@playwright/test';

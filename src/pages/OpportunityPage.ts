import { expect, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class OpportunityPage extends BasePage {
  field(api: string[], label: string): Locator {
    return this.recordField('Opportunity', api, label);
  }

  async openRecord(id: string): Promise<void> {
    await this.open(`/lightning/r/Opportunity/${id}/view`);
  }

  async expectKeyValues(expected: { ownerName: string; stage: string; accountName: string; opportunityNameContains: string }): Promise<void> {
    await this.openDetailsTab();

    await expect.soft(this.field(['Name'], 'Opportunity Name')).toContainText(expected.opportunityNameContains);
    await expect.soft(this.field(['OwnerId', 'Owner'], 'Opportunity Owner')).toContainText(expected.ownerName);
    await expect.soft(this.field(['StageName'], 'Stage')).toContainText(expected.stage);
    await expect.soft(this.field(['AccountId', 'Account'], 'Account Name')).toContainText(expected.accountName);
  }

  /** the href of the account link, used to prove the opportunity points at the exact record we expect */
  async linkedAccountHref(): Promise<string> {
    const link = this.field(['AccountId', 'Account'], 'Account Name').getByRole('link').first();
    return (await link.getAttribute('href')) ?? '';
  }

  /** contact roles live on the related tab; lazily rendered so this one is checked softly by the caller */
  async expectContactRole(contactFullName: string): Promise<void> {
    await this.page.getByRole('tab', { name: 'Related', exact: true }).click();
    const link = this.page.getByRole('link', { name: contactFullName }).first();
    try {
      // related lists load lazily, so give the list time to render
      await link.waitFor({ state: 'visible', timeout: 15_000 });
    } catch (err) {
      const lists = await this.page
        .locator('article h2, lst-related-list-container h2, lightning-card h2')
        .allInnerTexts()
        .catch(() => [] as string[]);
      const seen = [...new Set(lists.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean))];
      throw new Error(
        `Contact "${contactFullName}" not found on the Related tab. Related lists shown: [${seen.join(' | ')}]. ` +
          `Original error: ${(err as Error).message}`,
      );
    }
    await link.scrollIntoViewIfNeeded();
  }
}

import { expect, Locator } from '@playwright/test';
import { BasePage, exactLabel } from './BasePage';

export interface SignupData {
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  company: string;
  postalCode: string;
  role?: string;
  country?: string;
}

export const SIGNUP_URL = 'https://developer.salesforce.com/signup';

export class SignupPage extends BasePage {
  private field(label: string): Locator {
    return this.page.getByLabel(exactLabel(label)).first();
  }

  get submitButton(): Locator {
    return this.page.getByRole('button', { name: /sign me up/i });
  }

  async goto(): Promise<void> {
    await this.page.goto(SIGNUP_URL, { waitUntil: 'domcontentloaded' });
    await expect(this.page).toHaveURL(/developer\.salesforce\.com\/signup/);
    await expect(this.field('First Name')).toBeVisible();
  }

  async fill(data: SignupData): Promise<void> {
    await this.field('First Name').fill(data.firstName);
    await this.field('Last Name').fill(data.lastName);
    await this.field('Email').fill(data.email);
    await this.page.getByLabel(/^role/i).first().selectOption({ label: data.role ?? 'Developer' });
    await this.field('Company').fill(data.company);
    await this.page.getByLabel(/country/i).first().selectOption({ label: data.country ?? 'Singapore' });
    await this.field('Postal Code').fill(data.postalCode);
    await this.field('Username').fill(data.username);

    // terms of service checkbox
    await this.page.getByRole('checkbox').first().check();
    this.log.info('signup form filled', { username: data.username, email: data.email });
  }

  /**
   * Submitting is deliberately a separate step: the form sits behind a bot check
   * that I'm not going to script around. A human clicks through it when needed.
   */
  async submitAndWaitForConfirmation(timeoutMs = 5 * 60_000): Promise<void> {
    await this.submitButton.click();
    await expect(this.page.getByText(/check your email|thank you|verify your account/i).first()).toBeVisible({
      timeout: timeoutMs,
    });
  }
}

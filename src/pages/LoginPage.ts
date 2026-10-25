import { expect, Locator } from '@playwright/test';
import { env } from '../config/env';
import { waitForVerificationCode } from '../utils/mail';
import { BasePage } from './BasePage';
import { HomePage } from './HomePage';

type LoginOutcome = 'home' | 'verification' | 'error';

export class LoginPage extends BasePage {
  private get username(): Locator {
    return this.page.locator('#username');
  }
  private get password(): Locator {
    return this.page.locator('#password');
  }
  private get loginButton(): Locator {
    return this.page.locator('#Login');
  }
  private get errorBanner(): Locator {
    return this.page.locator('#error').filter({ visible: true });
  }

  // the "we sent you a code" page
  private get codeInput(): Locator {
    return this.page.locator('#emc').or(this.page.getByLabel(/verification code/i)).filter({ visible: true }).first();
  }
  private get verifyButton(): Locator {
    return this.page.locator('#save').or(this.page.getByRole('button', { name: /^verify$/i })).first();
  }

  /**
   * Full login. Handles the email verification step when salesforce asks for it,
   * and does NOT assume it will (a trusted ip or a remembered device skips it).
   */
  async login(username = env.username, password = env.password): Promise<{ usedVerification: boolean }> {
    this.log.info(`opening login page for ${username}`);
    await this.page.goto(`${env.loginUrl}/`, { waitUntil: 'domcontentloaded' });

    await this.username.fill(username);
    await this.password.fill(password);

    // the code mail is triggered by this click, so this is the earliest it can exist
    const submittedAt = new Date();
    await this.loginButton.click();

    let outcome = await this.waitForOutcome();
    let usedVerification = false;

    if (outcome === 'error') {
      const msg = (await this.errorBanner.innerText()).trim();
      throw new Error(`Salesforce rejected the login: "${msg}"`);
    }

    if (outcome === 'verification') {
      usedVerification = true;
      this.log.info('verification page shown, fetching the code from the mailbox');
      const code = await waitForVerificationCode({ since: submittedAt });

      await this.codeInput.fill(code);
      await this.verifyButton.click();

      outcome = await this.waitForOutcome();
      if (outcome !== 'home') {
        const msg = outcome === 'error' ? (await this.errorBanner.innerText()).trim() : 'still on verification page';
        throw new Error(`Verification code was not accepted: ${msg}`);
      }
    }

    await new HomePage(this.page).expectLoggedIn();
    this.log.info('login ok', { usedVerification });
    return { usedVerification };
  }

  /** wait for whichever of the three possible screens shows up first */
  private async waitForOutcome(): Promise<LoginOutcome> {
    const home = new HomePage(this.page).appLauncher.filter({ visible: true });
    await expect(
      home.or(this.codeInput).or(this.errorBanner).first(),
      'expected the home page, the verification page or a login error',
    ).toBeVisible({ timeout: 45_000 });

    if (await this.errorBanner.isVisible()) return 'error';
    if (await this.codeInput.isVisible()) return 'verification';
    return 'home';
  }
}

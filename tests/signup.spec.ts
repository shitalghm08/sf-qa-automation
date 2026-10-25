import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { env } from '../src/config/env';
import { SignupPage } from '../src/pages/SignupPage';
import { buildLead, plusAddress, uniqueSuffix } from '../src/utils/randomData';

/**
 * Part A (steps 1-2). Opt-in, not a regression test: you only need a developer org once.
 *
 *   npm run signup:fill                 -> opens the form and fills it, stops before submitting
 *   SF_SIGNUP_SUBMIT=1 npm run signup:fill -> also clicks "Sign me up" and waits while you handle the bot check
 *
 * The activation email (set password link) is opened by hand, once.
 */
test.skip(!process.env.SF_SIGNUP, 'opt-in: use `npm run signup:fill`');

test('register a new developer org (form fill, submit is opt-in)', async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);

  const s = uniqueSuffix();
  const person = buildLead();
  const data = {
    firstName: person.firstName,
    lastName: `Dev${s}`,
    // verification / activation mail lands in the mailbox the framework already reads
    email: plusAddress(env.mail.user, `sfdev${s}`),
    // usernames only need to be email shaped and globally unique, no real mailbox behind them
    username: `qa.${s}@sfqa-dev.example.org`,
    company: 'QA Automation Practice',
    postalCode: '238823',
  };

  const signup = new SignupPage(page);

  await test.step('open the developer signup page', async () => {
    await signup.goto();
  });

  await test.step('fill in the form', async () => {
    await signup.fill(data);
    await testInfo.attach('signup-form-filled', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  // write the username down, it is needed for .env afterwards
  const note = path.resolve(__dirname, '../logs/signup-username.txt');
  fs.mkdirSync(path.dirname(note), { recursive: true });
  fs.writeFileSync(note, `${data.username}\n`);

  if (!process.env.SF_SIGNUP_SUBMIT) {
    testInfo.annotations.push({ type: 'note', description: 'form filled but not submitted (SF_SIGNUP_SUBMIT not set)' });
    return;
  }

  await test.step('submit (complete the bot check by hand if it shows up)', async () => {
    await signup.submitAndWaitForConfirmation();
  });
});

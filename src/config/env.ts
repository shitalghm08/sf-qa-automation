import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Everything environment-specific lives here. Values are read lazily (getters)
 * so `playwright test --list` and `tsc` still work on a fresh clone without a .env.
 */
function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `Missing env var ${name}. Copy .env.example to .env and fill it in (see README, "Setup").`,
    );
  }
  return v.trim();
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

export const env = {
  // --- org / login ---
  get lightningUrl() {
    // e.g. https://orgfarm-abc123-dev-ed.develop.lightning.force.com (no trailing slash)
    return required('SF_LIGHTNING_URL').replace(/\/+$/, '');
  },
  get loginUrl() {
    return optional('SF_LOGIN_URL', 'https://login.salesforce.com').replace(/\/+$/, '');
  },
  get username() {
    return required('SF_USERNAME');
  },
  get password() {
    return required('SF_PASSWORD');
  },

  // --- mailbox used to read the verification code (see README, "Email verification") ---
  get mail() {
    return {
      host: optional('MAIL_IMAP_HOST', 'imap.gmail.com'),
      port: Number(optional('MAIL_IMAP_PORT', '993')),
      user: required('MAIL_USER'),
      appPassword: required('MAIL_APP_PASSWORD'),
      otpTimeoutMs: Number(optional('OTP_TIMEOUT_MS', '90000')),
    };
  },
  get hasMailConfig() {
    return Boolean(process.env.MAIL_USER && process.env.MAIL_APP_PASSWORD);
  },

  // --- org-dependent expectations. Orgs differ, so none of this is hardcoded in tests ---
  get salesAppName() {
    return optional('SF_SALES_APP_NAME', 'Sales');
  },
  get leadStatusInitial() {
    return optional('LEAD_STATUS_INITIAL', 'Unqualified');
  },
  get leadStatusUpdated() {
    return optional('LEAD_STATUS_UPDATED', 'Qualified');
  },
  get expectedOppStage() {
    // first stage of the default sales process; change it if your org differs
    return optional('OPP_EXPECTED_STAGE', 'Prospecting');
  },

  // --- misc ---
  get logLevel() {
    return optional('LOG_LEVEL', 'info');
  },
  get sessionMaxAgeHours() {
    return Number(optional('SESSION_MAX_AGE_HOURS', '10'));
  },
};

/** where cached sessions live, one file per browser engine */
export function storageStatePath(browser: string): string {
  return path.resolve(__dirname, '../../auth', `state.${browser}.json`);
}

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { env } from '../config/env';
import { getLogger, mask } from './logger';

const log = getLogger('mail');

// codes we already handed out in this process. Salesforce mails can sit in the inbox for a while
const usedCodes = new Set<string>();

// Gmail files some automated mail under spam, so look there as well
const FOLDERS = ['INBOX', '[Gmail]/Spam'];

const CODE_PATTERNS = [
  /verification\s+code\s*[:\-]?\s*(\d{6})/i,
  /code\s*[:\-]\s*(\d{6})/i,
  /\b(\d{6})\b/, // last resort, only used on mails that already passed the sender/subject filter
];

/** html-only mails: drop style/script/tags so colour codes and pixel values can't look like a code */
function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ');
}

export function extractCode(text: string): string | null {
  for (const re of CODE_PATTERNS) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

interface OtpOptions {
  /** only consider mail that arrived after this moment (clock skew allowance is added) */
  since: Date;
  timeoutMs?: number;
  pollEveryMs?: number;
}

async function scanOnce(since: Date): Promise<string | null> {
  const { host, port, user, appPassword } = env.mail;
  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user, pass: appPassword },
    logger: false,
  });
  // without a listener an 'error' event (socket reset, timeout) is an uncaught exception
  client.on('error', (err: Error) => log.warn(`imap connection error: ${err.message}`));

  await client.connect();
  try {
    for (const folder of FOLDERS) {
      let lock;
      try {
        lock = await client.getMailboxLock(folder);
      } catch {
        continue; // folder doesn't exist on this provider
      }

      try {
        // IMAP SINCE only understands days, the exact cut-off is applied below
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const found = await client.search({ since: dayAgo, from: 'salesforce.com' }, { uid: true });
        const uids = Array.isArray(found) ? found : [];

        // newest first
        for (const uid of uids.sort((a, b) => b - a)) {
          const msg = await client.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true });
          if (!msg || !msg.source) continue;

          const arrived = new Date(msg.internalDate as Date | string);
          if (arrived.getTime() < since.getTime()) {
            log.debug(`skip uid ${uid} in ${folder}: older than the login click`, { arrived: arrived.toISOString() });
            continue;
          }

          const parsed = await simpleParser(msg.source);
          const subject = parsed.subject ?? '';
          if (!/verif|identity|code/i.test(subject)) {
            log.debug(`skip uid ${uid} in ${folder}: subject "${subject}" doesn't look like a verification mail`);
            continue;
          }

          const body = parsed.text?.trim() || htmlToText(parsed.html || '');
          const code = extractCode(body);
          if (code && !usedCodes.has(code)) {
            log.info(`found verification mail "${subject}" in ${folder}`, { code: mask(code, 1) });
            return code;
          }
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return null;
}

/**
 * Poll the mailbox until a fresh Salesforce verification code shows up.
 * Resolves with the 6 digit code, throws on timeout with a message that says what we were waiting for.
 */
export async function waitForVerificationCode(opts: OtpOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? env.mail.otpTimeoutMs;
  const pollEveryMs = opts.pollEveryMs ?? 5_000;
  // allow a little skew between this machine and the mail server clock
  const since = new Date(opts.since.getTime() - 15_000);
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let lastError: unknown;

  log.info(`waiting for verification code (up to ${Math.round(timeoutMs / 1000)}s)`, { since: since.toISOString() });

  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const code = await scanOnce(since);
      if (code) {
        usedCodes.add(code);
        return code;
      }
      log.debug(`poll #${attempt}: nothing yet`);
    } catch (err) {
      // transient imap hiccups shouldn't kill the run, auth errors will keep repeating and end up in the timeout message
      if ((err as { authenticationFailed?: boolean }).authenticationFailed) {
        // the same credentials will fail on every poll, so don't wait out the timeout
        throw new Error(
          `Gmail rejected MAIL_USER / MAIL_APP_PASSWORD for ${env.mail.user}. ` +
            'Check that IMAP is enabled and the app password is correct (16 chars, no spaces).',
        );
      }
      lastError = err;
      log.warn(`poll #${attempt} failed: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, pollEveryMs));
  }

  throw new Error(
    `No Salesforce verification code arrived within ${timeoutMs}ms for ${env.mail.user}` +
      (lastError ? ` (last imap error: ${(lastError as Error).message})` : ''),
  );
}

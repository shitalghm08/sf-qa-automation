# Salesforce CRM - Playwright test automation

UI automation for the Salesforce Sales app (Lead creation, edit, conversion into an Opportunity, a couple of negative cases), written in Playwright + TypeScript. Built for the GovTech QA assessment.

The things I cared about most while building it: no `sleep()`s, locators that don't depend on generated ids, a page-object layer that specs can read like a story, and a login that copes with Salesforce's email verification instead of pretending it doesn't exist.

Extra notes (shadow DOM evidence, API discovery, debugging log) live in [NOTES.md](./NOTES.md).

---

## Contents

- [Project layout](#project-layout)
- [Setup](#setup)
- [Running the tests](#running-the-tests)
- [Viewing the report](#viewing-the-report)
- [How it is put together](#how-it-is-put-together)
- [Email verification code on login](#email-verification-code-on-login-part-cb)
- [Test data strategy](#test-data-strategy)
- [CI](#ci)
- [Things that depend on your org](#things-that-depend-on-your-org)

---

## Project layout

```
playwright.config.ts        projects, reporters, timeouts
.env.example                every setting the framework reads
src/
  config/env.ts             env loading, one place for org-specific values
  utils/
    logger.ts               leveled logger -> console + logs/run.log
    randomData.ts           unique lead data per run / worker
    mail.ts                 IMAP poller that reads the verification code
    deepFind.ts             walks JSON looking for ids (used for API checks)
  pages/
    BasePage.ts             waits, record-field locator, overflow-menu actions
    components/             LightningCombobox, LightningLookup (shadow DOM helpers)
    LoginPage.ts  HomePage.ts  SignupPage.ts
    LeadPage.ts  LeadConvertPage.ts  OpportunityPage.ts  ContactPage.ts
    RecordSeeder.ts         creates the pre-existing Account / Contact
  api/
    conversionCapture.ts    listens for the convert call and parses it
    conversionAssertions.ts asserts on the response
  fixtures/index.ts         page objects as fixtures
tests/
  auth.setup.ts             login + session cache (runs before everything else)
  login.spec.ts             Part A
  lead.spec.ts              Part B - create / validate / edit
  leadConversion.spec.ts    Part B - conversion (3 branches) + API validation
  negative.spec.ts          Part B - negative scenarios
  fresh-login.spec.ts       opt-in, full login with email code
  signup.spec.ts            opt-in, developer signup form
  unit/utils.spec.ts        offline tests for the helpers
```

## Setup

You need Node 20+ (I used 22) and a Gmail account (or any IMAP mailbox, see below).

```bash
git clone <this repo>
cd sf-qa-automation
npm install
npx playwright install chromium webkit
cp .env.example .env      # then fill it in
```

### 1. Get a developer org (once)

Go to https://developer.salesforce.com/signup. If you want the form filled for you:

```bash
npm run signup:fill                    # fills the form, does not submit
SF_SIGNUP_SUBMIT=1 npm run signup:fill # submits too, you deal with the bot check by hand
```

I don't automate the bot check on purpose. Activation (the "set your password" link in the email) is done manually, once, as the brief allows.

Tip: sign up with a plus address of your mailbox (`you+sfdev@gmail.com`). The verification mails then land in the inbox the framework already reads.

### 2. Mailbox for the verification code

For Gmail: turn on 2-step verification, then create an **App Password** (Google Account > Security > App passwords) and put it in `MAIL_APP_PASSWORD`. Never use the real account password. Details and trade-offs are further down.

### 3. Fill in `.env`

The important ones: `SF_LIGHTNING_URL` (the `...lightning.force.com` address you land on after logging in), `SF_USERNAME`, `SF_PASSWORD`, `MAIL_USER`, `MAIL_APP_PASSWORD`. Everything else has a default.

## Running the tests

```bash
npm test                  # everything that is part of the normal suite (see projects below)
npm run test:chromium     # full suite, chromium only
npm run test:smoke        # @smoke tests on chromium + webkit
npm run test:headed       # watch it work
npm run test:unit         # offline helper tests, no org needed
npm run test:fresh-login  # full login incl. email code, no cached session
```

Run a single test: `npx playwright test -g "account and contact exist" --project=chromium`.

Playwright projects:

| project | what it does |
|---|---|
| `setup-chromium` / `setup-webkit` | log in (if the cached session is no good) and write `auth/state.<engine>.json` |
| `chromium` | the full suite, uses the cached session |
| `webkit-smoke` | only tests tagged `@smoke`, uses the webkit session |
| `fresh-login`, `signup` | opt-in, skipped unless you start them via the npm scripts |
| `unit` | offline helper tests |

The first run does a real login, so it takes longer (and fetches the email code). After that the cached session is reused until it expires or stops working.

## Viewing the report

```bash
npm run report            # opens playwright-report/ in the browser
```

What you get after a run:

- `playwright-report/index.html` - HTML report with steps, attachments (lead data, convert response JSON), traces on retry, screenshots + video for failures
- `test-results/report.json` and `test-results/junit.xml` - for tooling
- `logs/run.log` - timestamped, per-worker log lines (`[w2] INFO LoginPage: login ok`)

Every spec is written with `test.step(...)`, so the report reads as a list of what happened rather than a wall of locator calls.

## How it is put together

**Page objects.** One class per page/area, specs never touch a locator directly. `BasePage` holds the shared bits: waiting for Lightning to go idle (spinners gone), finding a record field, and clicking record actions that sometimes hide in the "Show more actions" menu. Page objects are handed to specs as fixtures (`src/fixtures`).

**Locators.** Role + accessible name wherever possible, then Salesforce's own stable hooks (`data-target-selection-name="sfdc:RecordField.Lead.Company"` for detail fields, `data-label` on App Launcher tiles). Nothing relies on generated ids or css class chains. Playwright already looks through open shadow roots, so most Lightning components work with plain role locators; the places where that isn't enough are explained in NOTES.md (Part C).

**Waiting.** No fixed sleeps anywhere. Everything is either a web-first assertion, `waitForURL`, `waitForResponse`, or a race between the possible outcomes (e.g. after clicking Save: saved / duplicate alert / validation errors).

**Config.** Org specific values (lead status names, expected opportunity stage, app name) are env vars, not constants in the tests.

**Parallelism.** `fullyParallel` is on. Each test builds its own lead with a unique suffix (timestamp + worker index + counter), so two workers can never collide, and nothing depends on another test having run.

**Cross browser.** Chromium runs everything, WebKit runs the `@smoke` set. Each engine has its own cached session, created one after the other (running two logins at once would mean two verification mails at once).

## Email verification code on login (Part C.b)

Salesforce asks for a code whenever it sees a browser it doesn't recognise. That applies to the very first Playwright login, to a deleted/expired `storageState`, and to every fresh CI runner.

**What I implemented**

1. `LoginPage.login()` submits the credentials and then waits for whichever screen comes next: home, the verification page, or an error. It does not assume a code will be asked for.
2. If the verification page shows up, `mail.ts` connects over IMAP, looks for mail from `salesforce.com` that arrived after the login click (with a small clock-skew allowance), parses the 6 digit code, and the page object submits it. It polls with a timeout and a readable error message instead of hanging.
3. After a successful login, the session is written to `auth/state.<engine>.json`.
4. On the next run `auth.setup.ts` does not just check the file exists. It opens the org with the cached session and checks the App Launcher actually renders. If that fails (expired, password changed, admin killed the session, file deleted on a CI runner) it throws the cache away and logs in again, code and all. There's also a max age (`SESSION_MAX_AGE_HOURS`) so I don't keep trusting very old files.

**Why a real mailbox over IMAP**

I looked at four ways of doing this:

| approach | good | bad |
|---|---|---|
| **IMAP on a real mailbox (chosen)** | Works with any org with zero Salesforce changes, tests the login exactly as a user experiences it, free | The CI needs mailbox credentials; depends on mail delivery speed; Gmail needs an app password |
| Disposable inbox service (Mailosaur, MailSlurp...) | Clean API, isolated from anyone's real mail, nice for teams | Extra vendor / cost / free-tier limits; public ones (mailinator style) are readable by anyone, which is not OK for a code that opens a login; some disposable domains get rejected by signup forms |
| Trusted IP range / login IP ranges in the org | No email involved at all, fastest | Only works from known IPs (GitHub hosted runners don't have one), and it deliberately weakens the org's security, so only OK for a throwaway dev org |
| Skip the UI login: OAuth/JWT token + `frontdoor.jsp?sid=` | Very robust in CI, no mail | Needs a connected app + certificate set up in the org (newer orgs restrict this by default), and it no longer tests the login screen |

I went with IMAP because the brief wants a real UI login and a framework that still works when the cache is gone. The costs I'm accepting:

- The app password can read that whole mailbox. Mitigation: use a dedicated mailbox just for this, keep the app password only in CI secrets / local `.env`, rotate it, and the code only ever searches for mail from `salesforce.com`.
- Mail latency makes login slow and occasionally flaky. Mitigation: 90s default timeout, polling every few seconds, one retry in CI, and the code is only needed when the cache is invalid.
- Codes are masked in the logs, and a code already used by this process is never handed out twice.

If this were a team setup I'd probably move to the disposable-inbox API (per-run inbox, no personal mailbox in CI) or to the JWT approach for CI and keep the IMAP route for the one test that covers the real login screen (`npm run test:fresh-login`).

## Test data strategy

- **The lead under test is created through the UI**, because creating and saving a lead is the thing being tested.
- **Pre-existing Account / Contact** (for the "already exists" conversion branches) are also created through the UI, using `RecordSeeder`. API seeding would be faster, but it needs a connected app / OAuth token in the org, which is one more manual setup step for whoever clones this. I preferred a repo that works with just a username, password and mailbox. If runs get slow the seeder is the single place to swap for REST calls.
- Everything is prefixed `QA_AUTO` and carries a unique suffix. That is what makes parallel runs safe, and it also makes leftovers easy to find and delete from a list view.
- No cleanup step yet. A dev org is disposable, but it is the first thing I'd add (delete by `QA_AUTO` prefix in a global teardown).

## CI

`.github/workflows/playwright.yml` type-checks, installs browsers, runs chromium + webkit smoke, and uploads the report. Secrets needed: `SF_LIGHTNING_URL`, `SF_USERNAME`, `SF_PASSWORD`, `MAIL_USER`, `MAIL_APP_PASSWORD`. A fresh runner has no cached session, so the pipeline goes through the verification-code path every time.

## Things that depend on your org

Developer orgs are not all identical, so a few expectations are configurable:

- Lead status values. Newer orgs have `Unqualified` / `Qualified`, older ones use `Open - Not Contacted` etc. Set `LEAD_STATUS_INITIAL` / `LEAD_STATUS_UPDATED`. If a value doesn't exist the error message lists the options that are on screen.
- First opportunity stage after conversion (`OPP_EXPECTED_STAGE`, default `Prospecting`).
- Duplicate detection. The duplicate-lead test skips itself (and says why in the report) if the org has no active lead duplicate rule.
- Address fields on the lead are not filled in. The compound address component is its own can of worms and I decided it wasn't worth the flakiness for this scope.
- The conversion modal's exact markup is the part of Lightning I'd expect to change between releases; all of it is isolated in `LeadConvertPage.ts`.

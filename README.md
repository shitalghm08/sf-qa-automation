# Salesforce CRM - Playwright test automation

UI automation for the Salesforce Sales app (Lead creation, edit, conversion into an Opportunity, a couple of negative cases), written in Playwright + TypeScript. Built for the GovTech QA assessment.

The important thing considered while building it: no `sleep()`s, locators that don't depend on generated ids, a page-object layer that specs can read like a story, and a login that copes with Salesforce's email verification instead of pretending it doesn't exist.

Extra notes (shadow DOM evidence, API discovery, debugging log) live in [NOTES.md](./NOTES.md). How the framework is layered, in which order a run happens and where results go is in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), with diagrams.

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
- [Things that depend on the org](#things-that-depend-on-the-org)
- [Troubleshooting](#troubleshooting)

---

## Project layout

```
playwright.config.ts        projects, reporters, timeouts
.nvmrc                      Node version (22), see Setup
.env                        settings, not committed (see Setup, step 3)
src/
  config/env.ts             env loading, one place for org-specific values
  utils/
    logger.ts               leveled logger -> console + logs/run.log
    randomData.ts           unique lead data per run / worker
    sharedData.ts           the shared Account / Contact for the "already exists" scenarios
    mail.ts                 IMAP poller that reads the verification code
    deepFind.ts             walks JSON looking for ids (used for API checks)
  pages/
    BasePage.ts             waits, record-field locator, overflow-menu actions
    components/             LightningCombobox, LightningLookup (shadow DOM helpers)
    LoginPage.ts  HomePage.ts  SignupPage.ts
    LeadPage.ts  LeadConvertPage.ts  OpportunityPage.ts  ContactPage.ts
    RecordSeeder.ts         creates the shared Account / Contact (once)
  api/
    conversionCapture.ts    listens for the convert call and parses it
    conversionAssertions.ts asserts on the response
  fixtures/index.ts         page objects as fixtures
tests/
  setup/
    auth.setup.ts           login + session cache (runs before everything else)
    shared-data.setup.ts    creates the shared Account / Contact once, reuses them afterwards
  auth/
    login.spec.ts           Part A
    fresh-login.spec.ts     opt-in, full login with email code
    signup.spec.ts          opt-in, developer signup form
  leads/
    lead.spec.ts            Part B - create / validate / edit
    leadData.spec.ts        Part B - data variations: odd names, long names, every Lead Source
    negative.spec.ts        Part B - negative scenarios
  conversion/
    leadConversion.spec.ts  Part B - conversion (3 branches) + API validation
  unit/utils.spec.ts        offline tests for the helpers
docs/
  ARCHITECTURE.md           layers, project order and the flow of a run, with diagrams
  evidence/                 DevTools screenshot for NOTES.md
```

## Setup

We need Node 20+ (I used 22; the version is pinned in `.nvmrc`, and `engines` in `package.json` requires 20 or newer) and a Gmail account (or any IMAP mailbox, see below).

```bash
git clone <this repo>
cd sf-qa-automation
npm install
npx playwright install chromium webkit
# then create .env file, see step 3 below
```

Works on Windows, macOS and Linux. The npm scripts that set an environment variable go through `cross-env`, so they run in PowerShell and cmd as well.

### 1. Get a developer org (once)

Go to https://developer.salesforce.com/signup. If willing to the form filled:

```bash
npm run signup:fill                    # fills the form, does not submit
SF_SIGNUP_SUBMIT=1 npm run signup:fill # submits too
```

Activation (the "set the password" link in the email) is done manually, once.


### 2. Mailbox for the verification code

For Gmail: turn on 2-step verification, then create an **App Password** (Google Account > Security > App passwords) and put it in `MAIL_APP_PASSWORD` (16 characters, no spaces). Also enable IMAP (Gmail > Settings > Forwarding and POP/IMAP). Never use the real account password. Details and trade-offs are further down.

**Check how Salesforce sends the code.** It goes to the email address on the user record, but only if the user has no verified mobile number. If there is one, Salesforce sends an SMS instead ("we texted a code to +** ****1234" on the verification page) and there is nothing for the framework to read. In that case clear the mobile number on the user (profile > Settings > Advanced User Details) and the verified number under identity verification, and make sure the user's email is the mailbox in `MAIL_USER`.

### 3. Create `.env`

Create a file called `.env` in the project root. It is gitignored, not to commit it. This is every setting the framework reads, with placeholder values:

```ini
# ---- Org ----
# the lightning domain land on after logging in manually, no trailing slash
SF_LIGHTNING_URL=https://the-org-dev-ed.develop.lightning.force.com
SF_LOGIN_URL=https://login.salesforce.com
SF_USERNAME=user***@example.com
SF_PASSWORD=*********

# ---- Mailbox for the email verification code ----
# Gmail: turn on 2FA, then create an App Password (16 chars). Do NOT use real password.
MAIL_IMAP_HOST=imap.gmail.com
MAIL_IMAP_PORT=993
MAIL_USER=user***@gmail.com
MAIL_APP_PASSWORD=**************
OTP_TIMEOUT_MS=90000

# ---- Org specific expectations ----
SF_SALES_APP_NAME=Sales
# standard lead statuses. 
LEAD_STATUS_INITIAL=Open - Not Contacted
LEAD_STATUS_UPDATED=Working - Contacted
OPP_EXPECTED_STAGE=Prospecting

# ---- Misc ----
LOG_LEVEL=info
# cached session older than this is thrown away without even checking it
SESSION_MAX_AGE_HOURS=10
```

The important ones: `SF_LIGHTNING_URL` (the `...lightning.force.com` address to land on after logging in; only its origin is used, so pasting a full page url is fine), `SF_LOGIN_URL` (user's My Domain login address if have one), `SF_USERNAME`, `SF_PASSWORD`, `MAIL_USER`, `MAIL_APP_PASSWORD`. Everything else has a default.

## Running the tests

```bash
npm test                  # everything that is part of the normal suite (see projects below)
npm run test:chromium     # full suite, chromium only
npm run test:smoke        # @smoke tests on chromium + webkit
npm run test:regression   # everything tagged @regression, chromium only
npm run test:negative     # only the tests that expect Salesforce to refuse something
npm run test:headed       # watch it work
npm run test:unit         # offline helper tests, no org needed
npm run test:fresh-login  # full login incl. email code, no cached session
```

Tests carry tags (Playwright's `{ tag: [...] }` option, set on the `describe` block), so a slice of the suite can be selected with `--grep`:

| tag | what it selects | where |
|---|---|---|
| `@smoke` | the fast check that the session and lead creation work. Runs on Chromium and WebKit | `login.spec`, `lead.spec` |
| `@regression` | the whole functional suite (setup and opt-in specs are not part of it) | all of `auth/login`, `leads/`, `conversion/` |
| `@negative` | tests where Salesforce is expected to refuse something | `negative.spec` |
| `@data` | data variations (odd names, maximum lengths, every Lead Source) | `leadData.spec` |

A test can carry several tags, and `--grep "@smoke|@negative"` selects either. Tags are not written into the test titles, so a title stays stable when the tags change.

Run a single test: `npx playwright test -g "account and contact exist" --project=chromium`.

### Replaying a run

The random test data is seeded. The first line of every run prints the seed:

```
TEST_SEED=1988347801
```

To get the same random picks again (first name, job title, phone, employees count, and the Lead Source / Industry / Rating combination), set it and run the failing test:

```bash
TEST_SEED=1988347801 npx playwright test -g "account exists" --project=chromium          # bash
$env:TEST_SEED=1988347801; npx playwright test -g "account exists" --project=chromium    # PowerShell
```

The seed is also written to `logs/run.log` (`random data seed (TEST_SEED)`) and to the run's folder in `runs/`, which is named after it. What is not replayed is the unique suffix in the names, company and email: it carries a timestamp on purpose, so a replay never collides with the records the original run left in the org.

Playwright projects:

| Project | Purpose |
|---|---|
| `setup-chromium` / `setup-webkit` | log in (if the cached session is no good) and write `auth/state.<engine>.json` |
| `seed-shared` | creates (once) the Account and Contact the "already exists" conversion scenarios link to, stores their ids in `auth/shared-data.json` |
| `chromium` | the full suite, uses the cached session, runs after `seed-shared` |
| `webkit-smoke` | only tests tagged `@smoke`, uses the webkit session |
| `fresh-login`, `signup` | opt-in, skipped unless it is started via the npm scripts |
| `unit` | offline helper tests |

The first run does a real login, so it takes longer (and fetches the email code). After that the cached session is reused until it expires or stops working.

The first run also creates the shared Account / Contact (see Test data strategy). The two "already exists" conversion scenarios may then wait a few minutes for the new records to show up in Salesforce search. Later runs don't.

For more detail in `logs/run.log` set `LOG_LEVEL=debug` in `.env`. It adds the field hooks Lightning rendered on each details tab and, for the login, why each mail in the mailbox was skipped.

`npm test` reports 2 skipped tests. Those are `fresh-login` and `signup`, which are opt-in on purpose.

## View Test Report

```bash
npm run report            # opens playwright-report/ in the browser
```

Test Run Outcome:

- `playwright-report/index.html` - HTML report with steps, attachments (lead data, convert response JSON), traces on retry, screenshots + video for failures
- `test-results/report.json` and `test-results/junit.xml` - for tooling
- `logs/run.log` - timestamped, per-worker log lines (`[w2] INFO LoginPage: login ok`)
- `runs/` - **every run, kept.** Playwright empties `test-results/` and rewrites `playwright-report/` at the start of each run, so those two only ever show the latest one. At the end of a run a copy of both is archived into `runs/<start time>_seed<seed>/`, together with the data the tests used. `runs/index.csv` has one line per run (start, seed, status, passed / failed / skipped, folder, and a note that stays empty unless the archive is incomplete)

### Keeping earlier runs

```
runs/
  index.csv                                   one line per run
  2026-10-26T14-00-04-166Z_seed1164254557/
    test-data.json                            what each test used and created
    playwright-report/                        the HTML report of that run
    test-results/                             screenshots, videos, traces, junit.xml, report.json
```

Open an earlier report with `npx playwright show-report runs/<folder>/playwright-report`, and a trace with `npx playwright show-trace runs/<folder>/test-results/<test>/trace.zip`. The usual places keep working and keep showing the latest run: `npm run report`, `test-results/` and `--last-failed`.

**Passing tests are kept as well as failing ones.** By default every test leaves a screenshot (taken at the end), a video and a trace, so a green run can be looked at afterwards, not only a red one. The trade-off is size and a little speed: expect tens of megabytes per run, twice over, because the HTML report holds its own copy of the videos and traces. `ARTIFACTS=failures npm test` switches back to keeping them only for failures (and a trace on retry).

The two login tests (`auth.setup` and `fresh-login`) never record a trace. A trace stores what was typed and the request bodies, which would put the Salesforce password and the email code in a file that is easy to pass around. Their screenshots and videos show the password field masked.



### Recorded for each run

Each run's `test-data.json` has the run (start, duration, status, the seed, the command line, which projects ran), the totals, and for every test its status, duration, annotations and the data it used:

| test | recorded |
|---|---|
| `lead.spec`, `leadData.spec` | the full lead as typed in (name, company, email, phone, website, picklists, employees), the lead's 18-character id |
| `leadConversion.spec` | the scenario, the lead, the shared Account / Contact ids it linked to, the ids the conversion produced (account, contact, opportunity) and which branch the modal took for each |
| `negative.spec` | what was typed into the form and which fields had to be flagged, or the original lead of the duplicate test |
| `shared-data.setup` | the shared Account and Contact ids, and whether they were reused or created |

Use it to find what a run left in the org (the ids and the `QA_AUTO` names) when cleaning up, and together with the seed to replay a run (see "Replaying a run"). The raw convert request and response are not in that file, they are in the HTML report next to it.

Every spec is written with `test.step(...)`, so the report reads as a list of what happened rather than a wall of locator calls.

## How it is put together

**Page objects.** One class per page/area, specs never touch a locator directly. `BasePage` holds the shared bits: waiting for Lightning to go idle (spinners gone), finding a record field, and clicking record actions that sometimes hide in the "Show more actions" menu. Page objects are handed to specs as fixtures (`src/fixtures`).

**Locators.** Role + accessible name wherever possible, then Salesforce's own stable hooks (`data-target-selection-name="sfdc:RecordField.Lead.Company"` for detail fields, `data-label` on App Launcher tiles). Nothing relies on generated ids or css class chains. Playwright already looks through open shadow roots, so most Lightning components work with plain role locators; the places where that isn't enough are explained in NOTES.md (Part C).

**Waiting.** No fixed sleeps in any UI interaction (the only timed delay in the whole repo is the poll interval while waiting for the verification mail). Everything is either a web-first assertion, `waitForURL`, `waitForResponse`, or a race between the possible outcomes (e.g. after clicking Save: saved / duplicate alert / validation errors).

**Config.** Org specific values (lead status names, expected opportunity stage, app name) are env vars, not constants in the tests.

**Parallelism.** `fullyParallel` is on. Each test builds its own lead with a unique suffix (timestamp + worker index + counter), so two workers can never collide. The only shared data is the one Account / Contact that the "already exists" conversion scenarios read from (see Test data strategy); tests never modify it.

**Cross browser.** Chromium runs everything, WebKit runs the `@smoke` set. Each engine has its own cached session, created one after the other (running two logins at once would mean two verification mails at once). WebKit gets longer action / expect timeouts because Lightning modals render noticeably slower there.

**Things Lightning does that the page objects have to cope with.** All of these showed up against a real org, the story of each is in NOTES.md:

- The login can be username-first: enter the username, click Log In, and only then does the password field appear.
- Record urls can be `/lightning/r/<id>/view` with no object name in them, so url checks make that part optional.
- While a popover is open ("We hit a snag", "Similar Records Exist") Lightning takes the form out of the accessibility tree, so role locators cannot see it. For that moment the form, the inline errors and Cancel are found with text / css locators.
- The duplicate alert can appear while the form is still being filled, and afterwards the button may read "Save (Ignore Alert)". The picklists are filled before the fields the duplicate rule watches, and `createLead` saves again when the alert only warns.
- A picklist near the bottom of a modal closes if the modal scrolls, so it is scrolled to the middle before it is opened.
- The Convert Lead modal here is radio based (Create New / Choose Existing, each with its own search box). The search dropdown has a "Search for matching ... in Account" row that looks like a hit and isn't one; lookups skip rows like that.
- The convert call is picked out of the page's `/aura` traffic by the action descriptor (`convertLead...`), not by the word "convert", because Lightning's telemetry mentions it as well.

## Email verification code on login (Part C.b)

Salesforce asks for a code whenever it sees a browser it doesn't recognise. That applies to the very first Playwright login, to a deleted/expired `storageState`, and to every fresh CI runner. The code goes by email only when the user has no verified mobile number; with one, Salesforce sends an SMS, which this approach cannot read (see Setup, step 2).

**What I implemented**

1. `LoginPage.login()` submits the credentials and then waits for whichever screen comes next: home, the verification page, or an error. It does not assume a code will be asked for.
2. If the verification page shows up, `mail.ts` connects over IMAP, looks for mail from `salesforce.com` that arrived after the login click (with a small clock-skew allowance), parses the 6 digit code, and the page object submits it. It polls with a timeout and a readable error message instead of hanging.
   The code is read from the plain-text body (or from the tag-stripped html), so a colour code or pixel value in the html can't be mistaken for it. A wrong app password, or IMAP switched off, stops the wait straight away with a message that says so instead of waiting out the timeout.
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
- **How the lead data is chosen.** Every value is valid for the field and unique per test, so a failure points at the application and not at the data. Names, company and email carry a unique suffix and the `QA_AUTO` prefix; the email uses the reserved `example.com` domain; the picklist values are ones that exist in the default org; the employee count stays under 1000 so there is no thousands separator to trip over. The random picks come from a seeded generator, see "Replaying a run".
- **Variations on top of that** (`leadData.spec.ts`): apostrophes (`D'Arcy O'Neil`), accented and hyphenated names (`Zoë Müller-Ñandú`), a company with an ampersand, first name, last name and company at the standard field limits (40, 80 and 255 characters), and every Lead Source value the framework uses, created once and then switched through the Edit form.
- **What is deliberately not covered:** values over the field limits, emoji and other exotic characters, address fields, and combinations of every picklist with every other (the three picklists are sampled at random, one combination per run).
- **Pre-existing Account / Contact** (for the "already exists" conversion branches) are created through the UI, using `RecordSeeder`, **once**, by the `seed-shared` project. Their ids are kept in `auth/shared-data.json` and later runs just check they still open. The scenarios give the lead the shared record's name so the Convert Lead modal finds it. API seeding would be faster, but it needs a connected app / OAuth token in the org, which is one more manual setup step for whoever clones this. I preferred a repo that works with just a username, password and mailbox. The seeder is the single place to swap for REST calls.
- **Why shared and not one fresh record per test.** I started with a fresh Account / Contact per scenario. The Convert Lead modal looks existing records up through the search index, and in the dev org a record created seconds earlier took 45 s to over 2 min to become searchable, so the "exists" scenarios failed at random. A record that is minutes old is found at once. Only the very first run, when the shared records are brand new, keeps searching for up to 5 minutes; after that the wait is a 20 s grace period. Trade-off: those two scenarios depend on one fixed record, and it accumulates converted contacts and opportunities over time.
- The conversion scenarios that reuse the shared Contact give the lead that contact's name and email, so creating the lead raises the duplicate alert. The rule only warns, so `createLead` saves again and carries on; that is expected, not a failure.
- Everything is prefixed `QA_AUTO`. Leads, and the Accounts / Contacts / Opportunities that conversion creates, carry a unique suffix, which keeps parallel runs safe and makes leftovers easy to find and delete from a list view. The shared Account / Contact keep a fixed name on purpose (`QA_AUTO Shared Existing Account`).
- No cleanup step yet. A dev org is disposable, but it is the first thing I'd add (delete by `QA_AUTO` prefix in a global teardown).

## CI

`.github/workflows/playwright.yml` type-checks, installs browsers, runs chromium + webkit smoke, and uploads the report. It is started by hand (Actions tab > playwright > Run workflow) rather than on every push, because it fails until the repository secrets exist; add `push:` / `pull_request:` to its `on:` block once they do. Secrets needed: `SF_LIGHTNING_URL`, `SF_USERNAME`, `SF_PASSWORD`, `MAIL_USER`, `MAIL_APP_PASSWORD`. A fresh runner has no cached session, so the pipeline goes through the verification-code path every time. It has no `auth/shared-data.json` either, so every CI run creates a new shared Account / Contact (same fixed name) and the two "already exists" scenarios wait for the search index like a first local run. Caching `auth/shared-data.json` between runs would avoid that; I have not set it up.


## Troubleshooting

| what is seen | what it means |
|---|---|
| `'cross-env' is not recognized` | dependencies are not installed (or were installed before `cross-env` was added): run `npm install` |
| The verification page says the code was **texted** | the user has a verified mobile number, see Setup, step 2 |
| `Gmail rejected MAIL_USER / MAIL_APP_PASSWORD` | wrong app password, 2-step verification is off, or IMAP is disabled |
| `No Salesforce verification code arrived` with no IMAP error | mail went to another address (check the user's email) or the subject / sender didn't match; run with `LOG_LEVEL=debug` to see which mails were skipped and why |
| Only the setup test passed and everything else is skipped | a setup project failed (`seed-shared` or `auth.setup`), and Playwright skips what depends on it. Read that test's error first |
| 2 skipped tests in `npm test` | `fresh-login` and `signup` are opt-in, nothing is wrong |
| An "already exists" conversion scenario found `new` on the first run | the search index hadn't caught up with the shared records: run again or raise `INDEX_WINDOW_MS` |

Starting clean:

- Delete `auth/state.*.json` to force a fresh login (and a new email code).
- Delete `auth/shared-data.json` to have the shared Account / Contact created again. Delete the old `QA_AUTO Shared Existing Account` in the org first, or will end up with two of them.

Debugging a test:

```bash
npx playwright test --headed --debug
npx playwright test --ui
npx playwright show-trace test-results/<test>/trace.zip     # traces are recorded on retry, use --trace on to force it
npx playwright codegen <the lightning url> --load-storage=auth/state.chromium.json
```

Every test keeps a screenshot, a video and a trace in `test-results/<test>/` (failed tests also an `error-context.md` with the page snapshot), unless set `ARTIFACTS=failures`.


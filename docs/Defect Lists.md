# Defect Lists: Sales portal (Salesforce Lightning, Sales app)

Possible defects for the Sales portal, covering Lead create/edit, Lead to Opportunity conversion, login, search and the Lightning UI. Each entry carries the evidence found in this project's test runs.

## About

| Status | Meaning |
|---|---|
| **Observed** | Seen in the dev org while building or running this suite, with evidence below. Whether it is a product defect or by-design behaviour is stated in each entry. |
| **Checked, no defect** | A candidate that a passing test now covers. The run found nothing wrong, so it is not a defect on the evidence so far. |
| **Candidate** | A plausible defect for this kind of portal. No run has exercised it yet, so there is no evidence either way. |

Many Observed items are standard Lightning behaviour (by design) that makes automation or usability harder. They are listed as UX or testability issues, not as Salesforce bugs.

**Severity:** S1 blocks a core flow or loses data. S2 breaks a feature, a workaround exists. S3 minor or cosmetic, or affects accessibility and testability. **Priority:** P1 fix first, P2 next release, P3 backlog.

**Environment:** Salesforce Developer Edition org, Lightning Experience, Sales app, desktop Chromium and WebKit (Playwright 1.64).

## Evidence Source

| Source | Details |
|---|---|
| `runs/index.csv` and `runs/<start time>_seed<seed>/test-data.json` | Per run: test status, duration, the exact Lead data typed, ids returned by the conversion, scenario annotations |
| `NOTES.md`, "Debugging log" and "Part C.a / Part B" | What broke, how it was diagnosed (screenshot, call log, error text) and what was changed |
| Failed run `runs/2026-10-26T14-00-04-166Z_seed1164254557` | Three real failures, with error text in `test-data.json` |
| Runs `2026-10-26T14-21-28…` and `2026-10-26T14-28-00…` | Screenshots (8 and 34), videos (6 and 32) and traces (2 and 15) under `playwright-report/` and `test-results/` |


## Summary

| ID | Title | Area | Status | Severity | Priority |
|---|---|---|---|---|---|
| D-01 | Verification code sent by SMS instead of email once a mobile number is verified | Login | Observed | S2 | P2 |
| D-02 | Login is username-first (two-step) | Login | Observed | S3 | P3 |
| D-03 | Error popover ("We hit a snag") hides the Lead form from assistive technology | Lead create/edit | Observed | S2 | P2 |
| D-04 | Duplicate alert popover hides the form; save button label changes to "Save (Ignore Alert)" | Lead create | Observed | S3 | P3 |
| D-05 | Picklist dropdown closes when the modal scrolls | Lead create/edit | Observed | S3 | P3 |
| D-06 | Newly created Accounts/Contacts are not searchable for 45 s to over 2 min | Search, Convert | Observed | S2 | P2 |
| D-07 | Convert modal lists "Search for matching … in Account" as a selectable row | Lead conversion | Observed | S3 | P3 |
| D-08 | Conversion response has no Opportunity stage; stage is only visible in the UI | Lead conversion | Observed | S3 | P3 |
| D-09 | Record URLs omit the object name | Navigation | Observed | S3 | P3 |
| D-10 | Generated element ids change on every open | Lightning UI | Observed | S3 | P3 |
| D-11 | Record-page action menu fails to offer or accept an action (re-render closes it) | Record page | Observed | S2 | P2 |
| D-12 | Required-field validation on Lead (Last Name, Company) | Lead create | Checked, no defect (one wording point) | S3 | P3 |
| D-13 | Email, phone and website format validation | Lead create/edit | Candidate | S2 | P2 |
| D-14 | Duplicate Lead can be saved by ignoring the alert, with no merge or audit trail | Lead create | Candidate (alert itself confirmed) | S2 | P2 |
| D-15 | Special characters, apostrophes and long values truncated or mis-rendered | Lead create/edit | Checked, no defect | S2 | P2 |
| D-16 | Lead Source picklist values missing or wrong after save | Lead create/edit | Checked, no defect | S2 | P2 |
| D-17 | Converting a Lead twice, or converting a converted Lead | Lead conversion | Candidate | S1 | P1 |
| D-18 | Conversion to an existing Account/Contact creates a duplicate | Lead conversion | Checked, no defect (one run) | S1 | P1 |
| D-19 | Opportunity created with wrong stage, name, owner or Account | Lead conversion | Checked, no defect | S2 | P1 |
| D-20 | "Don't create an opportunity" option ignored | Lead conversion | Candidate | S2 | P2 |
| D-21 | Lead fields not carried to Account/Contact/Opportunity after conversion | Lead conversion | Candidate | S2 | P2 |
| D-22 | Session expires mid-flow and the user loses unsaved data | Session | Candidate | S2 | P2 |
| D-23 | Access control: a user without Lead or Convert permission sees or can use the action | Security | Candidate | S1 | P1 |
| D-24 | Cross-browser differences (WebKit slower, timing differences) | Browser | Observed (timing only) | S3 | P3 |
| D-25 | Accessibility: missing labels, focus not returned after closing a modal | Accessibility | Candidate | S3 | P3 |

---

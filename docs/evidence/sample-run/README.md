# Sample run

A small, cleaned-up sample of one real run, so the output can be looked at without running the suite. The full output of every run is in `runs/` and `logs/` (gitignored: it is large, and its Playwright traces contain the Salesforce session cookie).

**The run:** 2026-10-27 17:12 local (UTC+8), `npm test`, seed `317957723`, Chromium plus the WebKit smoke tests. 31 passed, 0 failed, 2 skipped (the two opt-in tests, `fresh-login` and `signup`). One line of `runs/index.csv` is in `index.csv`.

| file | what it shows |
|---|---|
| `test-data.json` | for every test: status, duration, annotations and the data it used. The lead as typed in, the shared Account / Contact ids, the ids the conversion produced and which branch the modal took for each (`branches`), and the JSON paths the response check used (`$.actions[0].returnValue.opportunityId` and so on) |
| `run-log.txt` | the timestamped log (the run's `run.log`; renamed because `*.log` is gitignored) of the run, one line per step, with the worker (`[w6]`) and the time with its UTC offset |
| `index.csv` | the run's line in the run index |
| `01-login-lands-on-sales-home.png` | Part A: the cached session lands on Sales home (app launcher and global search visible) |
| `02-lead-saved-and-qualified.png` | Part B: the saved lead, and its status after the edit (`Working - Contacted`) |
| `03-negative-missing-mandatory-fields.png` | Negative case: nothing filled in, "We hit a snag" popover, Last Name and Company flagged |
| `04-conversion-new-contact-created.png` | Conversion: the Contact created by the "account exists, contact gets created" scenario, linked to the shared Account |

## What was removed or changed

- The org host name is replaced by `your-org.develop.lightning.force.com` in `run-log.txt` and `test-data.json`.
- The record owner's name is blacked out in the screenshots.
- Nothing else was edited. The lead data is generated (`example.com` addresses, `QA_AUTO` names), and the record ids are those of a throwaway developer org.
- Not included on purpose: traces, videos and the HTML report. Traces store request headers, including the session cookie.

This run started from a cached login, so the log has no login lines. The email-code login is described in the main README ("Email verification code on login").

# Notes

Companion to the README: the Part C answers, the API discovery notes for the conversion call, and a short debugging log.

> Anything in a block quote marked **TODO** is where I paste what I saw in my own org (DevTools screenshots, the real response paths). Those get filled in after the first live run and the markers removed before submitting.

---

## Part C.a - Shadow DOM / dynamic component evidence

**Element:** the *Lead Source* picklist in the New Lead form (`lightning-combobox`, rendered inside the modal).

### What the DOM looks like

Screenshot of the element in DevTools: `docs/evidence/lead-source-combobox-devtools.png`

> **TODO:** capture the screenshot from my org (right click the Lead Source field > Inspect, expand until the `<button role="combobox">` is visible, and keep the nested `#shadow-root (open)` nodes and the generated `id` / `aria-labelledby` values in the frame).

### Why the naive locator doesn't hold up

The things a plain `page.locator(...)` / CSS / XPath approach runs into with this component:

- The picklist is not a `<select>`. It is a `<button role="combobox">` inside a chain of `lightning-combobox > lightning-base-combobox > ...` shadow roots, and the option list is another shadow tree under it.
- Its `id`, `aria-controls` and the label wiring are generated at render time (`combobox-button-<n>`, `dropdown-element-<n>`), so an id or `#id` based selector breaks the next time the modal is opened.
- XPath does not cross shadow boundaries at all, so anything written as `//button[...]` finds nothing.

> **TODO:** paste the naive locator I actually tried first, and what it did (timeout / strict mode violation / wrong element), plus the real generated id I saw in DevTools.

### Locator strategy I used instead

```ts
// src/pages/components/LightningCombobox.ts
trigger(label)  -> scope.getByRole('combobox', { name: /Lead Source/i })
option(value)   -> scope.getByRole('option', { name: /^\s*Web\s*$/i })
                   .or(scope.locator('[role="option"][data-value="Web"]'))
```

Why it is stable: it only uses the role and the accessible name, which is the public accessibility contract of the component and is exactly what a user (or screen reader) sees, so it does not care how many shadow roots sit in between or what ids were generated this time. Playwright resolves role locators through open shadow roots by default, and the option lookup has a second path through `data-value`, which `lightning-base-combobox-item` puts on every row, so a change in either the label text wiring or the option markup doesn't take it down by itself. If the option isn't found, the helper reports which options *were* on screen, which turns "wrong picklist value for this org" from a mystery into a one-line fix.

### Second example (detail view fields)

Fields on the record page are read with `[data-target-selection-name="sfdc:RecordField.Lead.Company"]` (field API name stamped by Lightning on the wrapper), with `records-record-layout-item[field-label="..."]` as a fallback. The API name survives layout changes and translated labels, which a text based locator would not.

---

## Part B - API / response discovery (Lead -> Opportunity conversion)

### How the call is captured

`src/api/conversionCapture.ts` registers `page.waitForResponse(...)` *before* clicking Convert. Lightning sends most requests as `POST .../aura?...` where one URL carries many actions, so the URL is no use for identification. The matcher is: POST + (`/aura` or `/services/data/`) + a body or url that mentions `convert`. The response JSON is parsed (stripping the occasional `while(1);` / `/*ERROR*/` prefix) and attached to the test report as `convert-response.json`, along with the decoded request as `convert-request.txt` and the discovered paths as `convert-json-paths.json`.

### What is asserted

`src/api/conversionAssertions.ts`:

1. HTTP status is 200.
2. For an Aura response, every action that carries the new opportunity id has `state === "SUCCESS"`.
3. Deep properties, searched by value anywhere in the payload and compared with what the UI reported:
   - an Opportunity id (`006` + 15 chars) exists and **equals** the id of the opportunity the UI navigates to
   - the Account id (`001...`) equals the account the modal linked (the seeded one in the "existing" branches)
   - the Contact id (`003...`) equals the contact the modal linked

The ids are searched for by value instead of by hard-coded path because the Aura payload shape isn't documented; the path where each one was found is written to `convert-json-paths.json`.

### What I observed

> **TODO (from my first successful run, open `convert-response.json` in the report):**
>
> | item | observed |
> |---|---|
> | endpoint | `POST ...` |
> | action descriptor in the request | `...` |
> | path of the opportunity id | `$.actions[0]...` |
> | path of the account id | `$...` |
> | path of the contact id | `$...` |
> | stage / status field in the payload (if any) and its value | `...` |
>
> Then pin the two or three paths above in `assertConversionResponse` so the assertion is on a known location, not a search.

---

## Known fragile spots

These are the parts of the Lightning UI I expect to move between releases, so they are kept in one place each:

| area | where |
|---|---|
| conversion modal markup (existing vs new lookups, confirmation dialog) | `LeadConvertPage.ts` |
| validation / duplicate banner wording | `LeadPage.ts` (`validationSummary`, `duplicateAlert`) |
| login + verification page elements | `LoginPage.ts` |
| picklists | `LightningCombobox.ts` |

---

## Debugging log

> **TODO:** real entries only, written as they happen during the live runs (the walkthrough asks for one thing that broke and how I found it).

| what broke | how I found out | fix | commit |
|---|---|---|---|
| | | | |

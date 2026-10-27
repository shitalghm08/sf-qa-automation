import { expect } from '@playwright/test';
import { deepFind, findIdsByPrefix } from '../utils/deepFind';
import { getLogger } from '../utils/logger';
import { CapturedCall } from './conversionCapture';

const log = getLogger('conversionAssertions');

interface Expected {
  accountId: string;
  contactId: string;
  opportunityId: string;
}

/**
 * Checks the backend response for the convert click against what the UI showed.
 *
 * Did not hardcode json paths (the aura payload shape isn't documented and differs between
 * releases). Instead each id is searched for anywhere in the response and the path where it
 * was found is reported, so the paths can be pinned down in NOTES.md after looking at a real run.
 */
export function assertConversionResponse(call: CapturedCall, expected: Expected): Record<string, string> {
  // 1. transport level
  expect(call.status, 'convert call http status').toBe(200);

  // 2. aura envelope: the action that carries our opportunity must have succeeded
  const envelope = call.json as { actions?: Array<{ id?: string; state?: string }> };
  if (Array.isArray(envelope.actions)) {
    const carrying = envelope.actions.filter((a) => JSON.stringify(a).includes(expected.opportunityId));
    expect(carrying.length, 'an aura action should carry the new opportunity id').toBeGreaterThan(0);
    for (const action of carrying) {
      expect(action.state, `aura action ${action.id ?? '?'} state`).toBe('SUCCESS');
    }
  }

  // 3. deep properties - found by value, validated by format AND by matching the ui
  const found: Record<string, string> = {};

  const oppHits = findIdsByPrefix(call.json, '006');
  expect(oppHits.length, 'response should contain an Opportunity id (006...)').toBeGreaterThan(0);
  expect(oppHits.map((h) => h.value), 'opportunity id in response vs id shown by the ui').toContain(expected.opportunityId);
  found.opportunityId = oppHits.find((h) => h.value === expected.opportunityId)!.path;

  const accHits = findIdsByPrefix(call.json, '001');
  expect(accHits.map((h) => h.value), 'account id in response vs account the ui linked').toContain(expected.accountId);
  found.accountId = accHits.find((h) => h.value === expected.accountId)!.path;

  const conHits = findIdsByPrefix(call.json, '003');
  expect(conHits.map((h) => h.value), 'contact id in response vs contact the ui linked').toContain(expected.contactId);
  found.contactId = conHits.find((h) => h.value === expected.contactId)!.path;

  // 3b. the paths seen in real runs (NOTES.md, "What I observed"). The action index is left open
  // because Lightning can batch other actions into the same call.
  for (const key of ['opportunityId', 'accountId', 'contactId'] as const) {
    expect(found[key], `where the ${key} sits in the response`).toMatch(new RegExp(`^\\$\\.actions\\[\\d+\\]\\.returnValue\\.${key}$`));
  }

  // 4. if the payload exposes a stage / status style field, record what it says (informational, org dependent)
  const stageLike = deepFind(call.json, (k, v) => /^(stagename|stage|status)$/i.test(k) && typeof v === 'string');
  if (stageLike.length) found.stageOrStatusFields = stageLike.map((h) => `${h.path}=${String(h.value)}`).join('; ');

  log.info('conversion response validated', found);
  return found;
}

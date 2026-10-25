import { Page } from '@playwright/test';
import { getLogger } from '../utils/logger';

const log = getLogger('conversionCapture');

export interface CapturedCall {
  url: string;
  status: number;
  method: string;
  /** decoded request body, handy when working out what the call actually is */
  requestBody: string;
  json: unknown;
}

/**
 * Salesforce Lightning mostly talks to the server through the Aura endpoint
 * (POST /aura?...) which multiplexes many actions into one request, so the url alone
 * says nothing. What identifies the convert call is its payload mentioning "convert".
 */
function looksLikeConvert(url: string, method: string, body: string): boolean {
  if (method !== 'POST') return false;
  const isAura = url.includes('/aura');
  const isRest = url.includes('/services/data/');
  if (!isAura && !isRest) return false;
  return /convert/i.test(body) || /convert/i.test(url);
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

/** aura sometimes prefixes json with a guard or an error marker */
function parseAuraJson(text: string): unknown {
  const cleaned = text.replace(/^\s*while\s*\(1\);\s*/, '').replace(/^\s*\/\*ERROR\*\/\s*/, '');
  return JSON.parse(cleaned);
}

/**
 * Start listening BEFORE clicking Convert. Resolves with the parsed response of the
 * first successful call that looks like the lead conversion.
 */
export async function waitForConvertCall(page: Page, timeoutMs = 45_000): Promise<CapturedCall> {
  const response = await page.waitForResponse(
    (res) => {
      const req = res.request();
      const body = safeDecode(req.postData() ?? '');
      return res.ok() && looksLikeConvert(res.url(), req.method(), body);
    },
    { timeout: timeoutMs },
  );

  const req = response.request();
  const text = await response.text();
  let json: unknown;
  try {
    json = parseAuraJson(text);
  } catch (err) {
    throw new Error(`Convert call ${response.url()} did not return json: ${(err as Error).message}. Body starts: ${text.slice(0, 200)}`);
  }

  log.info('captured conversion call', { url: response.url().split('?')[0], status: response.status() });
  return {
    url: response.url(),
    status: response.status(),
    method: req.method(),
    requestBody: safeDecode(req.postData() ?? ''),
    json,
  };
}

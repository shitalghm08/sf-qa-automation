import { test } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { getLogger } from './logger';

const log = getLogger('randomData');

/**
 * Parallel workers + repeated runs all write into the same org, so every record
 * gets a suffix that is unique per (run, worker, call). The QA_AUTO prefix makes
 * leftovers easy to find and mass-delete from a list view later.
 */
let counter = 0;

export function uniqueSuffix(): string {
  counter += 1;
  const worker = process.env.TEST_WORKER_INDEX ?? '0';
  const t = Date.now().toString(36);
  const r = faker.string.alphanumeric({ length: 3, casing: 'lower' });
  return `${t}${worker}${counter}${r}`;
}

/**
 * The random picks (first name, title, phone, employees, the three picklists) are seeded, so a failing
 * run can be replayed: set TEST_SEED to the value printed at the start of the run.
 * playwright.config.ts makes one up when it is not set and the workers inherit it. A lead's seed is
 * derived from the run seed, the test, and how many leads that test has built so far, so it does not
 * depend on which worker picked the test up. The unique suffix still carries a timestamp, so a replay
 * never collides with the records of the original run.
 */
function runSeed(): number {
  const n = Number(process.env.TEST_SEED);
  if (Number.isInteger(n) && n >= 0) return n;
  process.env.TEST_SEED = String(Math.floor(Math.random() * 2 ** 31));
  return Number(process.env.TEST_SEED);
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const leadsBuiltPerTest = new Map<string, number>();
let seedLogged = false;

function seedForThisCall(): number {
  let testKey = 'outside-a-test';
  try {
    testKey = test.info().testId;
  } catch {
    // not inside a test (a script or a helper run on its own)
  }
  const n = (leadsBuiltPerTest.get(testKey) ?? 0) + 1;
  leadsBuiltPerTest.set(testKey, n);
  if (!seedLogged) {
    seedLogged = true;
    log.info(`random data seed (TEST_SEED) ${runSeed()}`);
  }
  return fnv1a(`${runSeed()}|${testKey}|${n}`);
}

// field limits of the standard Lead object
export const MAX_FIRST_NAME = 40;
export const MAX_LAST_NAME = 80;
export const MAX_COMPANY = 255;

export interface LeadData {
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  email: string;
  phone: string;
  website: string;
  leadSource: string;
  industry: string;
  rating: string;
  employees: string;
}

export const LEAD_SOURCES = ['Web', 'Phone Inquiry', 'Partner Referral', 'Purchased List', 'Other'];
const INDUSTRIES = ['Technology', 'Finance', 'Healthcare', 'Retail', 'Education'];
const RATINGS = ['Hot', 'Warm', 'Cold'];

export function buildLead(overrides: Partial<LeadData> = {}, seed = seedForThisCall()): LeadData {
  faker.seed(seed);
  const s = uniqueSuffix();
  const first = faker.person.firstName().replace(/[^A-Za-z]/g, '') || 'Alex';

  return {
    firstName: first,
    // suffix in the last name keeps name-based duplicate rules quiet
    lastName: `Auto${s}`,
    company: `QA_AUTO ${faker.company.name().replace(/[,.']/g, '')} ${s}`,
    title: faker.person.jobTitle(),
    email: `qa.${s}@example.com`,
    phone: `+65 ${faker.string.numeric(8)}`,
    website: `https://www.${s}.example.com`,
    leadSource: faker.helpers.arrayElement(LEAD_SOURCES),
    industry: faker.helpers.arrayElement(INDUSTRIES),
    rating: faker.helpers.arrayElement(RATINGS),
    employees: String(faker.number.int({ min: 5, max: 900 })),
    ...overrides,
  };
}

export function fullName(l: Pick<LeadData, 'firstName' | 'lastName'>): string {
  return `${l.firstName} ${l.lastName}`;
}

/** gmail style +tag address so verification mails land in one inbox */
export function plusAddress(base: string, tag: string): string {
  const [user, domain] = base.split('@');
  return `${user}+${tag}@${domain}`;
}

/** a value of exactly `length` characters that still ends in the unique suffix (for field length limits) */
export function nameOfLength(base: string, suffix: string, length: number): string {
  const body = base.repeat(Math.ceil(length / base.length)).slice(0, Math.max(0, length - suffix.length));
  return `${body}${suffix}`;
}

import { faker } from '@faker-js/faker';

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

const LEAD_SOURCES = ['Web', 'Phone Inquiry', 'Partner Referral', 'Purchased List', 'Other'];
const INDUSTRIES = ['Technology', 'Finance', 'Healthcare', 'Retail', 'Education'];
const RATINGS = ['Hot', 'Warm', 'Cold'];

export function buildLead(overrides: Partial<LeadData> = {}): LeadData {
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

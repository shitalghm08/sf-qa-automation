import * as fs from 'fs';
import * as path from 'path';

/**
 * The "already exists" Account and Contact for the conversion scenarios.
 *
 * They are created once (tests/setup/shared-data.setup.ts) and reused by every run, instead of seeding
 * fresh ones per test. Reason: the Convert Lead modal looks existing records up through the search
 * index, and a record created seconds ago takes anywhere from under a minute to over two minutes to
 * show up there. A record that is minutes or days old is found at once.
 * The lead in the scenario is given these names, so the modal's search finds them.
 */
export const SHARED = {
  accountName: 'QA_AUTO Shared Existing Account',
  contact: {
    firstName: 'Sharon',
    lastName: 'AutoSharedContact',
    email: 'qa.shared.contact@example.com',
  },
} as const;

export interface SharedIds {
  accountId: string;
  /** missing while only the account has been created, so a rerun builds on it instead of starting over */
  contactId?: string;
  /** ISO time the latest record was created, to know how long the search index may still be catching up */
  createdAt: string;
}

// auth/*.json is gitignored, so this stays local like the cached sessions
const file = path.resolve(__dirname, '../../auth/shared-data.json');

export function readSharedIds(): SharedIds | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as SharedIds;
  } catch {
    return undefined;
  }
}

export function writeSharedIds(ids: SharedIds): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ids, null, 2));
}

/** how long after creation a record may still be missing from search (seen: 45 s to over 2 min) */
const INDEX_WINDOW_MS = 5 * 60_000;

/**
 * How long a scenario should keep searching for the shared records. Normally just a short grace
 * period; on the very first run, while the records are minutes old, whatever is left of the window.
 */
export function searchPatienceMs(): number {
  const ids = readSharedIds();
  if (!ids) return 0;
  const age = Date.now() - new Date(ids.createdAt).getTime();
  return Math.max(0, INDEX_WINDOW_MS - age) + 20_000;
}

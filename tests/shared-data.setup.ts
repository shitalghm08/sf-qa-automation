import { test as setup } from '../src/fixtures';
import { getLogger } from '../src/utils/logger';
import { readSharedIds, SHARED, writeSharedIds } from '../src/utils/sharedData';

const log = getLogger('shared-data.setup');

/**
 * Makes sure the Account and Contact that the "already exists" conversion scenarios link to are
 * there. Created once and kept (see src/utils/sharedData.ts for why), so on later runs this is
 * just two page loads. If someone deleted them in the org, they are created again.
 * The ids are saved as soon as each record exists, so a run that dies halfway does not leave an
 * orphan account behind and make the next run create a second one.
 */
setup('seed the shared Account and Contact for the conversion scenarios', async ({ seeder, contacts }, testInfo) => {
  const known = readSharedIds();
  let accountId = known?.accountId;
  let contactId = known?.contactId;

  if (accountId && !(await seeder.recordExists('Account', accountId))) {
    log.warn('shared account from an earlier run is gone from the org, creating it again');
    accountId = undefined;
    contactId = undefined; // it belonged to that account
  }
  if (contactId && !(await seeder.recordExists('Contact', contactId))) {
    log.warn('shared contact from an earlier run is gone from the org, creating it again');
    contactId = undefined;
  }
  if (accountId && contactId) {
    log.info('shared account and contact already exist, reusing them', { accountId, contactId });
    await testInfo.attach('shared-ids.json', { body: JSON.stringify({ accountId, contactId, reused: true }, null, 2), contentType: 'application/json' });
    return;
  }

  if (!accountId) {
    accountId = await seeder.createAccount(SHARED.accountName);
    writeSharedIds({ accountId, createdAt: new Date().toISOString() });
  }

  contactId = await seeder.createContact({ ...SHARED.contact, accountName: SHARED.accountName, accountId });
  writeSharedIds({ accountId, contactId, createdAt: new Date().toISOString() });
  log.info('shared account and contact created', { accountId, contactId });
  await testInfo.attach('shared-ids.json', { body: JSON.stringify({ accountId, contactId, reused: false }, null, 2), contentType: 'application/json' });

  // the form was opened with the account preset from the url, so prove it really ended up on the contact
  await contacts.expectLinkedToAccount(contactId, accountId, SHARED.accountName);
});

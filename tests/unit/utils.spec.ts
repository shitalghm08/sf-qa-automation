import { expect, test } from '@playwright/test';
import { deepFind, findIdsByPrefix } from '../../src/utils/deepFind';
import { extractCode } from '../../src/utils/mail';
import { exactLabel, looseLabel } from '../../src/pages/BasePage';
import { plusAddress } from '../../src/utils/randomData';

// Pure logic only - these run without a browser or an org, so they are safe to run anywhere (npm run test:unit)

test.describe('verification code parsing', () => {
  test('reads the code from the usual wording', () => {
    expect(extractCode('Your identity verification code.\n\nVerification Code: 482913\n\nThanks')).toBe('482913');
  });

  test('is not fooled by other numbers earlier in the mail', () => {
    expect(extractCode('Request from 10.0.0.1 at 2026\nVerification Code: 120077')).toBe('120077');
  });

  test('returns null when there is nothing code-like', () => {
    expect(extractCode('Welcome to Salesforce')).toBeNull();
  });
});

test.describe('deep json helpers', () => {
  const payload = {
    actions: [
      { id: '1;a', state: 'SUCCESS', returnValue: { opportunityId: '006AB0000012345XYZ', nested: { accountId: '001AB0000099999QRS' } } },
    ],
  };

  test('finds ids by key prefix and reports the path', () => {
    const hits = findIdsByPrefix(payload, '006');
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe('$.actions[0].returnValue.opportunityId');
    expect(findIdsByPrefix(payload, '001')[0].value).toBe('001AB0000099999QRS');
  });

  test('ignores strings that only look similar', () => {
    expect(findIdsByPrefix({ x: '006short', y: '0060000000000000000000' }, '006')).toHaveLength(0);
  });

  test('generic matcher works on keys', () => {
    const hits = deepFind(payload, (k) => k === 'state');
    expect(hits.map((h) => h.value)).toEqual(['SUCCESS']);
  });
});

test.describe('locator label helpers', () => {
  test('exactLabel tolerates the required-field asterisk but nothing else', () => {
    const re = exactLabel('Last Name');
    expect(re.test('*Last Name')).toBe(true);
    expect(re.test('Last Name')).toBe(true);
    expect(re.test('Email Opt Out')).toBe(false);
    expect(exactLabel('Email').test('Email Opt Out')).toBe(false);
  });

  test('looseLabel matches picklist buttons that include the current value', () => {
    expect(looseLabel('Lead Source').test('Lead Source --None--')).toBe(true);
  });

  test('labels with regex characters are escaped', () => {
    expect(exactLabel('No. of Employees').test('No. of Employees')).toBe(true);
    expect(exactLabel('No. of Employees').test('NoX of Employees')).toBe(false);
  });
});

test.describe('test data helpers', () => {
  test('plusAddress keeps the mailbox and tags it', () => {
    expect(plusAddress('someone@gmail.com', 'sfdev1')).toBe('someone+sfdev1@gmail.com');
  });
});

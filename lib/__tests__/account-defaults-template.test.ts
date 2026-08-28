import { describe, it, expect } from 'vitest';
import { STANDARD_ROOT_ACCOUNTS, STANDARD_CHILD_ACCOUNTS } from '../organization/bootstrap';
import {
  ACCOUNT_DEFAULT_SPECS,
  resolveAccountDefaultId,
  isAccountUsableForRole,
  type AccountDefaultKey,
} from '../account-defaults';

/**
 * The account-default resolver ends in a last resort: "no preferred id, code or
 * keyword matched — take the first account of an allowed type". That fallback is
 * silent, and a wrong-but-balanced journal entry is far harder to notice later
 * than an error now. It is what posted purchase returns and input tax to Cash
 * and Bank before the standard chart carried accounts for those roles.
 *
 * So the template and the resolver have to stay in step. This pins the pairing
 * explicitly: if someone renames a template account, adds a role, or edits the
 * resolver's keywords, the break shows up here rather than in a customer's
 * ledger.
 */

const TYPE_LABEL: Record<string, string> = {
  ASSET: 'Asset',
  LIABILITY: 'Liability',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  EXPENSE: 'Expense',
};

/** The chart exactly as `bootstrapOrganization` writes it: roots are headers
 *  (not postable), children are postable. Ids stand in as the account codes. */
const standardChart = [
  ...STANDARD_ROOT_ACCOUNTS.map((a) => ({
    id: a.code, code: a.code, name: a.name, type: TYPE_LABEL[a.type], isActive: true, isPostable: false,
  })),
  ...STANDARD_CHILD_ACCOUNTS.map((a) => ({
    id: a.code, code: a.code, name: a.name, type: TYPE_LABEL[a.type], isActive: true, isPostable: true,
  })),
];

/** Role → the account code a brand-new company should post it to. */
const EXPECTED: Record<AccountDefaultKey, string> = {
  bankAsset:            '1-1000',
  arControl:            '1-1200',
  inventoryAsset:       '1-1300',
  apTax:                '1-1400',
  apReturn:             '1-1500',
  apControl:            '2-1000',
  arTax:                '2-1100',
  grIrClearing:         '2-1200',
  pphPayable:           '2-1300',
  openingBalanceEquity: '3-9000',
  retainedEarnings:     '3-1000',
  salesRevenue:         '4-1000',
  salesDiscount:        '4-1200',
  arPenalty:            '4-9100',
  apDiscount:           '4-9200',
  cogsExpense:          '5-1000',
  inventoryAdjustment:  '5-1900',
  arReturn:             '5-2000',
  arDiscount:           '5-3000',
  apPenalty:            '5-4000',
  roundingAccount:      '5-9000',
};

describe('standard chart of accounts covers every account-default role', () => {
  it('declares an expectation for every role the resolver knows about', () => {
    // Guards the other direction: a new role added to ACCOUNT_DEFAULT_SPECS must
    // be given a home in the template, not left to the silent fallback.
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(ACCOUNT_DEFAULT_SPECS).sort());
  });

  it.each(Object.keys(ACCOUNT_DEFAULT_SPECS) as AccountDefaultKey[])(
    'resolves %s to its intended account with no org configuration',
    (key) => {
      expect(resolveAccountDefaultId(standardChart, {}, key)).toBe(EXPECTED[key]);
    },
  );

  it('never lands on an account of the wrong type or a non-postable header', () => {
    for (const key of Object.keys(ACCOUNT_DEFAULT_SPECS) as AccountDefaultKey[]) {
      const resolved = standardChart.find((a) => a.id === resolveAccountDefaultId(standardChart, {}, key));
      expect(isAccountUsableForRole(resolved, key), `${key} resolved to an unusable account`).toBe(true);
    }
  });

  it('keeps every template account code unique', () => {
    const codes = [...STANDARD_ROOT_ACCOUNTS, ...STANDARD_CHILD_ACCOUNTS].map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('parents every child account to a root that exists', () => {
    const roots = new Set(STANDARD_ROOT_ACCOUNTS.map((a) => a.code));
    for (const child of STANDARD_CHILD_ACCOUNTS) {
      expect(roots.has(child.parentCode), `${child.code} has no parent`).toBe(true);
    }
  });

  it('gives every account the normal side its type implies', () => {
    for (const a of [...STANDARD_ROOT_ACCOUNTS, ...STANDARD_CHILD_ACCOUNTS]) {
      const expected = a.type === 'ASSET' || a.type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
      expect(a.normalSide, `${a.code} ${a.name}`).toBe(expected);
    }
  });
});

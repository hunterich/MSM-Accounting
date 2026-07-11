import { describe, expect, it } from 'vitest';
import {
  buildAccountTree,
  canArchiveAccount,
  flattenTree,
  getDescendantAccountIds,
  getNormalSideByType,
  rollupBalances,
  validateAccountCreate,
  validateAccountUpdate,
  type AccountRuleShape,
} from '../account-rules';

const baseAccounts: AccountRuleShape[] = [
  {
    id: 'asset-root',
    code: '1000',
    name: 'Assets',
    type: 'Asset',
    parentId: null,
    level: 0,
    isPostable: false,
    isActive: true,
    reportGroup: 'Assets',
    reportSubGroup: null,
    normalSide: 'Debit',
    hasPostings: false,
  },
  {
    id: 'cash',
    code: '1100',
    name: 'Cash',
    type: 'Asset',
    parentId: 'asset-root',
    level: 1,
    isPostable: true,
    isActive: true,
    reportGroup: 'Assets',
    reportSubGroup: 'Current Assets',
    normalSide: 'Debit',
    hasPostings: false,
  },
  {
    id: 'bank',
    code: '1200',
    name: 'Bank',
    type: 'Asset',
    parentId: 'asset-root',
    level: 1,
    isPostable: true,
    isActive: true,
    reportGroup: 'Assets',
    reportSubGroup: 'Current Assets',
    normalSide: 'Debit',
    hasPostings: true,
  },
];

describe('account-rules shared COA helpers', () => {
  it('builds and flattens account trees in code order', () => {
    const tree = buildAccountTree([
      baseAccounts[2],
      baseAccounts[0],
      baseAccounts[1],
    ]);

    expect(tree.map((account) => account.id)).toEqual(['asset-root']);
    expect(tree[0]?.children.map((account) => account.id)).toEqual(['cash', 'bank']);

    const flat = flattenTree(tree);
    expect(flat.map((account) => [account.id, account.depth, account.hasChildren])).toEqual([
      ['asset-root', 0, true],
      ['cash', 1, false],
      ['bank', 1, false],
    ]);
  });

  it('validates create and update payloads with the same shared rules', () => {
    const createResult = validateAccountCreate({
      code: '1100',
      name: 'Duplicate Cash',
      type: 'Asset',
      parentId: null,
      isPostable: true,
      isActive: true,
      reportGroup: 'Assets',
      reportSubGroup: null,
      normalSide: getNormalSideByType('Asset'),
    }, baseAccounts);

    expect(createResult.isValid).toBe(false);
    expect(createResult.errors.code).toBe('Account code must be unique.');

    const updateResult = validateAccountUpdate(baseAccounts[2], {
      ...baseAccounts[2],
      parentId: null,
      normalSide: 'Credit',
    }, baseAccounts);

    expect(updateResult.isValid).toBe(false);
    expect(updateResult.errors.normalSide).toContain('locked');
    expect(updateResult.errors.parentId).toContain('locked');
  });

  it('calculates descendants, delete rules, and balance rollups', () => {
    expect([...getDescendantAccountIds('asset-root', baseAccounts)].sort()).toEqual(['bank', 'cash']);

    const archiveResult = canArchiveAccount(baseAccounts[0], baseAccounts);
    expect(archiveResult.canDelete).toBe(false);
    expect(archiveResult.hasUsedDescendants).toBe(true);

    const balances = rollupBalances(baseAccounts, {
      cash: 100,
      bank: 250,
    });

    expect(balances.ownBalanceById.cash).toBe(100);
    expect(balances.totalsById['asset-root']).toBe(350);
  });
});

// ── Server-side enum casing (regression) ─────────────────────────────────────
// Accounts read straight from Prisma carry uppercase enum types ('LIABILITY');
// UI-normalised accounts carry 'Liability'. Resolution must accept both —
// the exact-match version silently skipped GL posting for every payment.
import { resolveAccountDefaultId } from '../account-defaults';

describe('resolveAccountDefaultId with Prisma enum casing', () => {
    const dbAccounts = [
        { id: 'acc-ap', code: '2-1000', name: 'Accounts Payable', type: 'LIABILITY', isActive: true, isPostable: true },
        { id: 'acc-bank', code: '1-1100', name: 'Bank BCA IDR', type: 'ASSET', isActive: true, isPostable: true },
    ];

    it('resolves apControl from uppercase LIABILITY accounts', () => {
        expect(resolveAccountDefaultId(dbAccounts as never, {}, 'apControl')).toBe('acc-ap');
    });

    it('resolves bankAsset from uppercase ASSET accounts', () => {
        expect(resolveAccountDefaultId(dbAccounts as never, {}, 'bankAsset')).toBe('acc-bank');
    });

    it('still resolves title-case UI-normalised accounts', () => {
        const uiAccounts = dbAccounts.map((a) => ({ ...a, type: a.type === 'LIABILITY' ? 'Liability' : 'Asset' }));
        expect(resolveAccountDefaultId(uiAccounts as never, {}, 'apControl')).toBe('acc-ap');
    });
});

// ── Keyword fallback is case-insensitive on the account NAME (regression) ─────
// Orgs on a `1-1200` / `2-1100` code scheme don't match the hardcoded preferred
// codes ('121', '22', …), so resolution reaches the keyword step. That step must
// match a normally-capitalised name ("Accounts Receivable") — previously it only
// normalised the keyword, not the haystack, so it silently fell through to
// candidates[0] and posted A/R to Cash and output tax to Accounts Payable.
describe('resolveAccountDefaultId keyword fallback (case-insensitive name)', () => {
    const orgAccounts = [
        { id: 'acc-cashbank', code: '1-1000', name: 'Cash and Bank', type: 'Asset', isActive: true, isPostable: true },
        { id: 'acc-ar', code: '1-1200', name: 'Accounts Receivable', type: 'Asset', isActive: true, isPostable: true },
        { id: 'acc-inventory', code: '1-1300', name: 'Inventory', type: 'Asset', isActive: true, isPostable: true },
        { id: 'acc-ap', code: '2-1000', name: 'Accounts Payable', type: 'Liability', isActive: true, isPostable: true },
        { id: 'acc-taxppn', code: '2-1100', name: 'Tax Payable (PPN)', type: 'Liability', isActive: true, isPostable: true },
        { id: 'acc-sales', code: '4-1000', name: 'Sales Revenue', type: 'Revenue', isActive: true, isPostable: true },
        { id: 'acc-cogs', code: '5-1000', name: 'Cost of Goods Sold', type: 'Expense', isActive: true, isPostable: true },
    ];

    it('resolves arControl to Accounts Receivable, not the first Asset (Cash and Bank)', () => {
        expect(resolveAccountDefaultId(orgAccounts as never, undefined, 'arControl')).toBe('acc-ar');
    });

    it('resolves arTax to Tax Payable (PPN), not the first Liability (Accounts Payable)', () => {
        expect(resolveAccountDefaultId(orgAccounts as never, undefined, 'arTax')).toBe('acc-taxppn');
    });
});

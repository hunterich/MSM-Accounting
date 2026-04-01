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

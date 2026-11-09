import { describe, expect, it, vi } from 'vitest';
import { auditItemAccountMappings, inspectItemAccountMappings } from '../item-account-audit';

const accounts = [
  { id: 'inventory', code: '1300', name: 'Inventory', type: 'ASSET', isActive: true, isPostable: true },
  { id: 'sales', code: '4100', name: 'Sales', type: 'REVENUE', isActive: true, isPostable: true },
  { id: 'cost', code: '5100', name: 'COGS', type: 'EXPENSE', isActive: true, isPostable: true },
  { id: 'other', code: '1310', name: 'Other inventory', type: 'ASSET', isActive: true, isPostable: true },
];
const defaults = { inventory: 'inventory', revenue: 'sales', cogs: 'cost' };
const item = { id: 'item', sku: 'SKU', name: 'Item', type: 'PRODUCT', isActive: true,
  inventoryAccountId: 'inventory', revenueAccountId: 'sales', cogsAccountId: 'cost' };

describe('item account mapping audit', () => {
  it('accepts matching mappings and unset mappings using defaults', () => {
    expect(inspectItemAccountMappings(item, accounts, defaults)).toEqual([]);
    expect(inspectItemAccountMappings({ ...item, inventoryAccountId: null }, accounts, defaults)).toEqual([]);
  });
  it('identifies a mapping that differs from current company defaults', () => {
    expect(inspectItemAccountMappings({ ...item, inventoryAccountId: 'other' }, accounts, defaults)).toEqual([
      { role: 'inventory', configuredId: 'other', defaultId: 'inventory', problems: ['differs_from_company_default'] },
    ]);
  });
  it('flags missing, inactive, header, wrong-type and unresolved accounts independently', () => {
    const bad = [...accounts, { id: 'bad', code: '999', name: 'Bad', type: 'ASSET', isActive: false, isPostable: false }];
    const result = inspectItemAccountMappings({ ...item, inventoryAccountId: 'foreign', revenueAccountId: 'bad', cogsAccountId: null }, bad, { ...defaults, cogs: null });
    expect(result).toEqual([
      { role: 'inventory', configuredId: 'foreign', defaultId: 'inventory', problems: ['account_missing_or_other_company', 'differs_from_company_default'] },
      { role: 'revenue', configuredId: 'bad', defaultId: 'sales', problems: ['account_inactive', 'account_not_postable', 'account_wrong_type', 'differs_from_company_default'] },
      { role: 'cogs', configuredId: null, defaultId: null, problems: ['company_default_unresolved'] },
    ]);
  });
  it('queries items, account metadata and inventory movements for the requested company', async () => {
    const tx = {
      account: { findMany: vi.fn().mockResolvedValue(accounts) },
      item: { findMany: vi.fn().mockResolvedValue([item]) },
      inventoryLedgerEntry: { groupBy: vi.fn().mockResolvedValue([]) },
      organization: { findUnique: vi.fn().mockResolvedValue({ accountDefaults: { inventoryAsset: 'inventory', salesRevenue: 'sales', cogsExpense: 'cost' } }) },
    };
    const report = await auditItemAccountMappings(tx as never, 'company-a');
    expect(report.itemsReviewed).toBe(1);
    expect(report.findings).toEqual([]);
    expect(tx.account.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'company-a' } }));
    expect(tx.item.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'company-a' } }));
    expect(tx.inventoryLedgerEntry.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'company-a' } }));
  });
});

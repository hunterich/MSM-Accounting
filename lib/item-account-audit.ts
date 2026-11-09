import type { Prisma } from '@prisma/client';
import { loadOrgAccountDefaults, resolveAccountDefaultId } from './account-defaults';

type Account = { id: string; code: string; name: string; type: string; isActive: boolean; isPostable: boolean };
type Item = { id: string; sku: string; name: string; type: string; isActive: boolean; inventoryAccountId: string | null; revenueAccountId: string | null; cogsAccountId: string | null };
type Role = 'inventory' | 'revenue' | 'cogs';
type Defaults = Record<Role, string | null>;

const ROLES: Array<{ role: Role; field: 'inventoryAccountId' | 'revenueAccountId' | 'cogsAccountId'; type: string }> = [
  { role: 'inventory', field: 'inventoryAccountId', type: 'ASSET' },
  { role: 'revenue', field: 'revenueAccountId', type: 'REVENUE' },
  { role: 'cogs', field: 'cogsAccountId', type: 'EXPENSE' },
];

/** Compare configuration only. A mismatch is not proof of a GL imbalance. */
export function inspectItemAccountMappings(item: Item, accounts: Account[], defaults: Defaults) {
  const byId = new Map(accounts.map(account => [account.id, account]));
  return ROLES.flatMap(({ role, field, type }) => {
    const configuredId = item[field];
    const defaultId = defaults[role];
    const account = configuredId ? byId.get(configuredId) : undefined;
    const problems: string[] = [];
    if (configuredId && !account) problems.push('account_missing_or_other_company');
    if (account && !account.isActive) problems.push('account_inactive');
    if (account && !account.isPostable) problems.push('account_not_postable');
    if (account && account.type.toUpperCase() !== type) problems.push('account_wrong_type');
    if (!defaultId) problems.push('company_default_unresolved');
    if (configuredId && defaultId && configuredId !== defaultId) problems.push('differs_from_company_default');
    if (!problems.length) return [];
    return [{ role, configuredId, defaultId, problems }];
  });
}

/** Must be called within the caller's company-scoped read-only transaction. */
export async function auditItemAccountMappings(tx: Prisma.TransactionClient, organizationId: string) {
  const [accounts, items, movements, settings] = await Promise.all([
    tx.account.findMany({ where: { organizationId }, select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true } }),
    tx.item.findMany({ where: { organizationId }, select: { id: true, sku: true, name: true, type: true, isActive: true, inventoryAccountId: true, revenueAccountId: true, cogsAccountId: true }, orderBy: { sku: 'asc' } }),
    tx.inventoryLedgerEntry.groupBy({ by: ['itemId'], where: { organizationId }, _count: { _all: true }, _sum: { valueChange: true } }),
    loadOrgAccountDefaults(tx, organizationId),
  ]);
  const defaults: Defaults = {
    inventory: resolveAccountDefaultId(accounts, settings, 'inventoryAsset'),
    revenue: resolveAccountDefaultId(accounts, settings, 'salesRevenue'),
    cogs: resolveAccountDefaultId(accounts, settings, 'cogsExpense'),
  };
  const movementByItem = new Map(movements.map(movement => [movement.itemId, movement]));
  const findings = items.flatMap(item => {
    const issues = inspectItemAccountMappings(item, accounts, defaults);
    if (!issues.length) return [];
    const movement = movementByItem.get(item.id);
    return [{ itemId: item.id, sku: item.sku, name: item.name, type: item.type, active: item.isActive,
      inventoryMovementCount: movement?._count._all ?? 0,
      inventoryLedgerValue: movement?._sum.valueChange?.toString() ?? '0', issues }];
  });
  return { organizationId, defaults, itemsReviewed: items.length, findings,
    interpretation: 'Configuration comparison only; movement values are not a reconciliation to GL. Review historical journals and source documents before changing mappings.' };
}

import { afterAll, describe, expect, it } from 'vitest';
import { auditItemAccountMappings } from '../../item-account-audit';
import { createTestOrg, disconnect, prisma } from './harness';

afterAll(disconnect);

describe('item account audit against PostgreSQL', () => {
  it('reports company-scoped mismatches and movement totals without changing data', async () => {
    const a = await createTestOrg();
    const b = await createTestOrg();
    const other = await prisma.account.create({ data: { organizationId: a.orgId, code: '1390', name: 'Other inventory', type: 'ASSET', normalSide: 'DEBIT' } });
    const item = await prisma.item.create({ data: { organizationId: a.orgId, sku: 'AUDIT-A', name: 'A', inventoryAccountId: other.id } });
    await prisma.item.create({ data: { organizationId: b.orgId, sku: 'AUDIT-B', name: 'B', inventoryAccountId: other.id } });
    await prisma.inventoryLedgerEntry.create({ data: { organizationId: a.orgId, itemId: item.id, date: new Date('2026-01-01'), documentType: 'OPENING', documentId: item.id, qtyIn: 1, valueChange: '123.45' } });
    const before = await prisma.inventoryLedgerEntry.count({ where: { organizationId: a.orgId } });
    const report = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return auditItemAccountMappings(tx, a.orgId);
    });
    expect(report.itemsReviewed).toBe(1);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ itemId: item.id, inventoryMovementCount: 1, inventoryLedgerValue: '123.45', issues: [
      { role: 'inventory', configuredId: other.id, defaultId: a.accounts.inventoryAsset, problems: ['differs_from_company_default'] },
    ] });
    expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: a.orgId } })).toBe(before);
    await expect(prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.item.update({ where: { id: item.id }, data: { name: 'Changed' } });
    })).rejects.toThrow();
    expect((await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).name).toBe('A');
  });
});

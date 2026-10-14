import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { postBillToLedger } from '@/lib/bill-posting';
import { POST as switchCosting } from '@/src/app/api/v1/inventory/recalculate-costing/route';
import { prisma, createTestOrg, createVendor, createItem, cleanupOrg, disconnect,
  inventoryLedgerValue, inventoryLotValue, accountBalance } from './harness';

afterAll(disconnect);

describe('INV-02: changing the valuation method preserves recorded stock and receipt history', () => {
  it('does not create rounding value or replace the original receipt lots', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    try {
      const itemId = await createItem(org.orgId, 1000), vendorId = await createVendor(org.orgId);
      const date = new Date('2026-09-10');
      for (const [number, quantity, price] of [['A', 3, 1000.5], ['B', 4, 1200.25]] as const) {
        const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number, issueDate: date,
          status: 'OPEN', totalAmount: quantity * price,
          lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity, price, lineTotal: quantity * price } } }, include: { lines: true } });
        await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
      }
      const lotsBefore = await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId }, orderBy: { id: 'asc' } });
      const request = new NextRequest('http://localhost/api/v1/inventory/recalculate-costing', {
        method: 'POST', headers: { 'x-org-id': org.orgId, 'x-user-id': 'finance-reviewer', 'x-role-type': 'ADMIN', 'content-type': 'application/json' },
        body: JSON.stringify({ newMethod: 'WEIGHTED_AVERAGE', effectiveDate: '2026-09-10' }),
      });
      expect((await switchCosting(request)).status).toBe(200);
      // 3 × 1000.50 + 4 × 1200.25 = 7802.50. Changing a future costing rule
      // is not a purchase, sale or valuation loss; it must not invent two cents.
      expect({ ledger: await inventoryLedgerValue(org.orgId), gl: await accountBalance(org.orgId, org.accounts.inventoryAsset),
        lots: await inventoryLotValue(org.orgId) }).toEqual({ ledger: 7802.5, gl: 7802.5, lots: 7802.5 });
      const lotsAfter = await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId }, orderBy: { id: 'asc' } });
      expect(lotsAfter).toEqual(lotsBefore);
    } finally { await cleanupOrg(org.orgId); }
  });
});

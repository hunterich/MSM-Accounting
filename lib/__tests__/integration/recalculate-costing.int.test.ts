import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { postBillToLedger } from '@/lib/bill-posting';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { POST as changeMethod } from '@/src/app/api/v1/inventory/recalculate-costing/route';
import { prisma, createTestOrg, createItem, createVendor, createCustomer, cleanupOrg, disconnect,
  inventoryLotValue, inventoryLedgerValue, accountBalance, assertTrialBalanced } from './harness';

afterAll(disconnect);
const DATE = new Date('2026-09-10');
function request(orgId: string, newMethod: string, effectiveDate = '2026-09-10') {
  return new NextRequest('http://localhost/api/v1/inventory/recalculate-costing', { method: 'POST', headers: {
    'x-org-id': orgId, 'x-user-id': 'finance-reviewer', 'x-role-type': 'ADMIN', 'content-type': 'application/json',
  }, body: JSON.stringify({ newMethod, effectiveDate }) });
}
async function fixture() {
  const org = await createTestOrg(), itemId = await createItem(org.orgId), vendorId = await createVendor(org.orgId), customerId = await createCustomer(org.orgId);
  for (const [number, quantity, price] of [['A', 3, 1000.5], ['B', 4, 1200.25]] as const) {
    const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number, issueDate: DATE, status: 'OPEN', totalAmount: quantity * price,
      lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity, price, lineTotal: quantity * price } } }, include: { lines: true } });
    await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
  }
  return { org, itemId, customerId };
}
type F = Awaited<ReturnType<typeof fixture>>;
async function sell(f: F, quantity: number, number: string) {
  const invoice = await prisma.salesInvoice.create({ data: { organizationId: f.org.orgId, customerId: f.customerId, number,
    issueDate: DATE, status: 'SENT', totalAmount: quantity * 3000, subtotal: quantity * 3000,
    lines: { create: { itemId: f.itemId, lineNo: 1, description: 'Stock', quantity, price: 3000, lineSubtotal: quantity * 3000 } } } });
  await prisma.$transaction(tx => postInvoiceSend(tx, f.org.orgId, invoice.id));
}
describe('prospective inventory method change at unchanged book value', () => {
  it('blends carrying values without replacing receipts or creating rounding journals', async () => {
    const f = await fixture();
    try {
      const lots = await prisma.inventoryLot.findMany({ where: { organizationId: f.org.orgId }, orderBy: { id: 'asc' } });
      const journals = await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } });
      const response = await changeMethod(request(f.org.orgId, 'WEIGHTED_AVERAGE'));
      expect(response.status).toBe(200);
      expect((await response.json()).totalValueChange).toBe(0);
      const after = await prisma.inventoryLot.findMany({ where: { organizationId: f.org.orgId }, orderBy: { id: 'asc' } });
      expect(after.map(lot => lot.id)).toEqual(lots.map(lot => lot.id));
      expect(after.map(lot => lot.unitCost.toString())).toEqual(lots.map(lot => lot.unitCost.toString()));
      expect(await inventoryLotValue(f.org.orgId)).toBe(7802.5);
      expect(await inventoryLedgerValue(f.org.orgId)).toBe(7802.5);
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(7802.5);
      expect(await prisma.journalEntry.count({ where: { organizationId: f.org.orgId } })).toBe(journals);
    } finally { await cleanupOrg(f.org.orgId); }
  });
  it('WA to FIFO freezes current carrying value and later sales exhaust it exactly', async () => {
    const f = await fixture();
    try {
      expect((await changeMethod(request(f.org.orgId, 'WEIGHTED_AVERAGE'))).status).toBe(200);
      await sell(f, 4, 'WA');
      expect(await inventoryLedgerValue(f.org.orgId)).toBe(3343.93);
      expect((await changeMethod(request(f.org.orgId, 'FIFO'))).status).toBe(200);
      await sell(f, 1, 'FIFO-A'); await sell(f, 2, 'FIFO-B');
      expect(await inventoryLotValue(f.org.orgId)).toBe(0);
      expect(await inventoryLedgerValue(f.org.orgId)).toBe(0);
      expect(await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset)).toBe(0);
      expect(await accountBalance(f.org.orgId, f.org.accounts.cogsExpense)).toBe(7802.5);
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanupOrg(f.org.orgId); }
  });
  it('closed-period method change rolls back method, carrying values and journals', async () => {
    const f = await fixture();
    try {
      await prisma.accountingPeriod.create({ data: { organizationId: f.org.orgId, name: 'September', startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30T23:59:59Z'), status: 'CLOSED' } });
      const before = await prisma.inventoryLot.findMany({ where: { organizationId: f.org.orgId }, orderBy: { id: 'asc' } });
      expect((await changeMethod(request(f.org.orgId, 'WEIGHTED_AVERAGE'))).status).toBe(422);
      expect(await prisma.inventoryLot.findMany({ where: { organizationId: f.org.orgId }, orderBy: { id: 'asc' } })).toEqual(before);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: f.org.orgId } })).costingMethod).toBe('FIFO');
    } finally { await cleanupOrg(f.org.orgId); }
  });
  it('unrecorded physical lots refuse instead of inventing a migration value', async () => {
    const org = await createTestOrg();
    try {
      const itemId = await createItem(org.orgId);
      await prisma.inventoryLot.create({ data: { organizationId: org.orgId, itemId, date: DATE, documentType: 'ADJUSTMENT', documentId: 'LEGACY', qtyIn: 1, qtyBalance: 1, unitCost: 1000 } });
      expect((await changeMethod(request(org.orgId, 'WEIGHTED_AVERAGE'))).status).toBe(422);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } })).costingMethod).toBe('FIFO');
    } finally { await cleanupOrg(org.orgId); }
  });
  it.each(['2026-02-30', 'not-a-date', '2026-09-10T00:00:00Z'])('rejects invalid effective date %s', async effective => {
    const org = await createTestOrg();
    try { expect((await changeMethod(request(org.orgId, 'WEIGHTED_AVERAGE', effective))).status).toBe(400); }
    finally { await cleanupOrg(org.orgId); }
  });
});

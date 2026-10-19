import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as receivePo } from '@/src/app/api/v1/purchase-orders/[id]/receive/route';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { unreceiveGoodsReceipt } from '@/lib/unreceive-goods';
import { prisma, createTestOrg, createItem, createVendor, createCustomer, cleanupOrg, disconnect,
  accountBalance, inventoryLedgerValue, inventoryLotValue, assertTrialBalanced } from './harness';

afterAll(disconnect);

describe('zero-value PO receipts preserve physical stock and shortage settlements', () => {
  for (const method of ['FIFO', 'WEIGHTED_AVERAGE'] as const) for (const shortage of [false, true]) {
    if (method === 'FIFO' && shortage) continue;
    it(`${method}: receives and un-receives free goods ${shortage ? 'against a tracked shortage' : 'into an empty pool'}`, async () => {
      const org = await createTestOrg({ costingMethod: method, allowNegativeStock: true });
      try {
        const itemId = await createItem(org.orgId, 100), vendorId = await createVendor(org.orgId);
        if (shortage) {
          const customerId = await createCustomer(org.orgId);
          const sale = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId,
            number: 'ESTIMATED-SALE', issueDate: new Date(), status: 'SENT', totalAmount: 600, subtotal: 600,
            lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: 2, price: 300, lineSubtotal: 600 } } } });
          await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, sale.id, { allowNegativeStock: true }));
        }
        const po = await prisma.purchaseOrder.create({ data: { organizationId: org.orgId, vendorId,
          number: 'FREE-PO', date: new Date(), status: 'APPROVED', totalAmount: 0,
          lines: { create: { itemId, lineNo: 1, description: 'Free stock', quantity: 2, price: 0, lineTotal: 0 } } }, include: { lines: true } });
        const response = await receivePo(new NextRequest(`http://localhost/api/v1/purchase-orders/${po.id}/receive`, {
          method: 'POST', headers: { 'x-org-id': org.orgId, 'x-user-id': 'zero-receipt-test', 'x-role-type': 'ADMIN', 'content-type': 'application/json' },
          body: JSON.stringify({ lines: [{ purchaseOrderLineId: po.lines[0].id, qtyReceived: 2 }] }),
        }), { params: Promise.resolve({ id: po.id }) });
        expect(response.status, await response.clone().text()).toBe(201);
        const receipt = await prisma.bill.findFirstOrThrow({ where: { organizationId: org.orgId, poId: po.id } });
        const lot = await prisma.inventoryLot.findFirstOrThrow({ where: { organizationId: org.orgId, documentId: receipt.id } });
        expect([lot.qtyIn, lot.qtyOut, lot.qtyBalance, lot.unitCost, lot.initialValue, lot.carryingValue].map(Number))
          .toEqual([2, shortage ? 2 : 0, shortage ? 0 : 2, 0, 0, 0]);
        expect(await inventoryLedgerValue(org.orgId)).toBe(0);
        expect(await inventoryLotValue(org.orgId)).toBe(0);
        expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(0);
        expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(0);
        expect(await accountBalance(org.orgId, org.accounts.grIrClearing)).toBe(0);
        expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(shortage ? 3 : 0);
        if (shortage) {
          const row = await prisma.inventoryShortfallSettlement.findFirstOrThrow({ where: { organizationId: org.orgId } });
          expect([row.quantity, row.estimatedValue, row.actualValue, row.cogsAdjustment].map(Number)).toEqual([2, 200, 0, -200]);
          expect(row.receiptLotId).toBe(lot.id);
        }
        const date = new Date();
        await prisma.$transaction(tx => unreceiveGoodsReceipt(tx, org.orgId, receipt.id, { date }));
        expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('APPROVED');
        expect(Number((await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: po.lines[0].id } })).receivedQty)).toBe(0);
        expect(await prisma.inventoryLot.count({ where: { organizationId: org.orgId } })).toBe(0);
        expect(await inventoryLedgerValue(org.orgId)).toBe(shortage ? -200 : 0);
        expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(shortage ? -200 : 0);
        expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(shortage ? 200 : 0);
        expect(await accountBalance(org.orgId, org.accounts.grIrClearing)).toBe(0);
        await assertTrialBalanced(org.orgId);
      } finally { await cleanupOrg(org.orgId); }
    });
  }
});

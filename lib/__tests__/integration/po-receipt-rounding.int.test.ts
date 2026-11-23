import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createPo } from '@/src/app/api/v1/purchase-orders/route';
import { PUT as updatePo } from '@/src/app/api/v1/purchase-orders/[id]/route';
import { POST as receivePo } from '@/src/app/api/v1/purchase-orders/[id]/receive/route';
import { POST as createBill } from '@/src/app/api/v1/bills/route';
import { PUT as updateBill } from '@/src/app/api/v1/bills/[id]/route';
import { unreceiveGoodsReceipt } from '@/lib/unreceive-goods';
import {
  accountBalance, assertTrialBalanced, cleanupOrg, createItem, createTestOrg, createVendor,
  disconnect, inventoryLedgerValue, inventoryLotValue, prisma,
} from './harness';

afterAll(disconnect);

it.each([
  { name: 'two goods receipts', rate: 0, inclusive: false, direct: false, total: '6.67', net: 6.67, tax: 0, bills: ['3.34', '3.33'] },
  { name: 'a goods receipt and a direct PO bill with exclusive PPN', rate: 10, inclusive: false, direct: true, total: '7.34', net: 6.67, tax: 0.67, bills: ['3.67', '3.67'] },
  { name: 'unreceiving and replacing a receipt with inclusive PPN', rate: 11, inclusive: true, direct: false, total: '6.67', net: 6.01, tax: 0.66, bills: ['3.34', '3.33'] },
])('allocates the PO value and clears GR/IR for $name', async ({ rate, inclusive, direct, total, net, tax, bills }) => {
  const org = await createTestOrg();
  const user = await prisma.user.create({ data: { email: `po-rounding-${randomUUID()}@test.local`, fullName: 'PO rounding test', status: 'ACTIVE' } });
  try {
    const role = await prisma.role.create({ data: { organizationId: org.orgId, name: 'Admin', roleType: 'ADMIN' } });
    await prisma.userOrganization.create({ data: { organizationId: org.orgId, userId: user.id, roleId: role.id } });
    const vendorId = await createVendor(org.orgId);
    const itemId = await createItem(org.orgId);
    const today = new Date().toISOString().slice(0, 10);
    const headers = { 'x-org-id': org.orgId, 'x-user-id': user.id, 'x-role-type': 'ADMIN', 'content-type': 'application/json' };
    const request = (path: string, method: 'POST' | 'PUT', body: unknown) => new NextRequest(`http://localhost/api/v1/${path}`, {
      method, headers, body: JSON.stringify(body),
    });
    const params = (id: string) => ({ params: Promise.resolve({ id }) });
    const item = { itemId, description: 'Stock', quantity: 1, price: '7.25', discountPct: '8', lineTotal: '6.68' };
    const taxTerms = { taxable: rate > 0, taxRate: rate, taxInclusive: inclusive };
    const draft = await createPo(request('purchase-orders', 'POST', {
      vendorId, date: today, ...taxTerms, status: 'DRAFT', totalAmount: '6.68', lines: [item],
    }));
    expect(draft.status, await draft.clone().text()).toBe(201);
    const draftOrder = await draft.json();
    expect(Number(draftOrder.totalAmount).toFixed(2)).toBe(total);
    const poId = draftOrder.id as string;
    const poResponse = await updatePo(request(`purchase-orders/${poId}`, 'PUT', {
      status: 'APPROVED', lines: [item],
    }), params(poId));
    expect(poResponse.status, await poResponse.clone().text()).toBe(200);
    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
    expect(po.totalAmount.toFixed(2)).toBe(total);
    expect(po.lines[0].lineTotal.toFixed(2)).toBe('6.67');
    expect(po.lines[0].discountPct.toString()).toBe('8');
    const purchaseOrderLineId = po.lines[0].id;
    const halfLine = { ...item, purchaseOrderLineId, quantity: '0.5', lineTotal: '3.34' };

    const receiveHalf = async () => {
      const response = await receivePo(request(`purchase-orders/${poId}/receive`, 'POST', {
        lines: [{ purchaseOrderLineId, qtyReceived: 0.5 }],
      }), params(poId));
      expect(response.status, await response.clone().text()).toBe(201);
      return (await response.json()).billId as string;
    };
    let first = await receiveHalf();
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: first } })).totalAmount.toFixed(2)).toBe(bills[0]);
    expect(await accountBalance(org.orgId, org.accounts.grIrClearing)).toBe(-(inclusive ? 3.01 : 3.34));
    let second: string;
    if (direct) {
      const response = await createBill(request('bills', 'POST', {
        vendorId, poId, issueDate: today, vendorInvoiceNo: 'DIRECT', status: 'OPEN', ...taxTerms, lines: [halfLine],
      }));
      expect(response.status, await response.clone().text()).toBe(201);
      const saved = await response.json();
      expect(saved.lines[0]).toMatchObject({ lineTotal: '3.33', poReceiptTaxAmount: '0.34' });
      second = saved.id;
    } else {
      second = await receiveHalf();
      if (inclusive) {
        await prisma.$transaction(tx => unreceiveGoodsReceipt(tx, org.orgId, first, { date: new Date() }));
        first = await receiveHalf();
      }
    }
    const lots = await prisma.inventoryLot.findMany({ where: { documentId: { in: [first, second] } } });
    expect(lots).toHaveLength(2);
    expect(lots.map(lot => lot.initialValue?.toFixed(2)).sort()).toEqual(inclusive ? ['3.00', '3.01'] : ['3.33', '3.34']);
    expect(await inventoryLotValue(org.orgId)).toBe(net);
    expect(await inventoryLedgerValue(org.orgId)).toBe(net);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(net);
    expect(await accountBalance(org.orgId, org.accounts.grIrClearing)).toBe(direct ? -3.34 : -net);

    for (const [index, id] of [first, second].entries()) {
      if (direct && index === 1) continue;
      const response = await updateBill(request(`bills/${id}`, 'PUT', {
        status: 'OPEN', vendorInvoiceNo: `SUPPLIER-${index + 1}`, lines: [halfLine],
      }), params(id));
      expect(response.status, await response.clone().text()).toBe(200);
      // The second receipt keeps Rp3.33 even when the edited payload contains Rp3.34.
      expect((await response.json()).totalAmount).toBe(bills[index]);
    }
    const savedBills = await prisma.bill.findMany({
      where: { id: { in: [first, second] } }, include: { lines: true },
    });
    expect(savedBills.map(bill => bill.totalAmount.toFixed(2)).sort()).toEqual([...bills].sort());
    expect(savedBills.map(bill => bill.lines[0].lineTotal.toFixed(2)).sort()).toEqual(['3.33', '3.34']);
    expect(savedBills[0].totalAmount.plus(savedBills[1].totalAmount).toFixed(2)).toBe(total);
    expect(await accountBalance(org.orgId, org.accounts.apControl)).toBe(-Number(total));
    expect(await accountBalance(org.orgId, org.accounts.apTax)).toBe(tax);
    expect(await accountBalance(org.orgId, org.accounts.grIrClearing)).toBe(0);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(net);
    expect(await inventoryLedgerValue(org.orgId)).toBe(net);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } })).status).toBe('CLOSED');
    expect((await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: purchaseOrderLineId } })).receivedQty.toString()).toBe('1');
    await assertTrialBalanced(org.orgId);
  } finally {
    await cleanupOrg(org.orgId);
    await prisma.user.delete({ where: { id: user.id } });
  }
});

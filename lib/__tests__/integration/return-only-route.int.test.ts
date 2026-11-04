import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { POST } from '@/src/app/api/v1/sales-returns/route';
import { PUT } from '@/src/app/api/v1/sales-returns/[id]/route';
import { addCostLayer } from '@/lib/inventory-costing';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { prisma, createTestOrg, createCustomer, createItem, cleanupOrg, disconnect } from './harness';

afterAll(disconnect);
const date = '2026-09-01';

describe('return without a credit note', () => {
  for (const method of ['POST', 'PUT'] as const) for (const received of [true, false]) {
    it(`${method} APPROVED, goods ${received ? 'received' : 'kept'}`, async () => {
      const org = await createTestOrg({ costingMethod: 'FIFO' });
      const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, fullName: 'QA', passwordHash: 'x', status: 'ACTIVE' } });
      try {
        const role = await prisma.role.create({ data: { organizationId: org.orgId, name: 'Admin', roleType: 'ADMIN' } });
        await prisma.userOrganization.create({ data: { organizationId: org.orgId, userId: user.id, roleId: role.id } });
        const customerId = await createCustomer(org.orgId), itemId = await createItem(org.orgId);
        await prisma.$transaction(tx => addCostLayer(tx, org.orgId, itemId, null, 3, 100, 'PURCHASE', 'receipt', new Date(date)));
        const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'INV-1', issueDate: new Date(date), status: 'SENT', subtotal: 600, totalAmount: 600, lines: { create: { lineNo: 1, itemId, description: 'Item', quantity: 2, price: 300, lineSubtotal: 600 } } }, include: { lines: true } });
        await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id));
        const body = { customerId, invoiceId: invoice.id, returnDate: date, status: method === 'POST' ? 'APPROVED' : 'DRAFT', lines: [{ itemId, sourceInvoiceLineId: invoice.lines[0].id, itemName: 'Item', qtyReturn: 1, qtySold: 2, price: 300, goodsReceived: received }] };
        const request = (verb: string, data: unknown) => new NextRequest('http://localhost/api/v1/sales-returns', { method: verb, headers: { 'x-org-id': org.orgId, 'x-user-id': user.id, 'x-role-type': 'ADMIN', 'content-type': 'application/json' }, body: JSON.stringify(data) });
        const created = await POST(request('POST', body));
        expect(created.status, await created.clone().text()).toBe(201);
        const row = await created.json();
        const id = row.id ?? row.data?.id;
        if (method === 'PUT') {
          const updated = await PUT(request('PUT', { status: 'APPROVED' }), { params: Promise.resolve({ id }) });
          expect(updated.status, await updated.clone().text()).toBe(200);
        }
        const ret = await prisma.salesReturn.findUniqueOrThrow({ where: { id }, include: { lines: true } });
        expect(ret.status).toBe('APPROVED');
        expect(ret.postedAt).toBeTruthy();
        expect(await prisma.creditNote.count({ where: { organizationId: org.orgId } })).toBe(0);
        expect(Number(ret.lines[0].inventoryCost)).toBe(received ? 100 : 0);
        if (received) {
          const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: ret.journalEntryId! }, include: { lines: true } });
          expect(je.lines.map(l => [l.accountId, Number(l.debit), Number(l.credit)]).sort()).toEqual([[org.accounts.inventoryAsset, 100, 0], [org.accounts.cogsExpense, 0, 100]].sort());
        } else {
          expect(ret.journalEntryId).toBeNull();
          expect(await prisma.inventoryLedgerEntry.count({ where: { documentId: id, organizationId: org.orgId } })).toBe(0);
        }
      } finally { await cleanupOrg(org.orgId); await prisma.user.delete({ where: { id: user.id } }); }
    });
  }
});

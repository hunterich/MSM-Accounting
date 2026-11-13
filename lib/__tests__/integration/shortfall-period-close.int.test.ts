import { NextRequest } from 'next/server';
import { POST as createBill } from '@/src/app/api/v1/bills/route';
import { POST as reopenPeriod } from '@/src/app/api/v1/accounting-periods/[id]/reopen/route';
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { postBillToLedger } from '@/lib/bill-posting';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { closeAccountingPeriod } from '@/lib/period-close';
import { assertPeriodOpen } from '@/lib/period-guard';
import { prisma, createTestOrg, createItem, createVendor, createCustomer, cleanupOrg, disconnect, accountBalance, inventoryLedgerValue, inventoryLotValue, assertTrialBalanced } from './harness';

afterAll(disconnect);
const saleDate = new Date('2026-09-10'), receiptDate = new Date('2026-10-02');
function signal<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function snapshot(orgId: string) {
  const where = { organizationId: orgId }, orderBy = { id: 'asc' as const };
  return { lots: await prisma.inventoryLot.findMany({ where, orderBy }), ledger: await prisma.inventoryLedgerEntry.findMany({ where, orderBy, include: { lotDraws: { orderBy } } }),
    journals: await prisma.journalEntry.findMany({ where, orderBy, include: { lines: { orderBy } } }),
    settlements: await prisma.inventoryShortfallSettlement.findMany({ where, orderBy }),
    invoices: await prisma.salesInvoice.findMany({ where, orderBy }), bills: await prisma.bill.findMany({ where, orderBy }) };
}

describe('weighted-average shortage receipt versus period close', () => {
  for (const closeFirst of [true, false]) it(`${closeFirst ? 'close' : 'receipt'} commits first without a partial settlement`, async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE', allowNegativeStock: true });
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, fullName: 'Close QA', status: 'ACTIVE' } });
    const ready = signal<void>(), release = signal<void>(), pid = signal<number>();
    let firstResult: Promise<unknown> | undefined, secondResult: Promise<unknown> | undefined;
    try {
      const itemId = await createItem(org.orgId, 100), customerId = await createCustomer(org.orgId), vendorId = await createVendor(org.orgId);
      const sale = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'SALE', issueDate: saleDate, status: 'SENT', subtotal: 600, totalAmount: 600,
        lines: { create: { itemId, lineNo: 1, description: 'Item', quantity: 2, price: 300, lineSubtotal: 600 } } } });
      await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, sale.id, { allowNegativeStock: true }));
      const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: 'RECEIPT', issueDate: receiptDate, status: 'OPEN', totalAmount: 240,
        lines: { create: { itemId, lineNo: 1, description: 'Item', quantity: 2, price: 120, lineTotal: 240 } } }, include: { lines: true } });
      const period = await prisma.accountingPeriod.create({ data: { organizationId: org.orgId, name: 'October', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31T23:59:59.999Z'), status: 'OPEN' } });
      const before = await snapshot(org.orgId);
      const receipt = async (tx: Parameters<typeof postBillToLedger>[0]) => { await assertPeriodOpen(tx, org.orgId, receiptDate, { overrideDateRestriction: true }); await postBillToLedger(tx, org.orgId, bill); };
      const first = prisma.$transaction(async tx => { if (closeFirst) await closeAccountingPeriod(tx, org.orgId, user.id, period.id); else await receipt(tx); ready.resolve(); await release.promise; }, { timeout: 15000 });
      firstResult = first.then(() => null, error => error);
      await Promise.race([ready.promise, first.then(() => { throw new Error('First transaction did not hold its locks'); })]);
      secondResult = prisma.$transaction(async tx => {
        const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; pid.resolve(row.pid);
        if (closeFirst) await receipt(tx); else await closeAccountingPeriod(tx, org.orgId, user.id, period.id);
      }, { timeout: 15000 }).then(() => null, error => error);
      const backend = await pid.promise, deadline = Date.now() + 3000; let blocked = false;
      while (Date.now() < deadline) { const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT cardinality(pg_blocking_pids(${backend}::int)) > 0 AS blocked`; if (row.blocked) { blocked = true; break; } await new Promise(done => setTimeout(done, 10)); }
      expect(blocked, 'contender must wait on a PostgreSQL lock').toBe(true);
      release.resolve(); expect(await firstResult).toBeNull();
      if (closeFirst) expect(await secondResult).toMatchObject({ status: 422 }); else expect(await secondResult).toBeNull();
      expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: period.id } })).status).toBe('CLOSED');
      if (closeFirst) expect(await snapshot(org.orgId)).toEqual(before);
      const settlements = await prisma.inventoryShortfallSettlement.findMany({ where: { organizationId: org.orgId } });
      expect(settlements).toHaveLength(closeFirst ? 0 : 1);
      if (!closeFirst) expect([settlements[0].quantity, settlements[0].estimatedValue, settlements[0].actualValue, settlements[0].cogsAdjustment].map(Number)).toEqual([2, 200, 240, 40]);
      expect(await inventoryLedgerValue(org.orgId)).toBe(closeFirst ? -200 : 0);
      expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(closeFirst ? -200 : 0);
      expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(closeFirst ? 200 : 240);
      expect(await accountBalance(org.orgId, org.accounts.apControl)).toBe(closeFirst ? 0 : -240);
      expect(await inventoryLotValue(org.orgId)).toBe(0);
      await assertTrialBalanced(org.orgId);
    } finally { release.resolve(); await firstResult; await secondResult; await cleanupOrg(org.orgId); await prisma.user.delete({ where: { id: user.id } }); }
  });
});

it('real bill route refuses a closed-period shortage receipt and posts exactly once after reopen', async () => {
  const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE', allowNegativeStock: true });
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, fullName: 'Reopen QA', status: 'ACTIVE' } });
  try {
    const role = await prisma.role.create({ data: { organizationId: org.orgId, name: 'Admin', roleType: 'ADMIN' } });
    await prisma.userOrganization.create({ data: { organizationId: org.orgId, userId: user.id, roleId: role.id } });
    const itemId = await createItem(org.orgId, 100), customerId = await createCustomer(org.orgId), vendorId = await createVendor(org.orgId);
    const sale = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'SALE', issueDate: saleDate, status: 'SENT', subtotal: 600, totalAmount: 600,
      lines: { create: { itemId, lineNo: 1, description: 'Item', quantity: 2, price: 300, lineSubtotal: 600 } } } });
    await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, sale.id, { allowNegativeStock: true }));
    const period = await prisma.accountingPeriod.create({ data: { organizationId: org.orgId, name: 'October', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31T23:59:59.999Z'), status: 'CLOSED', isLocked: true } });
    const headers = { 'x-org-id': org.orgId, 'x-user-id': user.id, 'x-role-type': 'ADMIN', 'content-type': 'application/json' };
    const body = { vendorId, vendorInvoiceNo: 'RECEIPT-1', issueDate: '2026-10-02', status: 'OPEN', taxable: false, subtotal: 240, totalAmount: 240,
      lines: [{ lineNo: 1, itemId, description: 'Item', quantity: 2, price: 120, lineTotal: 240 }] };
    const create = () => createBill(new NextRequest('http://localhost/api/v1/bills', { method: 'POST', headers, body: JSON.stringify(body) }));
    const before = await snapshot(org.orgId);
    const denied = await create(); expect(denied.status, await denied.clone().text()).toBe(422);
    expect(await snapshot(org.orgId)).toEqual(before);
    const reopened = await reopenPeriod(new NextRequest('http://localhost/api/v1/accounting-periods/reopen', { method: 'POST', headers }), { params: Promise.resolve({ id: period.id }) });
    expect(reopened.status, await reopened.clone().text()).toBe(200);
    const accepted = await create(); expect(accepted.status, await accepted.clone().text()).toBe(201);
    expect(await prisma.inventoryShortfallSettlement.count({ where: { organizationId: org.orgId } })).toBe(1);
    expect(await inventoryLedgerValue(org.orgId)).toBe(0);
    expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(0);
    expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(240);
    expect(await accountBalance(org.orgId, org.accounts.apControl)).toBe(-240);
    const after = await snapshot(org.orgId);
    const duplicate = await create(); expect(duplicate.status, await duplicate.clone().text()).toBe(409);
    expect(await snapshot(org.orgId)).toEqual(after);
    await assertTrialBalanced(org.orgId);
  } finally { await cleanupOrg(org.orgId); await prisma.user.delete({ where: { id: user.id } }); }
});

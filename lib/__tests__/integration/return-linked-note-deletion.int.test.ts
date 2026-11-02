import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { DELETE as deleteSales } from '@/src/app/api/v1/sales-returns/[id]/route';
import { DELETE as deletePurchase } from '@/src/app/api/v1/purchase-returns/[id]/route';
import { DELETE as deleteCredit, PUT as putCredit } from '@/src/app/api/v1/credit-notes/[id]/route';
import { DELETE as deleteDebit, PUT as putDebit } from '@/src/app/api/v1/debit-notes/[id]/route';
import { prisma, createTestOrg, createCustomer, createVendor, cleanupOrg, disconnect } from './harness';

afterAll(disconnect);
const date = new Date('2026-09-01T00:00:00Z');
type Kind = 'ar' | 'ap';
async function fixture(kind: Kind) {
  const org = await createTestOrg(), customerId = await createCustomer(org.orgId), vendorId = await createVendor(org.orgId);
  const role = await prisma.role.create({ data: { organizationId: org.orgId, name: 'Admin', roleType: 'ADMIN' } });
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, fullName: 'QA', passwordHash: 'x', status: 'ACTIVE' } });
  await prisma.userOrganization.create({ data: { organizationId: org.orgId, userId: user.id, roleId: role.id } });
  const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'INV-1', issueDate: date } });
  const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: 'B-1', issueDate: date } });
  const ret = kind === 'ar'
    ? await prisma.salesReturn.create({ data: { organizationId: org.orgId, customerId, invoiceId: invoice.id, number: 'SR-1', returnDate: date,
      lines: { create: { lineNo: 1, itemName: 'Service', qtyReturn: 1 } } } })
    : await prisma.purchaseReturn.create({ data: { organizationId: org.orgId, vendorId, billId: bill.id, number: 'PR-1', returnDate: date,
      lines: { create: { lineNo: 1, description: 'Service', qtyReturn: 1 } } } });
  const note = kind === 'ar'
    ? await prisma.creditNote.create({ data: { organizationId: org.orgId, customerId, sourceInvoiceId: invoice.id, salesReturnId: ret.id, number: 'CN-1', date, amount: 10 } })
    : await prisma.debitNote.create({ data: { organizationId: org.orgId, vendorId, sourceBillId: bill.id, purchaseReturnId: ret.id, number: 'DN-1', date, amount: 10 } });
  return { kind, org, user, ret, note, customerId, vendorId, invoice, bill };
}
type F = Awaited<ReturnType<typeof fixture>>;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
function req(f: F, method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/v1/test', { method, headers: {
    'x-org-id': f.org.orgId, 'x-user-id': f.user.id, 'x-role-type': 'ADMIN', 'content-type': 'application/json',
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const removeReturn = (f: F) => (f.kind === 'ar' ? deleteSales : deletePurchase)(req(f, 'DELETE'), params(f.ret.id));
const removeNote = (f: F) => (f.kind === 'ar' ? deleteCredit : deleteDebit)(req(f, 'DELETE'), params(f.note.id));
const unlink = (f: F) => (f.kind === 'ar' ? putCredit : putDebit)(req(f, 'PUT', f.kind === 'ar' ? { salesReturnId: null } : { purchaseReturnId: null }), params(f.note.id));
async function snapshot(f: F) {
  return {
    ret: f.kind === 'ar' ? await prisma.salesReturn.findUnique({ where: { id: f.ret.id }, include: { lines: true } })
      : await prisma.purchaseReturn.findUnique({ where: { id: f.ret.id }, include: { lines: true } }),
    note: f.kind === 'ar' ? await prisma.creditNote.findUnique({ where: { id: f.note.id } })
      : await prisma.debitNote.findUnique({ where: { id: f.note.id } }),
    journals: await prisma.journalEntry.findMany({ where: { organizationId: f.org.orgId }, include: { lines: true } }),
  };
}

describe('return deletion preserves linked financial notes', () => {
  for (const kind of ['ar', 'ap'] as const) {
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPLIED', 'VOID'] as const) {
      it(`${kind}: refuses linked ${status} note with a complete unchanged snapshot`, async () => {
        const f = await fixture(kind);
        try {
          if (kind === 'ar') await prisma.creditNote.update({ where: { id: f.note.id }, data: { status } });
          else await prisma.debitNote.update({ where: { id: f.note.id }, data: { status } });
          const before = await snapshot(f), response = await removeReturn(f);
          expect(response.status).toBe(422);
          expect((await response.json()).error).toContain(`${kind === 'ar' ? 'CN' : 'DN'}-1 (${status})`);
          expect(await snapshot(f)).toEqual(before);
        } finally { await cleanupOrg(f.org.orgId); }
      });
    }
    it(`${kind}: a linked note cannot be unlinked and submitted in one request`, async () => {
      const f = await fixture(kind);
      try {
        const before = await snapshot(f);
        const body = kind === 'ar' ? { status: 'APPLIED', salesReturnId: null } : { status: 'APPLIED', purchaseReturnId: null };
        const response = await (kind === 'ar' ? putCredit : putDebit)(req(f, 'PUT', body), params(f.note.id));
        expect(response.status).toBe(422);
        expect(await snapshot(f)).toEqual(before);
      } finally { await cleanupOrg(f.org.orgId); }
    });
    it(`${kind}: explicit unlink is audited and permits deleting the return without deleting the standalone note`, async () => {
      const f = await fixture(kind);
      try {
        const response = await unlink(f);
        expect(response.status, await response.text()).toBe(200);
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: f.org.orgId, entityId: f.note.id, action: 'UPDATE', payload: { path: ['returnLink', 'before'], equals: f.ret.id } } });
        expect(audit.payload).toMatchObject({ returnLink: { before: f.ret.id, after: null } });
        expect((await removeReturn(f)).status).toBe(200);
        const after = await snapshot(f);
        expect(after.ret).toBeNull();
        expect(after.note).toMatchObject({ id: f.note.id, status: 'DRAFT', [kind === 'ar' ? 'salesReturnId' : 'purchaseReturnId']: null });
        expect(after.journals).toEqual([]);
      } finally { await cleanupOrg(f.org.orgId); }
    });
    it(`${kind}: deleting a draft note records its old return link, then permits return deletion`, async () => {
      const f = await fixture(kind);
      try {
        expect((await removeNote(f)).status).toBe(200);
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: f.org.orgId, entityId: f.note.id, action: 'DELETE' } });
        expect(audit.payload).toMatchObject({ number: f.note.number, [kind === 'ar' ? 'salesReturnId' : 'purchaseReturnId']: f.ret.id });
        expect((await removeReturn(f)).status).toBe(200);
      } finally { await cleanupOrg(f.org.orgId); }
    });
    it(`${kind}: concurrent deletion and note submission both refuse a linked draft return`, async () => {
      const f = await fixture(kind);
      let release!: () => void, ready!: (pid: number) => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const locked = new Promise<number>(resolve => { ready = resolve; });
      const holder = prisma.$transaction(async tx => {
        const ids = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        if (kind === 'ar') await tx.$queryRaw`SELECT "id" FROM "SalesReturn" WHERE "id" = ${f.ret.id} FOR UPDATE`;
        else await tx.$queryRaw`SELECT "id" FROM "PurchaseReturn" WHERE "id" = ${f.ret.id} FOR UPDATE`;
        ready(ids[0].pid);
        await gate;
      }, { timeout: 15000 });
      try {
        const before = await snapshot(f), pid = await locked;
        const deletion = removeReturn(f);
        const submission = (kind === 'ar' ? putCredit : putDebit)(req(f, 'PUT', { status: 'APPLIED' }), params(f.note.id));
        let waiting = 0;
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`;
          waiting = Number(rows[0].count);
          if (waiting >= 2) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        release();
        const [del, submit] = await Promise.all([deletion, submission]);
        expect(waiting).toBeGreaterThanOrEqual(2);
        expect([del.status, submit.status]).toEqual([422, 422]);
        expect(await snapshot(f)).toEqual(before);
      } finally { release(); await holder; await cleanupOrg(f.org.orgId); }
    });
    it(`${kind}: finalized returns cannot be deleted even without linked notes`, async () => {
      const f = await fixture(kind);
      try {
        await removeNote(f);
        if (kind === 'ar') await prisma.salesReturn.update({ where: { id: f.ret.id }, data: { status: 'APPROVED' } });
        else await prisma.purchaseReturn.update({ where: { id: f.ret.id }, data: { status: 'APPROVED' } });
        const before = await snapshot(f);
        expect((await removeReturn(f)).status).toBe(422);
        expect(await snapshot(f)).toEqual(before);
      } finally { await cleanupOrg(f.org.orgId); }
    });
  }
});

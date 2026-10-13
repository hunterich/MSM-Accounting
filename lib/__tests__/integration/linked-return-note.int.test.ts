import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { PUT as putCredit } from '@/src/app/api/v1/credit-notes/[id]/route';
import { PUT as putDebit } from '@/src/app/api/v1/debit-notes/[id]/route';
import { POST as createCredit } from '@/src/app/api/v1/credit-notes/route';
import { POST as createDebit } from '@/src/app/api/v1/debit-notes/route';
import { postBillToLedger } from '@/lib/bill-posting';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { postSalesReturnOnApproval } from '@/lib/sales-return-posting';
import { postPurchaseReturnOnApproval } from '@/lib/purchase-return-posting';
import { postCreditNoteOnApply } from '@/lib/credit-note-posting';
import { postDebitNoteOnApply } from '@/lib/debit-note-posting';
import { voidSalesReturn, voidPurchaseReturn } from '@/lib/return-void';
import { voidCreditNote, voidDebitNote } from '@/lib/note-void';
import { approveRequest, rejectRequest, routeForApproval } from '@/lib/approval/engine';
import { lockEligibleNoteReturn } from '@/lib/note-return-eligibility';
import { postArPaymentIfNeeded, postApPaymentIfNeeded } from '@/lib/payment-posting';
import { prisma, createTestOrg, createItem, createCustomer, createVendor, cleanupOrg, disconnect,
  accountBalance, assertTrialBalanced, assertInventoryReconciled, journalEntryCount } from './harness';

afterAll(disconnect);
const DATE = new Date('2026-07-10');
type Kind = 'ar' | 'ap';
type Tx = Prisma.TransactionClient;

async function fixture(kind: Kind) {
  const org = await createTestOrg();
  const customerId = await createCustomer(org.orgId), vendorId = await createVendor(org.orgId);
  const itemId = await createItem(org.orgId, 100);
  const returnsAccount = await prisma.account.create({ data: { organizationId: org.orgId, code: '5201',
    name: 'Sales Returns', type: 'EXPENSE', normalSide: 'DEBIT' } });
  const clearing = await prisma.account.create({ data: { organizationId: org.orgId, code: '1391',
    name: 'Purchase Return Clearing', type: 'ASSET', normalSide: 'DEBIT' } });
  const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: 'B-STOCK',
    issueDate: DATE, status: 'OPEN', subtotal: 1000, totalAmount: 1000,
    lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: 10, price: 100, lineTotal: 1000 } } }, include: { lines: true } });
  await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
  const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'INV-SALE',
    issueDate: DATE, status: 'SENT', subtotal: 1500, totalAmount: 1500,
    lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: 5, price: 300, lineSubtotal: 1500 } } }, include: { lines: true } });
  if (kind === 'ar') await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id));
  const ret = kind === 'ar'
    ? await prisma.salesReturn.create({ data: { organizationId: org.orgId, customerId, invoiceId: invoice.id, number: 'SR-1',
      returnDate: DATE, status: 'APPROVED', lines: { create: { itemId, sourceInvoiceLineId: invoice.lines[0].id,
        lineNo: 1, itemName: 'Stock', qtyReturn: 2, goodsReceived: true } } } })
    : await prisma.purchaseReturn.create({ data: { organizationId: org.orgId, vendorId, billId: bill.id, number: 'PR-1',
      returnDate: DATE, status: 'APPROVED', returnAccountId: clearing.id,
      lines: { create: { itemId, lineNo: 1, description: 'Stock', qtyReturn: 2 } } } });
  await prisma.$transaction(tx => kind === 'ar' ? postSalesReturnOnApproval(tx, ret.id) : postPurchaseReturnOnApproval(tx, ret.id));
  const note = kind === 'ar'
    ? await prisma.creditNote.create({ data: { organizationId: org.orgId, customerId, sourceInvoiceId: invoice.id,
      salesReturnId: ret.id, number: 'CN-1', date: DATE, amount: 600, status: 'DRAFT', returnAccountId: returnsAccount.id } })
    : await prisma.debitNote.create({ data: { organizationId: org.orgId, vendorId, sourceBillId: bill.id,
      purchaseReturnId: ret.id, number: 'DN-1', date: DATE, amount: 200, status: 'DRAFT', returnAccountId: clearing.id } });
  const role = await prisma.role.create({ data: { organizationId: org.orgId, name: 'Admin', roleType: 'ADMIN' } });
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, fullName: 'Approver', passwordHash: 'x', status: 'ACTIVE' } });
  await prisma.userOrganization.create({ data: { organizationId: org.orgId, userId: user.id, roleId: role.id } });
  return { kind, org, customerId, vendorId, itemId, bill, invoice, ret, note, clearing, returnsAccount,
    actor: { orgId: org.orgId, userId: user.id, roleType: 'ADMIN' } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function request(f: Fixture, method: string, body: unknown) {
  return new NextRequest('http://localhost/api/v1/notes', { method, headers: {
    'x-org-id': f.org.orgId, 'x-user-id': f.actor.userId, 'x-role-type': 'ADMIN', 'content-type': 'application/json',
  }, body: JSON.stringify(body) });
}
function put(f: Fixture, body: unknown = { status: 'APPLIED' }) {
  return (f.kind === 'ar' ? putCredit : putDebit)(request(f, 'PUT', body), { params: Promise.resolve({ id: f.note.id }) });
}
function voidReturn(tx: Tx, f: Fixture) {
  return (f.kind === 'ar' ? voidSalesReturn : voidPurchaseReturn)(tx, f.org.orgId, f.ret.id, { date: DATE });
}
async function apply(tx: Tx, f: Fixture) {
  if (f.kind === 'ar') await tx.creditNote.update({ where: { id: f.note.id }, data: { status: 'APPLIED' } });
  else await tx.debitNote.update({ where: { id: f.note.id }, data: { status: 'APPLIED' } });
  await (f.kind === 'ar' ? postCreditNoteOnApply : postDebitNoteOnApply)(tx, f.note.id);
}
async function state(f: Fixture) {
  const note = f.kind === 'ar' ? await prisma.creditNote.findUniqueOrThrow({ where: { id: f.note.id } })
    : await prisma.debitNote.findUniqueOrThrow({ where: { id: f.note.id } });
  const ret = f.kind === 'ar' ? await prisma.salesReturn.findUniqueOrThrow({ where: { id: f.ret.id } })
    : await prisma.purchaseReturn.findUniqueOrThrow({ where: { id: f.ret.id } });
  const lots = await prisma.inventoryLot.findMany({ where: { organizationId: f.org.orgId } });
  await assertTrialBalanced(f.org.orgId, 'linked note/return');
  await assertInventoryReconciled(f.org.orgId, 'linked note/return');
  return { note: note.status, posted: Boolean(note.journalEntryId), ret: ret.status,
    quantity: lots.reduce((sum, lot) => sum + Number(lot.qtyBalance), 0),
    lotValue: lots.reduce((sum, lot) => sum + Number(lot.qtyBalance) * Number(lot.unitCost), 0),
    inventory: await accountBalance(f.org.orgId, f.org.accounts.inventoryAsset),
    cogs: await accountBalance(f.org.orgId, f.org.accounts.cogsExpense),
    ar: await accountBalance(f.org.orgId, f.org.accounts.arControl),
    ap: await accountBalance(f.org.orgId, f.org.accounts.apControl),
    clearing: await accountBalance(f.org.orgId, f.clearing.id),
    bank: await accountBalance(f.org.orgId, f.org.accounts.bankAsset),
    journals: await journalEntryCount(f.org.orgId) };
}
function expected(f: Fixture, voided = false, applied = false) {
  return f.kind === 'ar'
    ? { quantity: voided ? 5 : 7, lotValue: voided ? 500 : 700, inventory: voided ? 500 : 700,
      cogs: voided ? 500 : 300, ar: applied ? 900 : 1500, ap: -1000, clearing: 0, bank: 0,
      journals: 4 + Number(voided || applied) }
    : { quantity: voided ? 10 : 8, lotValue: voided ? 1000 : 800, inventory: voided ? 1000 : 800,
      cogs: 0, ar: 0, ap: applied ? -800 : -1000, clearing: voided || applied ? 0 : 200, bank: 0,
      journals: 2 + Number(voided || applied) };
}
async function approval(f: Fixture) {
  await prisma.organization.update({ where: { id: f.org.orgId }, data: { approvalRequirements: { [f.kind === 'ar' ? 'ar_credits' : 'ap_debits']: true } } });
  const response = await put(f);
  expect(response.status, await response.text()).toBe(200);
  return prisma.approvalRequest.findFirstOrThrow({ where: { organizationId: f.org.orgId, documentId: f.note.id, status: 'PENDING' } });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
// Observe an actual PostgreSQL wait on the winner, not a timing-based sleep.
async function overlap(first: (tx: Tx) => Promise<void>, second: () => Promise<unknown>) {
  const ready = deferred<number>(), release = deferred<void>();
  const a = prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    await first(tx); ready.resolve(rows[0].pid); await release.promise;
  }, { timeout: 15000 });
  const settledA = a.then(() => undefined, error => error);
  let settledB: Promise<unknown> | undefined;
  try {
    const pid = await Promise.race([ready.promise, a.then(() => { throw new Error('Winner never reached barrier'); })]);
    settledB = second().then(value => value, error => error);
    const deadline = Date.now() + 3000;
    let blocked = false;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS blocked`;
      if (rows[0].blocked) { blocked = true; break; }
      await new Promise(done => setTimeout(done, 10));
    }
    expect(blocked, 'contender must wait on the uncommitted winner').toBe(true);
  } finally { release.resolve(); await settledA; if (settledB) await settledB; }
  if (await settledA) throw await settledA;
  return settledB!;
}

describe('linked notes and physical returns share eligibility and a row lock', () => {
  for (const kind of ['ar', 'ap'] as const) {
    it(`${kind}: draft does not block void; applying afterwards is refused without accounting effects`, async () => {
      const f = await fixture(kind);
      try {
        await prisma.$transaction(tx => voidReturn(tx, f));
        const before = await state(f);
        expect(before).toMatchObject({ ...expected(f, true), ret: 'VOID', note: 'DRAFT', posted: false });
        await expect(prisma.$transaction(tx => apply(tx, f))).rejects.toMatchObject({ status: 422 });
        const response = await put(f);
        expect(response.status).toBe(422);
        expect(await state(f)).toEqual(before);
      } finally { await cleanupOrg(f.org.orgId); }
    });
    it(`${kind}: pending blocks void; rejection through the engine allows void`, async () => {
      const f = await fixture(kind);
      try {
        const req = await approval(f), before = await state(f);
        expect(before).toMatchObject({ ...expected(f), note: 'PENDING_APPROVAL', ret: 'APPROVED', posted: false });
        await expect(prisma.$transaction(tx => voidReturn(tx, f))).rejects.toThrow(/pending/i);
        expect(await state(f)).toEqual(before);
        await rejectRequest(req.id, f.actor, 'Cancel financial return');
        await prisma.$transaction(tx => voidReturn(tx, f));
        expect(await state(f)).toMatchObject({ ...expected(f, true), note: 'DRAFT', ret: 'VOID', posted: false });
        expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('REJECTED');
      } finally { await cleanupOrg(f.org.orgId); }
    });
    it(`${kind}: approval engine posts the legitimate linked note and blocks return void`, async () => {
      const f = await fixture(kind);
      try {
        const req = await approval(f);
        await approveRequest(req.id, f.actor);
        expect(await state(f)).toMatchObject({ ...expected(f, false, true), note: 'APPLIED', ret: 'APPROVED', posted: true });
        const before = await state(f);
        await expect(prisma.$transaction(tx => voidReturn(tx, f))).rejects.toMatchObject({ status: 422 });
        expect(await state(f)).toEqual(before);
        await prisma.$transaction(tx => (kind === 'ar' ? voidCreditNote : voidDebitNote)(tx, f.org.orgId, f.note.id, { date: DATE }));
        await prisma.$transaction(tx => voidReturn(tx, f));
        expect(await state(f)).toMatchObject({ ...expected(f, true), journals: (kind === 'ar' ? 4 : 2) + 3, note: 'VOID', ret: 'VOID' });
      } finally { await cleanupOrg(f.org.orgId); }
    });
    it(`${kind}: void wins against actual PUT approval submission`, async () => {
      const f = await fixture(kind);
      try {
        await prisma.organization.update({ where: { id: f.org.orgId }, data: { approvalRequirements: { [kind === 'ar' ? 'ar_credits' : 'ap_debits']: true } } });
        const response = await overlap(tx => voidReturn(tx, f), () => put(f)) as Response;
        expect(response.status).toBe(422);
        expect(await state(f)).toMatchObject({ ...expected(f, true), ret: 'VOID', note: 'DRAFT', posted: false });
        expect(await prisma.approvalRequest.count({ where: { organizationId: f.org.orgId } })).toBe(0);
      } finally { await cleanupOrg(f.org.orgId); }
    });
    it(`${kind}: submission wins and void rechecks pending after its status claim`, async () => {
      const f = await fixture(kind);
      try {
        await prisma.organization.update({ where: { id: f.org.orgId }, data: { approvalRequirements: { [kind === 'ar' ? 'ar_credits' : 'ap_debits']: true } } });
        const error = await overlap(async tx => {
          if (kind === 'ar') await tx.$queryRaw`SELECT "id" FROM "CreditNote" WHERE "id" = ${f.note.id} FOR UPDATE`;
          else await tx.$queryRaw`SELECT "id" FROM "DebitNote" WHERE "id" = ${f.note.id} FOR UPDATE`;
          await lockEligibleNoteReturn(tx, kind === 'ar' ? 'credit' : 'debit', { organizationId: f.org.orgId,
            partyId: kind === 'ar' ? f.customerId : f.vendorId, sourceId: kind === 'ar' ? f.invoice.id : f.bill.id, returnId: f.ret.id });
          expect(await routeForApproval(tx, { orgId: f.org.orgId, userId: f.actor.userId,
            documentType: kind === 'ar' ? 'CREDIT_NOTE' : 'DEBIT_NOTE', documentId: f.note.id })).toBe(true);
          if (kind === 'ar') await tx.creditNote.update({ where: { id: f.note.id }, data: { status: 'PENDING_APPROVAL' } });
          else await tx.debitNote.update({ where: { id: f.note.id }, data: { status: 'PENDING_APPROVAL' } });
        }, () => prisma.$transaction(tx => voidReturn(tx, f)));
        expect(error).toMatchObject({ status: 422 });
        expect(await state(f)).toMatchObject({ ...expected(f), ret: 'APPROVED', note: 'PENDING_APPROVAL', posted: false });
        expect(await prisma.approvalRequest.count({ where: { organizationId: f.org.orgId, status: 'PENDING' } })).toBe(1);
      } finally { await cleanupOrg(f.org.orgId); }
    });
    for (const first of ['apply', 'void'] as const) {
      it(`${kind}: ${first} wins the application/void race without partial stock or GL changes`, async () => {
        const f = await fixture(kind);
        try {
          const error = await overlap(tx => first === 'apply' ? apply(tx, f) : voidReturn(tx, f),
            () => prisma.$transaction(tx => first === 'apply' ? voidReturn(tx, f) : apply(tx, f)));
          expect(error).toMatchObject({ status: 422 });
          expect(await state(f)).toMatchObject({ ...expected(f, first === 'void', first === 'apply'),
            ret: first === 'void' ? 'VOID' : 'APPROVED', note: first === 'void' ? 'DRAFT' : 'APPLIED', posted: first === 'apply' });
        } finally { await cleanupOrg(f.org.orgId); }
      });
    }
    it(`${kind}: create with APPLIED payload remains an unposted draft`, async () => {
      const f = await fixture(kind);
      try {
        const before = await state(f);
        const body = { date: '2026-07-10', amount: kind === 'ar' ? 600 : 200, status: 'APPLIED',
          ...(kind === 'ar' ? { customerId: f.customerId, sourceInvoiceId: f.invoice.id, salesReturnId: f.ret.id }
            : { vendorId: f.vendorId, sourceBillId: f.bill.id, purchaseReturnId: f.ret.id }) };
        const response = await (kind === 'ar' ? createCredit : createDebit)(request(f, 'POST', body));
        expect(response.status).toBe(201);
        expect(await response.json()).toMatchObject({ status: 'DRAFT', journalEntryId: null });
        expect(await state(f)).toEqual(before);
      } finally { await cleanupOrg(f.org.orgId); }
    });
    for (const invalid of ['DRAFT', 'VOID', 'party', 'source', 'organization'] as const) {
      it(`${kind}: refuses a linked return with invalid ${invalid} on PUT and approval`, async () => {
        const f = await fixture(kind);
        let otherOrg: string | undefined;
        try {
          if (invalid === 'DRAFT' || invalid === 'VOID') {
            if (kind === 'ar') await prisma.salesReturn.update({ where: { id: f.ret.id }, data: { status: invalid } });
            else await prisma.purchaseReturn.update({ where: { id: f.ret.id }, data: { status: invalid } });
          } else if (invalid === 'party') {
            if (kind === 'ar') await prisma.creditNote.update({ where: { id: f.note.id }, data: { customerId: await createCustomer(f.org.orgId) } });
            else await prisma.debitNote.update({ where: { id: f.note.id }, data: { vendorId: await createVendor(f.org.orgId) } });
          } else if (invalid === 'source') {
            if (kind === 'ar') await prisma.creditNote.update({ where: { id: f.note.id }, data: { sourceInvoiceId: null } });
            else await prisma.debitNote.update({ where: { id: f.note.id }, data: { sourceBillId: null } });
          } else {
            otherOrg = (await createTestOrg()).orgId;
            if (kind === 'ar') await prisma.salesReturn.update({ where: { id: f.ret.id }, data: { organizationId: otherOrg } });
            else await prisma.purchaseReturn.update({ where: { id: f.ret.id }, data: { organizationId: otherOrg } });
          }
          const before = await state(f);
          const response = await put(f);
          expect(response.status).toBe(422);
          expect(await state(f)).toEqual(before);
          // Represent a legacy request queued before the eligibility rule.
          if (kind === 'ar') await prisma.creditNote.update({ where: { id: f.note.id }, data: { status: 'PENDING_APPROVAL' } });
          else await prisma.debitNote.update({ where: { id: f.note.id }, data: { status: 'PENDING_APPROVAL' } });
          const req = await prisma.approvalRequest.create({ data: { organizationId: f.org.orgId,
            documentType: kind === 'ar' ? 'CREDIT_NOTE' : 'DEBIT_NOTE', documentId: f.note.id, requestedById: f.actor.userId } });
          const pending = await state(f);
          await expect(approveRequest(req.id, f.actor)).rejects.toMatchObject({ status: 422 });
          expect(await state(f)).toEqual(pending);
          expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('PENDING');
        } finally { await cleanupOrg(f.org.orgId); if (otherOrg) await cleanupOrg(otherOrg); }
      });
    }
    it(`${kind}: paid-source refund blocks return void; reversing the note then return reconciles cash and stock`, async () => {
      const f = await fixture(kind);
      try {
        const payment = kind === 'ar'
          ? await prisma.aRPayment.create({ data: { organizationId: f.org.orgId, customerId: f.customerId,
            number: 'PAY-1', date: DATE, status: 'COMPLETED', totalAmount: 1500,
            allocations: { create: { invoiceId: f.invoice.id, amountApplied: 1500 } } } })
          : await prisma.aPPayment.create({ data: { organizationId: f.org.orgId, vendorId: f.vendorId,
            number: 'PAY-1', date: DATE, status: 'COMPLETED', totalAmount: 1000,
            allocations: { create: { billId: f.bill.id, amountApplied: 1000 } } } });
        await prisma.$transaction(tx => (kind === 'ar' ? postArPaymentIfNeeded : postApPaymentIfNeeded)(tx, f.org.orgId, payment.id));
        if (kind === 'ar') await prisma.creditNote.update({ where: { id: f.note.id }, data: { settlementType: 'REFUND', settlementAccountId: f.org.accounts.bankAsset } });
        else await prisma.debitNote.update({ where: { id: f.note.id }, data: { settlementType: 'REFUND_FROM_VENDOR', settlementAccountId: f.org.accounts.bankAsset } });
        expect((await put(f)).status).toBe(200);
        const before = await state(f);
        expect(before).toMatchObject({ ...expected(f), note: 'APPLIED', posted: true, journals: (kind === 'ar' ? 4 : 2) + 2,
          ar: 0, ap: kind === 'ar' ? -1000 : 0, bank: kind === 'ar' ? 900 : -800, clearing: 0 });
        await expect(prisma.$transaction(tx => voidReturn(tx, f))).rejects.toMatchObject({ status: 422 });
        expect(await state(f)).toEqual(before);
        await prisma.$transaction(tx => (kind === 'ar' ? voidCreditNote : voidDebitNote)(tx, f.org.orgId, f.note.id, { date: DATE }));
        await prisma.$transaction(tx => voidReturn(tx, f));
        expect(await state(f)).toMatchObject({ ...expected(f, true), note: 'VOID', ret: 'VOID',
          ar: 0, ap: kind === 'ar' ? -1000 : 0, bank: kind === 'ar' ? 1500 : -1000, journals: (kind === 'ar' ? 4 : 2) + 4 });
      } finally { await cleanupOrg(f.org.orgId); }
    });
    it(`${kind}: standalone note retains its existing application behavior`, async () => {
      const f = await fixture(kind);
      try {
        if (kind === 'ar') await prisma.creditNote.update({ where: { id: f.note.id }, data: { salesReturnId: null } });
        else await prisma.debitNote.update({ where: { id: f.note.id }, data: { purchaseReturnId: null } });
        await prisma.$transaction(tx => voidReturn(tx, f));
        expect((await put(f)).status).toBe(200);
        expect(await state(f)).toMatchObject({ note: 'APPLIED', posted: true, ret: 'VOID',
          quantity: kind === 'ar' ? 5 : 10, inventory: kind === 'ar' ? 500 : 1000,
          ar: kind === 'ar' ? 900 : 0, ap: kind === 'ar' ? -1000 : -800 });
      } finally { await cleanupOrg(f.org.orgId); }
    });
    it(`${kind}: application reads the edited draft link after waiting for its note lock`, async () => {
      const f = await fixture(kind);
      try {
        await prisma.$transaction(tx => voidReturn(tx, f));
        const eligible = kind === 'ar'
          ? await prisma.salesReturn.create({ data: { organizationId: f.org.orgId, customerId: f.customerId,
            invoiceId: f.invoice.id, number: 'SR-OTHER', returnDate: DATE, status: 'APPROVED' } })
          : await prisma.purchaseReturn.create({ data: { organizationId: f.org.orgId, vendorId: f.vendorId,
            billId: f.bill.id, number: 'PR-OTHER', returnDate: DATE, status: 'APPROVED' } });
        if (kind === 'ar') await prisma.creditNote.update({ where: { id: f.note.id }, data: { salesReturnId: eligible.id } });
        else await prisma.debitNote.update({ where: { id: f.note.id }, data: { purchaseReturnId: eligible.id } });
        const before = await state(f);
        const response = await overlap(async tx => {
          if (kind === 'ar') await tx.creditNote.update({ where: { id: f.note.id }, data: { salesReturnId: f.ret.id } });
          else await tx.debitNote.update({ where: { id: f.note.id }, data: { purchaseReturnId: f.ret.id } });
        }, () => put(f)) as Response;
        expect(response.status).toBe(422);
        expect(await state(f)).toEqual(before);
      } finally { await cleanupOrg(f.org.orgId); }
    });
    it(`${kind}: application rechecks return identity after waiting for its return lock`, async () => {
      const f = await fixture(kind);
      try {
        const otherParty = kind === 'ar' ? await createCustomer(f.org.orgId) : await createVendor(f.org.orgId);
        const before = await state(f);
        const response = await overlap(async tx => {
          if (kind === 'ar') await tx.salesReturn.update({ where: { id: f.ret.id }, data: { customerId: otherParty } });
          else await tx.purchaseReturn.update({ where: { id: f.ret.id }, data: { vendorId: otherParty } });
        }, () => put(f)) as Response;
        expect(response.status).toBe(422);
        expect(await state(f)).toEqual(before);
      } finally { await cleanupOrg(f.org.orgId); }
    });
  }
});

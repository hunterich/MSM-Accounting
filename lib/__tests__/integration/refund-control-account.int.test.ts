import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { postBillToLedger } from '@/lib/bill-posting';
import { postCreditNoteOnApply } from '@/lib/credit-note-posting';
import { postDebitNoteOnApply } from '@/lib/debit-note-posting';
import { approveRequest } from '@/lib/approval/engine';
import { voidCreditNote, voidDebitNote } from '@/lib/note-void';
import { postJournalEntry } from '@/lib/journal-posting';
import { POST as createCredit } from '@/src/app/api/v1/credit-notes/route';
import { POST as createDebit } from '@/src/app/api/v1/debit-notes/route';
import { PUT as editCredit } from '@/src/app/api/v1/credit-notes/[id]/route';
import { PUT as editDebit } from '@/src/app/api/v1/debit-notes/[id]/route';
import { GET as accountsGet } from '@/src/app/api/v1/accounts/route';
import { prisma, createTestOrg, createCustomer, createVendor, cleanupOrg, disconnect,
  accountBalance, assertTrialBalanced } from './harness';

afterAll(disconnect);
const DATE = new Date('2026-09-10');
async function fixture(ar: boolean) {
  const org = await createTestOrg();
  const party = ar ? await createCustomer(org.orgId) : await createVendor(org.orgId);
  const doc = ar ? await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId: party, number: 'SOURCE',
    issueDate: DATE, status: 'SENT', subtotal: 1000, totalAmount: 1000,
    lines: { create: { lineNo: 1, description: 'Service', quantity: 1, price: 1000, lineSubtotal: 1000 } } } })
    : await prisma.bill.create({ data: { organizationId: org.orgId, vendorId: party, number: 'SOURCE', issueDate: DATE,
      status: 'OPEN', subtotal: 1000, totalAmount: 1000,
      lines: { create: { lineNo: 1, accountId: org.accounts.cogsExpense, description: 'Service', quantity: 1, price: 1000, lineTotal: 1000 } } }, include: { lines: true } });
  if (ar) await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, doc.id));
  else {
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: doc.id }, include: { lines: true } });
    await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
  }
  const note = ar ? await prisma.creditNote.create({ data: { organizationId: org.orgId, customerId: party, sourceInvoiceId: doc.id,
    number: 'REFUND', date: DATE, status: 'DRAFT', amount: 100, returnAccountId: org.accounts.cogsExpense,
    settlementType: 'REFUND', settlementAccountId: org.accounts.arControl } })
    : await prisma.debitNote.create({ data: { organizationId: org.orgId, vendorId: party, sourceBillId: doc.id,
      number: 'REFUND', date: DATE, status: 'DRAFT', amount: 100, returnAccountId: org.accounts.cogsExpense,
      settlementType: 'REFUND_FROM_VENDOR', settlementAccountId: org.accounts.arControl } });
  return { ar, org, party, doc, note };
}
type F = Awaited<ReturnType<typeof fixture>>;
function request(f: F, method: string, body: unknown) {
  return new NextRequest('http://localhost/api/v1/notes', { method, headers: { 'x-org-id': f.org.orgId,
    'x-user-id': 'finance-reviewer', 'x-role-type': 'ADMIN', 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
async function apply(f: F) {
  await prisma.$transaction(async tx => {
    if (f.ar) await tx.creditNote.update({ where: { id: f.note.id }, data: { status: 'APPLIED' } });
    else await tx.debitNote.update({ where: { id: f.note.id }, data: { status: 'APPLIED' } });
    await (f.ar ? postCreditNoteOnApply : postDebitNoteOnApply)(tx, f.note.id);
  });
}
async function snapshot(f: F) {
  return {
    note: f.ar ? await prisma.creditNote.findUniqueOrThrow({ where: { id: f.note.id } }) : await prisma.debitNote.findUniqueOrThrow({ where: { id: f.note.id } }),
    entries: await prisma.journalEntry.findMany({ where: { organizationId: f.org.orgId }, orderBy: { id: 'asc' }, include: { lines: { orderBy: { id: 'asc' } } } }),
    ar: await accountBalance(f.org.orgId, f.org.accounts.arControl), ap: await accountBalance(f.org.orgId, f.org.accounts.apControl),
    stock: await prisma.inventoryLedgerEntry.count({ where: { organizationId: f.org.orgId } }),
  };
}

describe('refund account controls and party balances', () => {
  for (const ar of [true, false]) {
    for (const invalid of ['foreign', 'inactive', 'header', 'revenue'] as const) {
      it(`${ar ? 'customer' : 'supplier'} ${invalid} refund account refuses and rolls back`, async () => {
        const f = await fixture(ar), other = invalid === 'foreign' ? await createTestOrg() : null;
        try {
          const account = other ? { id: other.accounts.bankAsset } : await prisma.account.create({ data: {
            organizationId: f.org.orgId, code: '1999', name: 'Invalid refund', type: invalid === 'revenue' ? 'REVENUE' : 'ASSET',
            normalSide: invalid === 'revenue' ? 'CREDIT' : 'DEBIT', isActive: invalid !== 'inactive', isPostable: invalid !== 'header',
          } });
          if (ar) await prisma.creditNote.update({ where: { id: f.note.id }, data: { settlementAccountId: account.id } });
          else await prisma.debitNote.update({ where: { id: f.note.id }, data: { settlementAccountId: account.id } });
          const before = await snapshot(f);
          await expect(apply(f)).rejects.toMatchObject({ status: 422 });
          expect(await snapshot(f)).toEqual(before);
        } finally { await cleanupOrg(f.org.orgId); if (other) await cleanupOrg(other.orgId); }
      });
    }
    it(`${ar ? 'customer' : 'supplier'} control refund posting refuses with exact rollback`, async () => {
      const f = await fixture(ar);
      try {
        const before = await snapshot(f);
        await expect(apply(f)).rejects.toMatchObject({ status: 422 });
        expect(await snapshot(f)).toEqual(before);
        expect(before.ar).toBe(ar ? 1000 : 0); expect(before.ap).toBe(ar ? 0 : -1000);
        const databaseUrl = process.env.DATABASE_URL!;
        expect(new URL(databaseUrl).pathname.endsWith('_test')).toBe(true);
        const audit = await promisify(execFile)(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/audit-note-refund-accounts.ts',
          '--company', f.org.orgId], { env: { ...process.env, DATABASE_URL: databaseUrl }, timeout: 10000 });
        const report = JSON.parse(audit.stdout);
        expect(report.mode).toBe('READ_ONLY_AUDIT'); expect(report.refundNotesReviewed).toBe(1);
        expect(report.findings).toEqual([expect.objectContaining({ id: f.note.id, reasons: ['designated AR/AP control'] })]);
        expect(await snapshot(f)).toEqual(before);
      } finally { await cleanupOrg(f.org.orgId); }
    });

    it(`${ar ? 'customer' : 'supplier'} create and edit refuse a control account before creating an approval`, async () => {
      const f = await fixture(ar);
      try {
        const create = await (ar ? createCredit : createDebit)(request(f, 'POST', { [ar ? 'customerId' : 'vendorId']: f.party,
          date: '2026-09-10', amount: 100, settlementType: ar ? 'REFUND' : 'REFUND_FROM_VENDOR', settlementAccountId: f.org.accounts.arControl }));
        expect(create.status).toBe(422);
        const before = await snapshot(f);
        const edit = await (ar ? editCredit : editDebit)(request(f, 'PUT', { status: 'APPLIED' }), { params: Promise.resolve({ id: f.note.id }) });
        expect(edit.status).toBe(422);
        expect(await snapshot(f)).toEqual(before);
        expect(await prisma.approvalRequest.count({ where: { organizationId: f.org.orgId } })).toBe(0);
      } finally { await cleanupOrg(f.org.orgId); }
    });

    for (const bank of [true, false]) it(`${ar ? 'customer' : 'supplier'} valid ${bank ? 'bank' : 'holding asset'} refund preserves source debt`, async () => {
      const f = await fixture(ar);
      try {
        const asset = bank ? { id: f.org.accounts.bankAsset } : await prisma.account.create({ data: { organizationId: f.org.orgId,
          code: '1999', name: 'Refund Holding', type: 'ASSET', normalSide: 'DEBIT', isActive: true, isPostable: true } });
        if (ar) await prisma.creditNote.update({ where: { id: f.note.id }, data: { settlementAccountId: asset.id } });
        else await prisma.debitNote.update({ where: { id: f.note.id }, data: { settlementAccountId: asset.id } });
        await apply(f);
        expect(await accountBalance(f.org.orgId, asset.id)).toBe(ar ? -100 : 100);
        expect(await accountBalance(f.org.orgId, f.org.accounts[ar ? 'arControl' : 'apControl'])).toBe(ar ? 1000 : -1000);
        const source = ar ? await prisma.salesInvoice.findUniqueOrThrow({ where: { id: f.doc.id } }) : await prisma.bill.findUniqueOrThrow({ where: { id: f.doc.id } });
        expect(Number(source.totalAmount)).toBe(1000); expect(source.status).toBe(ar ? 'SENT' : 'OPEN');
        expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: f.org.orgId } })).toBe(0);
        await prisma.$transaction(tx => (ar ? voidCreditNote : voidDebitNote)(tx, f.org.orgId, f.note.id, { date: DATE }));
        expect(await accountBalance(f.org.orgId, asset.id)).toBe(0);
        expect(await accountBalance(f.org.orgId, f.org.accounts[ar ? 'arControl' : 'apControl'])).toBe(ar ? 1000 : -1000);
        await assertTrialBalanced(f.org.orgId);
      } finally { await cleanupOrg(f.org.orgId); }
    });

    it(`${ar ? 'customer' : 'supplier'} approval engine refuses a legacy pending control refund and restores its claim`, async () => {
      const f = await fixture(ar);
      try {
        const role = await prisma.role.create({ data: { organizationId: f.org.orgId, name: 'Admin', roleType: 'ADMIN' } });
        const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, fullName: 'Approver', passwordHash: 'x', status: 'ACTIVE' } });
        await prisma.userOrganization.create({ data: { organizationId: f.org.orgId, userId: user.id, roleId: role.id } });
        if (ar) await prisma.creditNote.update({ where: { id: f.note.id }, data: { status: 'PENDING_APPROVAL' } });
        else await prisma.debitNote.update({ where: { id: f.note.id }, data: { status: 'PENDING_APPROVAL' } });
        const approval = await prisma.approvalRequest.create({ data: { organizationId: f.org.orgId, requestedById: user.id,
          documentType: ar ? 'CREDIT_NOTE' : 'DEBIT_NOTE', documentId: f.note.id } });
        const before = await snapshot(f);
        await expect(approveRequest(approval.id, { orgId: f.org.orgId, userId: user.id, roleType: 'ADMIN' })).rejects.toMatchObject({ status: 422 });
        expect(await snapshot(f)).toEqual(before);
        expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe('PENDING');
      } finally { await cleanupOrg(f.org.orgId); }
    });

    for (const designation of ['configured', 'other-document'] as const) it(`${ar ? 'customer' : 'supplier'} ${designation} alternate control is refused`, async () => {
      const f = await fixture(ar);
      try {
        const asset = await prisma.account.create({ data: { organizationId: f.org.orgId, code: '1999', name: 'Alternate control', type: 'ASSET', normalSide: 'DEBIT' } });
        if (designation === 'configured') await prisma.organization.update({ where: { id: f.org.orgId }, data: { accountDefaults: { arControl: asset.id } } });
        else await prisma.creditNote.create({ data: { organizationId: f.org.orgId, customerId: await createCustomer(f.org.orgId),
          number: 'CONTROL-DESIGNATION', date: DATE, amount: 1, arAccountId: asset.id } });
        if (ar) await prisma.creditNote.update({ where: { id: f.note.id }, data: { settlementAccountId: asset.id } });
        else await prisma.debitNote.update({ where: { id: f.note.id }, data: { settlementAccountId: asset.id } });
        const before = await snapshot(f);
        await expect(apply(f)).rejects.toMatchObject({ status: 422 });
        expect(await snapshot(f)).toEqual(before);
      } finally { await cleanupOrg(f.org.orgId); }
    });

    it(`${ar ? 'customer' : 'supplier'} a legacy posted control refund can still be reversed`, async () => {
      const f = await fixture(ar);
      try {
        await prisma.$transaction(async tx => {
          const entry = await postJournalEntry(tx, { organizationId: f.org.orgId, date: DATE, memo: 'Legacy incorrect refund',
            lines: [{ accountId: f.org.accounts.cogsExpense, description: 'Legacy refund offset', debit: ar ? 100 : 0, credit: ar ? 0 : 100 },
              { accountId: f.org.accounts.arControl, description: 'Legacy wrong control', debit: ar ? 0 : 100, credit: ar ? 100 : 0 }] });
          if (ar) await tx.creditNote.update({ where: { id: f.note.id }, data: { status: 'APPLIED', journalEntryId: entry.id } });
          else await tx.debitNote.update({ where: { id: f.note.id }, data: { status: 'APPLIED', journalEntryId: entry.id } });
        });
        expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(ar ? 900 : 100);
        await prisma.$transaction(tx => (ar ? voidCreditNote : voidDebitNote)(tx, f.org.orgId, f.note.id, { date: DATE }));
        expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(ar ? 1000 : 0);
        expect(await accountBalance(f.org.orgId, f.org.accounts.apControl)).toBe(ar ? 0 : -1000);
        await assertTrialBalanced(f.org.orgId);
      } finally { await cleanupOrg(f.org.orgId); }
    });
  }

  it('account metadata marks an alternate control but not a foreign company designation', async () => {
    const f = await fixture(true), other = await createTestOrg();
    try {
      const asset = await prisma.account.create({ data: { organizationId: f.org.orgId, code: '1999', name: 'Other Receivable', type: 'ASSET', normalSide: 'DEBIT' } });
      const foreignParty = await createCustomer(other.orgId);
      // A bad historical foreign override must not designate this company's cash.
      await prisma.creditNote.create({ data: { organizationId: other.orgId, customerId: foreignParty, number: 'FOREIGN-CONTROL', date: DATE,
        amount: 1, arAccountId: f.org.accounts.bankAsset } });
      await prisma.creditNote.update({ where: { id: f.note.id }, data: { arAccountId: asset.id, settlementAccountId: asset.id } });
      const before = await snapshot(f);
      await expect(apply(f)).rejects.toMatchObject({ status: 422 });
      expect(await snapshot(f)).toEqual(before);
      const ordinary = await accountsGet(new NextRequest('http://localhost/api/v1/accounts?limit=1000', { headers: { 'x-org-id': f.org.orgId } }));
      expect((await ordinary.json()).data.every((account: any) => !Object.hasOwn(account, 'isPartyControlAccount'))).toBe(true);
      const response = await accountsGet(new NextRequest('http://localhost/api/v1/accounts?limit=1000&withControlFlags=1', { headers: { 'x-org-id': f.org.orgId } }));
      const body = await response.json();
      expect(body.data.find((account: any) => account.id === asset.id).isPartyControlAccount).toBe(true);
      expect(body.data.find((account: any) => account.id === f.org.accounts.bankAsset).isPartyControlAccount).toBe(false);
      expect(body.data.some((account: any) => account.organizationId === other.orgId)).toBe(false);
    } finally { await cleanupOrg(f.org.orgId); await cleanupOrg(other.orgId); }
  });
});

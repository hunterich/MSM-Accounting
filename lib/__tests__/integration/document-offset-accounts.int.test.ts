import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { auditDocumentOffsets } from '../../document-offset-audit';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, createCustomer, createVendor, createItem, cleanupOrg, disconnect, accountBalance, assertTrialBalanced } from './harness';
import { postBillToLedger } from '../../bill-posting';
import { postInvoiceSend } from '../../invoice-send-posting';
import { postStockAdjustmentToLedger } from '../../stock-adjustment-posting';
import { approveRequest, routeForApproval } from '../../approval/engine';
import { submitInvoiceForApproval } from '../../approval/invoice-submission';
import { voidBill } from '../../bill-void';
import { voidInvoice } from '../../invoice-void';
import { postJournalEntry } from '../../journal-posting';
import { voidStockAdjustment } from '../../stock-adjustment-void';
import { GET as getAccounts } from '../../../src/app/api/v1/accounts/route';
import { POST as createBill } from '../../../src/app/api/v1/bills/route';
import { PUT as editBill } from '../../../src/app/api/v1/bills/[id]/route';
import { POST as createInvoice } from '../../../src/app/api/v1/invoices/route';
import { PUT as editInvoice } from '../../../src/app/api/v1/invoices/[id]/route';
import { POST as createAdjustment } from '../../../src/app/api/v1/stock-adjustments/route';
import { PUT as editAdjustment } from '../../../src/app/api/v1/stock-adjustments/[id]/route';

type Kind = 'bill-line' | 'bill-charge' | 'invoice-charge' | 'adjustment';
const kinds: Kind[] = ['bill-line', 'bill-charge', 'invoice-charge', 'adjustment'];
const DAY = '2026-09-10', DATE = new Date(DAY);
afterAll(disconnect);
async function fixture(kind: Kind, invalid: 'ar' | 'ap' | 'alternate' | 'configured' | 'valid' = 'ar') {
  const org = await createTestOrg();
  const customerId = await createCustomer(org.orgId), vendorId = await createVendor(org.orgId);
  const role = await prisma.role.create({ data: { organizationId: org.orgId, name: 'Admin', roleType: 'ADMIN' } });
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@offset.test`, fullName: 'Offset QA' } });
  await prisma.userOrganization.create({ data: { organizationId: org.orgId, userId: user.id, roleId: role.id } });
  let accountId = invalid === 'ap' ? org.accounts.apControl : invalid === 'valid' ? org.accounts.cogsExpense : org.accounts.arControl;
  if (invalid === 'alternate' || invalid === 'configured') {
    const account = await prisma.account.create({ data: { organizationId: org.orgId, code: '1999', name: 'Alternate receivable', type: 'ASSET', normalSide: 'DEBIT' } });
    accountId = account.id;
    if (invalid === 'configured') await prisma.organization.update({ where: { id: org.orgId }, data: { accountDefaults: { ...org.accounts, arControl: accountId } } });
    else await prisma.creditNote.create({ data: { organizationId: org.orgId, customerId, number: 'CONTROL-DESIGNATION', date: DATE, amount: 1, arAccountId: accountId } });
  }
  let id: string;
  if (kind.startsWith('bill')) {
    const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: 'OFFSET-BILL', vendorInvoiceNo: 'OFFSET-FAKTUR', issueDate: DATE,
      subtotal: 100, totalAmount: kind === 'bill-charge' ? 125 : 100, taxable: false,
      lines: { create: { lineNo: 1, description: 'Service', quantity: 1, price: 100, lineTotal: 100, accountId: kind === 'bill-line' ? accountId : org.accounts.cogsExpense } },
      ...(kind === 'bill-charge' ? { charges: { create: { lineNo: 1, label: 'Freight', amount: 25, accountId } } } : {}),
    } }); id = bill.id;
  } else if (kind === 'invoice-charge') {
    const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'OFFSET-INVOICE', issueDate: DATE,
      subtotal: 100, totalAmount: 125, taxEnabled: false,
      lines: { create: { lineNo: 1, description: 'Service', quantity: 1, price: 100, lineSubtotal: 100 } },
      charges: { create: { lineNo: 1, label: 'Freight', amount: 25, accountId } },
    } }); id = invoice.id;
  } else {
    const itemId = await createItem(org.orgId, 100);
    const adjustment = await prisma.stockAdjustment.create({ data: { organizationId: org.orgId, number: 'OFFSET-ADJ', date: DATE, reason: 'QA',
      lines: { create: { lineNo: 1, itemId, accountId, oldQty: 0, newQty: 1, qtyDiff: 1, unitCost: 100, totalValue: 100 } },
    } }); id = adjustment.id;
  }
  return { org, kind, id, accountId, userId: user.id, customerId, vendorId };
}
type F = Awaited<ReturnType<typeof fixture>>;
async function finish(f: F) {
  return prisma.$transaction(async tx => {
    if (f.kind.startsWith('bill')) {
      const doc = await tx.bill.findUniqueOrThrow({ where: { id: f.id }, include: { lines: true, charges: true } });
      await tx.bill.update({ where: { id: f.id }, data: { status: 'OPEN' } });
      await postBillToLedger(tx, f.org.orgId, doc);
    } else if (f.kind === 'invoice-charge') {
      await tx.salesInvoice.update({ where: { id: f.id }, data: { status: 'SENT' } });
      await postInvoiceSend(tx, f.org.orgId, f.id);
    } else {
      const doc = await tx.stockAdjustment.findUniqueOrThrow({ where: { id: f.id }, include: { lines: true } });
      await tx.stockAdjustment.update({ where: { id: f.id }, data: { status: 'APPROVED' } });
      await postStockAdjustmentToLedger(tx, f.org.orgId, doc);
    }
  });
}
async function snapshot(f: F) {
  const organizationId = f.org.orgId;
  return {
    bills: await prisma.bill.findMany({ where: { organizationId }, orderBy: { id: 'asc' }, include: { lines: { orderBy: { id: 'asc' } }, charges: { orderBy: { id: 'asc' } } } }),
    invoices: await prisma.salesInvoice.findMany({ where: { organizationId }, orderBy: { id: 'asc' }, include: { lines: { orderBy: { id: 'asc' } }, charges: { orderBy: { id: 'asc' } } } }),
    adjustments: await prisma.stockAdjustment.findMany({ where: { organizationId }, include: { lines: true } }),
    lots: await prisma.inventoryLot.findMany({ where: { organizationId }, orderBy: { id: 'asc' } }),
    stock: await prisma.inventoryLedgerEntry.findMany({ where: { organizationId }, orderBy: { id: 'asc' } }),
    journals: await prisma.journalEntry.findMany({ where: { organizationId }, orderBy: { id: 'asc' }, include: { lines: { orderBy: { id: 'asc' } } } }),
    approvals: await prisma.approvalRequest.findMany({ where: { organizationId }, orderBy: { id: 'asc' } }),
  };
}
async function cleanup(f: F) {
  await prisma.approvalRequest.deleteMany({ where: { organizationId: f.org.orgId } });
  await prisma.journalLine.deleteMany({ where: { entry: { organizationId: f.org.orgId } } });
  await cleanupOrg(f.org.orgId);
  await prisma.user.delete({ where: { id: f.userId } }).catch(() => undefined);
}
function request(f: F, body: unknown, method = 'PUT') {
  return new NextRequest('http://localhost/api/v1/documents', { method, headers: { 'x-org-id': f.org.orgId, 'x-user-id': f.userId, 'x-role-type': 'ADMIN', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
const documentType = (f: F) => f.kind.startsWith('bill') ? 'BILL' as const : f.kind === 'invoice-charge' ? 'INVOICE' as const : 'STOCK_ADJUSTMENT' as const;

describe('document offsets cannot bypass party subledgers', () => {
  for (const kind of kinds) {
    for (const invalidState of ['foreign', 'inactive', 'header'] as const) it(`${kind}: refuses ${invalidState} account with complete rollback`, async () => {
      const f = await fixture(kind), other = invalidState === 'foreign' ? await createTestOrg() : null;
      try {
        const invalidId = other?.accounts.bankAsset ?? (await prisma.account.create({ data: { organizationId: f.org.orgId, code: '1998', name: 'Invalid offset', type: 'ASSET', normalSide: 'DEBIT', isActive: invalidState !== 'inactive', isPostable: invalidState !== 'header' } })).id;
        if (kind === 'bill-line') await prisma.billLine.updateMany({ where: { billId: f.id }, data: { accountId: invalidId } });
        else if (kind === 'bill-charge') await prisma.billCharge.updateMany({ where: { billId: f.id }, data: { accountId: invalidId } });
        else if (kind === 'invoice-charge') await prisma.salesInvoiceCharge.updateMany({ where: { invoiceId: f.id }, data: { accountId: invalidId } });
        else await prisma.stockAdjustmentLine.updateMany({ where: { stockAdjustmentId: f.id }, data: { accountId: invalidId } });
        const before = await snapshot(f);
        await expect(finish(f)).rejects.toMatchObject({ status: 422 });
        expect(await snapshot(f)).toEqual(before);
      } finally { await cleanup(f); if (other) await cleanupOrg(other.orgId); }
    });
    it(`${kind}: API create and draft edit reject controls with complete rollback`, async () => {
      const f = await fixture(kind);
      try {
        const before = await snapshot(f);
        const billPayload = { vendorId: f.vendorId, issueDate: DAY, status: 'DRAFT', subtotal: 100, totalAmount: 100, taxable: false,
          lines: [{ lineNo: 1, description: 'API service', quantity: 1, price: 100, lineTotal: 100, accountId: kind === 'bill-line' ? f.accountId : f.org.accounts.cogsExpense }],
          ...(kind === 'bill-charge' ? { charges: [{ label: 'Freight', accountId: f.accountId, amount: 25 }] } : {}),
        };
        const invoicePayload = { customerId: f.customerId, issueDate: DAY, currency: 'IDR', lines: [{ description: 'Service', quantity: 1, unit: 'PCS', price: 100 }], charges: [{ label: 'Freight', accountId: f.accountId, amount: 25 }] };
        const adj = kind === 'adjustment' ? before.adjustments[0] : null;
        const adjustmentPayload = { date: DAY, type: 'QUANTITY', reason: 'QA', status: 'DRAFT', lines: adj?.lines.map(line => ({ itemId: line.itemId, accountId: f.accountId, oldQty: 0, newQty: 1, unitCost: 100 })) };
        const payload = kind.startsWith('bill') ? billPayload : kind === 'invoice-charge' ? invoicePayload : adjustmentPayload;
        const created = await (kind.startsWith('bill') ? createBill : kind === 'invoice-charge' ? createInvoice : createAdjustment)(request(f, payload, 'POST'));
        expect(created.status).toBe(422);
        expect(await snapshot(f)).toEqual(before);
        const edited = await (kind.startsWith('bill') ? editBill : kind === 'invoice-charge' ? editInvoice : editAdjustment)(request(f, { notes: 'Must not persist', ...(kind.startsWith('bill') ? { charges: billPayload.charges, lines: billPayload.lines } : kind === 'invoice-charge' ? { charges: invoicePayload.charges } : { lines: adjustmentPayload.lines }) }), { params: Promise.resolve({ id: f.id }) });
        expect(edited.status).toBe(422);
        expect(await snapshot(f)).toEqual(before);
      } finally { await cleanup(f); }
    });
    for (const invalid of ['ar', 'ap', 'alternate', 'configured'] as const) it(`${kind}: refuses ${invalid} control with complete rollback`, async () => {
      const f = await fixture(kind, invalid);
      try {
        const before = await snapshot(f);
        await expect(finish(f)).rejects.toMatchObject({ status: 422 });
        expect(await snapshot(f)).toEqual(before);
        expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(0);
        expect(await accountBalance(f.org.orgId, f.org.accounts.apControl)).toBe(0);
      } finally { await cleanup(f); }
    });
    it(`${kind}: legacy pending approval refuses and restores its claim`, async () => {
      const f = await fixture(kind);
      try {
        const type = documentType(f);
        if (type === 'BILL') await prisma.bill.update({ where: { id: f.id }, data: { status: 'PENDING_APPROVAL' } });
        else if (type === 'INVOICE') await prisma.salesInvoice.update({ where: { id: f.id }, data: { status: 'PENDING_APPROVAL' } });
        else await prisma.stockAdjustment.update({ where: { id: f.id }, data: { status: 'PENDING_APPROVAL' } });
        const approval = await prisma.approvalRequest.create({ data: { organizationId: f.org.orgId, documentType: type, documentId: f.id, requestedById: f.userId } });
        const before = await snapshot(f);
        await expect(approveRequest(approval.id, { orgId: f.org.orgId, userId: f.userId, roleType: 'ADMIN' })).rejects.toMatchObject({ status: 422 });
        expect(await snapshot(f)).toEqual(before);
      } finally { await cleanup(f); }
    });
    it(`${kind}: refuses submission before creating an approval`, async () => {
      const f = await fixture(kind);
      try {
        await prisma.organization.update({ where: { id: f.org.orgId }, data: { approvalRequirements: { ap_bills: true, ar_invoices: true, inv_adj: true } } });
        const before = await snapshot(f);
        await expect(prisma.$transaction(tx => routeForApproval(tx, { orgId: f.org.orgId, userId: f.userId, documentType: documentType(f), documentId: f.id }))).rejects.toMatchObject({ status: 422 });
        expect(await snapshot(f)).toEqual(before);
        if (kind === 'invoice-charge') {
          await expect(prisma.$transaction(tx => submitInvoiceForApproval(tx, f.org.orgId, f.userId, f.id))).rejects.toMatchObject({ status: 422 });
          expect(await snapshot(f)).toEqual(before);
        }
      } finally { await cleanup(f); }
    });
    it(`${kind}: valid posting preserves exact party controls`, async () => {
      const f = await fixture(kind, 'valid');
      try {
        await finish(f);
        const expected = kind === 'bill-line' ? 100 : 125;
        expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(kind === 'invoice-charge' ? 125 : 0);
        expect(await accountBalance(f.org.orgId, f.org.accounts.apControl)).toBe(kind.startsWith('bill') ? -expected : 0);
        if (kind.startsWith('bill')) {
          expect(Number((await prisma.bill.findUniqueOrThrow({ where: { id: f.id } })).totalAmount)).toBe(expected);
          await prisma.$transaction(tx => voidBill(tx, f.org.orgId, f.id, { date: DATE }));
          expect(await accountBalance(f.org.orgId, f.org.accounts.apControl)).toBe(0);
        } else if (kind === 'invoice-charge') {
          await prisma.$transaction(tx => voidInvoice(tx, f.org.orgId, f.id, { date: DATE }));
          expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(0);
        }
        await assertTrialBalanced(f.org.orgId);
      } finally { await cleanup(f); }
    });
    if (kind !== 'adjustment') it(`${kind}: invalid edit of posted document restores original journal and source balance`, async () => {
      const f = await fixture(kind, 'valid');
      try {
        await finish(f);
        const before = await snapshot(f);
        const body = kind === 'bill-line' ? { lines: [{ lineNo: 1, description: 'Bad correction', quantity: 1, price: 100, lineTotal: 100, accountId: f.org.accounts.apControl }] }
          : { charges: [{ label: 'Bad correction', amount: 25, accountId: f.org.accounts.arControl }] };
        const response = await (kind.startsWith('bill') ? editBill : editInvoice)(request(f, body), { params: Promise.resolve({ id: f.id }) });
        expect(response.status).toBe(422);
        expect(await snapshot(f)).toEqual(before);
      } finally { await cleanup(f); }
    });
    it(`${kind}: legacy invalid posting remains reversible`, async () => {
      const f = await fixture(kind);
      try {
        // Historical bad entries are recreated only in isolated QA. Reversal
        // must reverse recorded lines and must not apply forward account guards.
        const journal = await prisma.$transaction(tx => postJournalEntry(tx, { organizationId: f.org.orgId, date: DATE, memo: 'Legacy QA',
          lines: [{ accountId: f.org.accounts.arControl, description: 'Incorrect offset', debit: 100, credit: 0 }, { accountId: f.org.accounts.bankAsset, description: 'Legacy counterpart', debit: 0, credit: 100 }] }));
        if (kind.startsWith('bill')) {
          await prisma.bill.update({ where: { id: f.id }, data: { status: 'OPEN', journalEntryId: journal.id } });
          await prisma.$transaction(tx => voidBill(tx, f.org.orgId, f.id, { date: DATE }));
        } else if (kind === 'invoice-charge') {
          await prisma.salesInvoice.update({ where: { id: f.id }, data: { status: 'SENT', postingTracked: true, postingJournalIds: [journal.id] } });
          await prisma.$transaction(tx => voidInvoice(tx, f.org.orgId, f.id, { date: DATE }));
        } else {
          // The stock-adjustment void locates its original GL by its recorded memo.
          await prisma.journalEntry.update({ where: { id: journal.id }, data: { memo: 'Stock adjustment: OFFSET-ADJ' } });
          await prisma.stockAdjustment.update({ where: { id: f.id }, data: { status: 'APPROVED' } });
          await prisma.$transaction(tx => voidStockAdjustment(tx, f.org.orgId, f.id, { date: DATE }));
        }
        expect(await accountBalance(f.org.orgId, f.org.accounts.arControl)).toBe(0);
        expect(await accountBalance(f.org.orgId, f.org.accounts.bankAsset)).toBe(0);
        await assertTrialBalanced(f.org.orgId);
      } finally { await cleanup(f); }
    });
  }
  it('bill approval includes valid additional costs in AP exactly once', async () => {
    const f = await fixture('bill-charge', 'valid');
    try {
      await prisma.bill.update({ where: { id: f.id }, data: { status: 'PENDING_APPROVAL' } });
      const approval = await prisma.approvalRequest.create({ data: { organizationId: f.org.orgId, documentType: 'BILL', documentId: f.id, requestedById: f.userId } });
      await approveRequest(approval.id, { orgId: f.org.orgId, userId: f.userId, roleType: 'ADMIN' });
      expect(await accountBalance(f.org.orgId, f.org.accounts.apControl)).toBe(-125);
      expect(await accountBalance(f.org.orgId, f.org.accounts.cogsExpense)).toBe(125);
      expect(Number((await prisma.bill.findUniqueOrThrow({ where: { id: f.id } })).totalAmount)).toBe(125);
      await assertTrialBalanced(f.org.orgId);
    } finally { await cleanup(f); }
  });
  it('bill creation refuses an inherited PO charge control and leaves source records unchanged', async () => {
    const f = await fixture('bill-charge');
    try {
      const po = await prisma.purchaseOrder.create({ data: { organizationId: f.org.orgId, vendorId: f.vendorId, number: 'LEGACY-PO', date: DATE,
        charges: { create: { lineNo: 1, label: 'Freight', amount: 25, accountId: f.org.accounts.arControl } } }, include: { charges: true } });
      const before = await snapshot(f);
      const response = await createBill(request(f, { vendorId: f.vendorId, poId: po.id, issueDate: DAY, status: 'DRAFT',
        lines: [{ lineNo: 1, description: 'Service', quantity: 1, price: 100, accountId: f.org.accounts.cogsExpense }], charges: [] }, 'POST'));
      expect(response.status).toBe(422);
      expect(await snapshot(f)).toEqual(before);
      expect(await prisma.purchaseOrder.findUnique({ where: { id: po.id }, include: { charges: true } })).toEqual(po);
    } finally { await cleanup(f); }
  });
  it('bill approval refuses a charge-only legacy control draft even when there are no lines', async () => {
    const f = await fixture('bill-charge');
    try {
      await prisma.billLine.deleteMany({ where: { billId: f.id } });
      await prisma.bill.update({ where: { id: f.id }, data: { status: 'PENDING_APPROVAL' } });
      const approval = await prisma.approvalRequest.create({ data: { organizationId: f.org.orgId, documentType: 'BILL', documentId: f.id, requestedById: f.userId } });
      const before = await snapshot(f);
      await expect(approveRequest(approval.id, { orgId: f.org.orgId, userId: f.userId, roleType: 'ADMIN' })).rejects.toMatchObject({ status: 422 });
      expect(await snapshot(f)).toEqual(before);
    } finally { await cleanup(f); }
  });
  it('stock adjustments reject a control-designated default variance even without an explicit line account', async () => {
    const f = await fixture('adjustment', 'valid');
    try {
      await prisma.stockAdjustmentLine.updateMany({ where: { stockAdjustmentId: f.id }, data: { accountId: null } });
      await prisma.creditNote.create({ data: { organizationId: f.org.orgId, customerId: f.customerId, number: 'LEGACY-CONTROL', date: DATE, amount: 1, arAccountId: f.org.accounts.inventoryAdjustment } });
      const before = await snapshot(f);
      await expect(finish(f)).rejects.toMatchObject({ status: 422 });
      expect(await snapshot(f)).toEqual(before);
    } finally { await cleanup(f); }
  });
  it('account metadata includes alternate controls and ignores other-company designations', async () => {
    const f = await fixture('bill-line', 'alternate'), other = await createTestOrg();
    try {
      const foreignCustomer = await createCustomer(other.orgId);
      await prisma.creditNote.create({ data: { organizationId: other.orgId, customerId: foreignCustomer, number: 'FOREIGN', date: DATE, amount: 1, arAccountId: f.org.accounts.bankAsset } });
      const response = await getAccounts(new NextRequest('http://localhost/api/v1/accounts?withControlFlags=1&limit=1000', { headers: { 'x-org-id': f.org.orgId } }));
      const { data } = await response.json();
      expect(data.find((a: { id: string }) => a.id === f.accountId).isPartyControlAccount).toBe(true);
      expect(data.find((a: { id: string }) => a.id === f.org.accounts.bankAsset).isPartyControlAccount).toBe(false);
      expect(data.every((a: { organizationId: string }) => a.organizationId === f.org.orgId)).toBe(true);
    } finally { await cleanupOrg(other.orgId); await cleanup(f); }
  });
  it('read-only audit reports stored bad selections and linked historical control lines without changing records', async () => {
    const f = await fixture('bill-line');
    try {
      const journal = await prisma.$transaction(tx => postJournalEntry(tx, { organizationId: f.org.orgId, date: DATE, memo: 'Legacy offset audit QA', lines: [
        { accountId: f.org.accounts.arControl, description: 'Bad historical offset', debit: 100, credit: 0 },
        { accountId: f.org.accounts.apControl, description: 'AP', debit: 0, credit: 100 },
      ] }));
      await prisma.bill.update({ where: { id: f.id }, data: { status: 'OPEN', journalEntryId: journal.id } });
      const before = await snapshot(f);
      const cli = await promisify(execFile)(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/audit-document-offset-accounts.ts', '--company', f.org.orgId], { env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL! }, timeout: 15000 });
      const report = JSON.parse(cli.stdout);
      expect(report.mode).toBe('READ_ONLY_AUDIT');
      expect(report.findings).toEqual([expect.objectContaining({ documentId: f.id, field: 'line:1', accountId: f.org.accounts.arControl, reason: 'designated AR/AP control' })]);
      expect(report.recordedControlLines).toHaveLength(2);
      expect(await snapshot(f)).toEqual(before);
      await expect(prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await auditDocumentOffsets(tx, f.org.orgId);
        await tx.bill.update({ where: { id: f.id }, data: { notes: 'Read-only must refuse this' } });
      })).rejects.toThrow(/read.only/i);
      expect(await snapshot(f)).toEqual(before);
    } finally { await cleanup(f); }
  });
});

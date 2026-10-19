import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, createCustomer, cleanupOrg, disconnect, type TestOrg } from './harness';
import { POST as voidRoute } from '@/src/app/api/v1/invoices/[id]/void/route';
import { PUT as putInvoice } from '@/src/app/api/v1/invoices/[id]/route';
import { GET as arReport } from '@/src/app/api/v1/reports/ar/route';
import { postInvoiceSend } from '../../invoice-send-posting';
import { createBatch, stageEntity } from '../../migration/batch-service';
import { commitBatch, resolveControlCodes } from '../../migration/commit';

afterAll(disconnect);

/**
 * A SENT invoice whose sales posting cannot be found must never be voided or
 * edited as if it had one. Migrated opening invoices carry no journal of their
 * own (the migration's opening journal holds their AR), so a plain void would
 * leave the AR control unchanged while every report dropped the invoice, and an
 * edit would post the amount a second time.
 */
async function actor(orgId: string): Promise<string> {
  const user = await prisma.user.create({ data: { email: `u-${randomUUID()}@test.local`, fullName: 'Void Tester', passwordHash: 'x', status: 'ACTIVE' } });
  const role = await prisma.role.create({ data: { organizationId: orgId, name: `Admin-${randomUUID().slice(0, 8)}`, roleType: 'ADMIN' } });
  await prisma.userOrganization.create({ data: { userId: user.id, organizationId: orgId, roleId: role.id, isActive: true } });
  return user.id;
}
const headers = (orgId: string, userId: string) => ({ 'x-org-id': orgId, 'x-user-id': userId, 'x-role-type': 'ADMIN', 'content-type': 'application/json' });
const voidInvoice = (orgId: string, userId: string, id: string) =>
  voidRoute(new NextRequest(`http://localhost/api/v1/invoices/${id}/void`, { method: 'POST', headers: headers(orgId, userId) }), { params: Promise.resolve({ id }) });
const editInvoice = (orgId: string, userId: string, id: string, body: unknown) =>
  putInvoice(new NextRequest(`http://localhost/api/v1/invoices/${id}`, { method: 'PUT', headers: headers(orgId, userId), body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

async function snapshot(org: TestOrg, invoiceId: string) {
  const [invoice, journals, ar] = await Promise.all([
    prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: { orderBy: { lineNo: 'asc' } } } }),
    prisma.journalEntry.findMany({ where: { organizationId: org.orgId }, orderBy: { entryNo: 'asc' }, include: { lines: { orderBy: { id: 'asc' } } } }),
    prisma.journalLine.aggregate({ where: { accountId: org.accounts.arControl, entry: { organizationId: org.orgId, status: 'POSTED' } }, _sum: { debit: true, credit: true } }),
  ]);
  return { invoice, journals, ar: Number(ar._sum.debit ?? 0) - Number(ar._sum.credit ?? 0) };
}
async function aging(orgId: string, userId: string, asOf: string) {
  return (await arReport(new NextRequest(`http://localhost/api/v1/reports/ar?type=aging&asOfDate=${asOf}`, { headers: headers(orgId, userId) }))).json();
}

async function migratedOpeningInvoice(org: TestOrg) {
  const batch = await createBatch(org.orgId, new Date('2026-01-01T00:00:00Z'), null);
  const codes = await resolveControlCodes(org.orgId);
  await stageEntity(org.orgId, batch.id, 'customers', [{ name: 'PT Opening Customer' }]);
  await stageEntity(org.orgId, batch.id, 'opening-journal', [
    { accountCode: codes.AR, debit: 1000, credit: 0 },
    { accountCode: codes.OPENING_EQUITY, debit: 0, credit: 1000 },
  ]);
  await stageEntity(org.orgId, batch.id, 'opening-invoices', [{ customerName: 'PT Opening Customer', invoiceNumber: 'OPEN-INV', issueDate: '2025-12-01', amount: 1000 }]);
  expect(await commitBatch(org.orgId, batch.id, null)).toMatchObject({ committed: true });
  return (await prisma.salesInvoice.findFirstOrThrow({ where: { organizationId: org.orgId, number: 'OPEN-INV' } })).id;
}

it('refuses to void a migrated opening invoice and leaves GL, document and reports unchanged', async () => {
  const org = await createTestOrg();
  try {
    const userId = await actor(org.orgId);
    const id = await migratedOpeningInvoice(org);
    const before = await snapshot(org, id);
    expect(before.ar).toBe(1000);
    const response = await voidInvoice(org.orgId, userId, id);
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/no sales posting to reverse/i);
    expect(await snapshot(org, id)).toEqual(before);
    const march = await aging(org.orgId, userId, '2026-03-31');
    expect(march.summary.netOutstanding).toBe(1000);
    expect(march.warnings).toEqual([]);
  } finally { await cleanupOrg(org.orgId); }
});

it('refuses to edit a migrated opening invoice instead of posting its amount a second time', async () => {
  const org = await createTestOrg();
  try {
    const userId = await actor(org.orgId);
    const id = await migratedOpeningInvoice(org);
    const before = await snapshot(org, id);
    const response = await editInvoice(org.orgId, userId, id, { notes: 'Edited after migration' });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/no sales posting to reverse/i);
    expect(await snapshot(org, id)).toEqual(before);
  } finally { await cleanupOrg(org.orgId); }
});

it('refuses to void a non-zero invoice whose sales posting is missing (tracked with no AR journal)', async () => {
  const org = await createTestOrg();
  try {
    const userId = await actor(org.orgId);
    const customerId = await createCustomer(org.orgId);
    // As left by a send that skipped AR posting (for example missing account defaults).
    const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'NO-AR', issueDate: new Date('2026-09-10T00:00:00Z'),
      status: 'SENT', subtotal: 500, totalAmount: 500, taxEnabled: false, postingTracked: true, postingJournalIds: [] } });
    const before = await snapshot(org, invoice.id);
    const response = await voidInvoice(org.orgId, userId, invoice.id);
    expect(response.status).toBe(422);
    expect(await snapshot(org, invoice.id)).toEqual(before);
  } finally { await cleanupOrg(org.orgId); }
});

it('still voids a posted invoice with a dated reversal, and a zero-value invoice that posted nothing', async () => {
  const org = await createTestOrg();
  try {
    const userId = await actor(org.orgId);
    const customerId = await createCustomer(org.orgId);
    const posted = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'POSTED', issueDate: new Date('2026-09-10T00:00:00Z'),
      status: 'SENT', subtotal: 700, totalAmount: 700, taxEnabled: false, lines: { create: [{ lineNo: 1, description: 'Service', quantity: 1, price: 700 }] } } });
    await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, posted.id));
    const zero = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'ZERO', issueDate: new Date('2026-09-10T00:00:00Z'),
      status: 'SENT', subtotal: 0, totalAmount: 0, taxEnabled: false } });
    await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, zero.id));
    expect((await voidInvoice(org.orgId, userId, posted.id)).status).toBe(200);
    expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId, source: 'REVERSAL', memo: 'Void invoice: POSTED' } })).toBe(1);
    expect((await snapshot(org, posted.id)).ar).toBe(0);
    expect((await voidInvoice(org.orgId, userId, zero.id)).status).toBe(200);
    expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: zero.id } })).status).toBe('VOID');
  } finally { await cleanupOrg(org.orgId); }
});

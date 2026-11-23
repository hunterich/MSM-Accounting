import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createInvoice } from '@/src/app/api/v1/invoices/route';
import { PUT as updateInvoice } from '@/src/app/api/v1/invoices/[id]/route';
import { cleanupOrg, createCustomer, createTestOrg, disconnect, prisma, type TestOrg } from './harness';

afterAll(disconnect);

const tax = { enabled: false, inclusive: false, rate: 0 };
const roundedLines = ['First', 'Second'].map(description => ({ description, quantity: '0.3333', price: '10.00' }));
const singleLine = [{ description: 'Combined quantity', quantity: '0.6666', price: '10.00' }];

async function createEditor(org: TestOrg) {
  const role = await prisma.role.create({ data: { organizationId: org.orgId, name: 'Admin', roleType: 'ADMIN' } });
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@invoice-rounding.test`, fullName: 'Invoice rounding test', status: 'ACTIVE' } });
  await prisma.userOrganization.create({ data: { organizationId: org.orgId, userId: user.id, roleId: role.id } });
  return user.id;
}

function request(org: TestOrg, userId: string, body: object, id?: string) {
  return new NextRequest(`http://localhost/api/v1/invoices${id ? '/' + id : ''}`, {
    method: id ? 'PUT' : 'POST',
    headers: { 'x-org-id': org.orgId, 'x-user-id': userId, 'x-role-type': 'ADMIN', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function createDraft(org: TestOrg, userId: string, lines: typeof roundedLines) {
  const customerId = await createCustomer(org.orgId);
  const response = await createInvoice(request(org, userId, {
    customerId, number: 'ROUND-01', issueDate: '2026-06-15', tax, lines,
    subtotal: '6.67', totalAmount: '6.67',
  }));
  expect(response.status).toBe(201);
  return response.json() as Promise<{ id: string; totalAmount: number }>;
}

const storedInvoice = (id: string) => prisma.salesInvoice.findUniqueOrThrow({
  where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } },
});

async function expectRoundedInvoice(id: string) {
  const saved = await storedInvoice(id);
  expect(saved.lines.map(line => line.lineSubtotal.toFixed(2))).toEqual(['3.33', '3.33']);
  expect(saved.subtotal.toFixed(2)).toBe('6.66');
  expect(saved.totalAmount.toFixed(2)).toBe('6.66');
  return saved;
}

async function expectRoundedPosting(org: TestOrg, id: string) {
  const saved = await expectRoundedInvoice(id);
  expect(saved.status).toBe('SENT');
  expect(saved.postingJournalIds).toHaveLength(1);
  const journal = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: saved.postingJournalIds[0] }, include: { lines: true },
  });
  expect(journal.status).toBe('POSTED');
  expect(journal.totalDebit.eq(saved.totalAmount)).toBe(true);
  expect(journal.totalCredit.eq(saved.totalAmount)).toBe(true);
  expect(journal.lines).toHaveLength(2);
  expect(journal.lines.find(line => line.accountId === org.accounts.arControl)?.debit.toFixed(2)).toBe('6.66');
  expect(journal.lines.find(line => line.accountId === org.accounts.salesRevenue)?.credit.toFixed(2)).toBe('6.66');
}

it('creates and sends two fractional lines at Rp6.66 from the saved amounts', async () => {
  const org = await createTestOrg();
  try {
    const user = await createEditor(org);
    const draft = await createDraft(org, user, roundedLines);
    expect(draft.totalAmount).toBe(6.66);
    expect((await expectRoundedInvoice(draft.id)).postingJournalIds).toEqual([]);
    const response = await updateInvoice(request(org, user, { status: 'SENT' }, draft.id), { params: Promise.resolve({ id: draft.id }) });
    expect(response.status).toBe(200);
    await expectRoundedPosting(org, draft.id);
  } finally {
    await cleanupOrg(org.orgId);
  }
});

it.each(['draft', 'posted'])('recalculates a %s invoice edit from Rp6.67 to Rp6.66 and posts the corrected amount', async mode => {
  const org = await createTestOrg();
  try {
    const user = await createEditor(org);
    const { id, totalAmount } = await createDraft(org, user, singleLine);
    expect(totalAmount).toBe(6.67);
    const put = (body: object) => updateInvoice(request(org, user, body, id), { params: Promise.resolve({ id }) });
    if (mode === 'posted') expect((await put({ status: 'SENT' })).status).toBe(200);

    const response = await put({
      ...(mode === 'draft' && { status: 'SENT' }),
      subtotal: '6.67', totalAmount: '6.67',
      lines: roundedLines.map((line, index) => ({ ...line, lineSubtotal: index === 0 ? '3.33' : '3.34' })),
    });
    expect(response.status).toBe(200);
    await expectRoundedPosting(org, id);

    const ar = await prisma.journalLine.aggregate({
      where: { accountId: org.accounts.arControl, entry: { organizationId: org.orgId, status: 'POSTED' } },
      _sum: { debit: true, credit: true },
    });
    expect(ar._sum.debit?.minus(ar._sum.credit ?? 0).toFixed(2)).toBe('6.66');
  } finally {
    await cleanupOrg(org.orgId);
  }
});

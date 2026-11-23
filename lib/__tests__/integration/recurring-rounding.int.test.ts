import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, expect, it } from 'vitest';
import { POST as generateInvoice } from '@/src/app/api/v1/recurring-invoices/[id]/generate/route';
import { POST as generateBill } from '@/src/app/api/v1/recurring-bills/[id]/generate/route';
import { approveRequest } from '../../approval/engine';
import { runDueRecurringInvoices } from '../../recurring-invoices';
import { runDueRecurringBills } from '../../recurring-bills';
import { cleanupOrg, createCustomer, createTestOrg, createVendor, disconnect, prisma, type TestOrg } from './harness';

afterAll(disconnect);

const day = new Date('2026-06-15');
const now = new Date('2026-06-15T03:00:00Z');
const dates = { frequency: 'MONTHLY' as const, startDate: day, nextRunDate: day };

async function createAdmin(org: TestOrg) {
  const role = await prisma.role.create({ data: { organizationId: org.orgId, name: randomUUID(), roleType: 'ADMIN' } });
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@recurring-rounding.test`, fullName: 'Recurring rounding test', status: 'ACTIVE' } });
  await prisma.userOrganization.create({ data: { organizationId: org.orgId, userId: user.id, roleId: role.id } });
  return user.id;
}

function manualRequest(org: TestOrg, userId: string, type: 'invoices' | 'bills', id: string) {
  return new NextRequest(`http://localhost/api/v1/recurring-${type}/${id}/generate`, {
    method: 'POST',
    headers: { 'x-org-id': org.orgId, 'x-user-id': userId, 'x-role-type': 'ADMIN' },
  });
}

async function readJournal(id: string) {
  const journal = await prisma.journalEntry.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  return {
    status: journal.status,
    totals: [journal.totalDebit.toFixed(2), journal.totalCredit.toFixed(2)],
    lines: Object.fromEntries(journal.lines.map(line => [line.accountId, [line.debit.toFixed(2), line.credit.toFixed(2)]])),
  };
}

it.each(['manual', 'scheduled'] as const)('%s recurring invoice sums its rounded lines and posts the saved AR and PPN', async mode => {
  const org = await createTestOrg();
  try {
    const admin = await createAdmin(org);
    const customerId = await createCustomer(org.orgId);
    const outputTax = await prisma.account.create({ data: {
      organizationId: org.orgId, name: 'Output PPN', code: '2200', type: 'LIABILITY', normalSide: 'CREDIT',
      isActive: true, isPostable: true,
    } });
    await prisma.organization.update({ where: { id: org.orgId }, data: { accountDefaults: { ...org.accounts, arTax: outputTax.id } } });
    const template = await prisma.recurringInvoice.create({ data: {
      ...dates, organizationId: org.orgId, customerId, title: 'Recurring services', autoPost: true, taxRate: 11,
      lines: { create: [
        { lineNo: 1, description: 'Taxable service', quantity: '0.3333', price: 10, taxable: true },
        { lineNo: 2, description: 'Exempt service', quantity: '0.3333', price: 10, taxable: false },
      ] },
    } });

    if (mode === 'manual') {
      const response = await generateInvoice(manualRequest(org, admin, 'invoices', template.id), { params: Promise.resolve({ id: template.id }) });
      expect(response.status).toBe(201);
    } else {
      expect(await runDueRecurringInvoices(org.orgId, null, now)).toMatchObject({ generated: 1, errors: [] });
    }

    const invoice = await prisma.salesInvoice.findFirstOrThrow({
      where: { recurringInvoiceId: template.id }, include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    expect(invoice.status).toBe('SENT');
    expect(invoice.lines.map(line => [line.lineSubtotal.toFixed(2), line.taxable])).toEqual([['3.33', true], ['3.33', false]]);
    expect([invoice.subtotal.toFixed(2), invoice.taxAmount.toFixed(2), invoice.totalAmount.toFixed(2)]).toEqual(['6.66', '0.37', '7.03']);
    expect(invoice.postingJournalIds).toHaveLength(1);
    expect(await readJournal(invoice.postingJournalIds[0])).toEqual({
      status: 'POSTED', totals: ['7.03', '7.03'],
      lines: {
        [org.accounts.arControl]: ['7.03', '0.00'],
        [org.accounts.salesRevenue]: ['0.00', '6.66'],
        [outputTax.id]: ['0.00', '0.37'],
      },
    });
  } finally {
    await cleanupOrg(org.orgId);
  }
});

it.each([
  { mode: 'manual', held: false },
  { mode: 'scheduled', held: false },
  { mode: 'scheduled', held: true },
] as const)('$mode recurring bill posts the saved AP and per-line PPN (approval required: $held)', async ({ mode, held }) => {
  const org = await createTestOrg();
  try {
    const admin = await createAdmin(org);
    const vendorId = await createVendor(org.orgId);
    if (held) {
      await prisma.organization.update({ where: { id: org.orgId }, data: { approvalRequirements: { ap_bills: true } } });
    }
    const template = await prisma.recurringBill.create({ data: {
      ...dates, organizationId: org.orgId, vendorId, title: 'Recurring costs', autoPost: true, taxRate: 11,
      lines: { create: [
        { lineNo: 1, description: 'First taxable expense', quantity: 1, price: '100.05', taxable: true },
        { lineNo: 2, description: 'Second taxable expense', quantity: 1, price: '100.05', taxable: true },
        { lineNo: 3, description: 'Discounted exempt expense', quantity: 1, price: 20, discountPct: 50, taxable: false },
      ] },
    } });

    if (mode === 'manual') {
      const response = await generateBill(manualRequest(org, admin, 'bills', template.id), { params: Promise.resolve({ id: template.id }) });
      expect(response.status).toBe(201);
    } else {
      expect(await runDueRecurringBills(org.orgId, null, now)).toMatchObject({ generated: 1, errors: [] });
    }

    const generatedBill = () => prisma.bill.findFirstOrThrow({
      where: { recurringBillId: template.id }, include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    const bill = await generatedBill();
    expect(bill.lines.map(line => [line.lineTotal.toFixed(2), line.taxable])).toEqual([
      ['100.05', true], ['100.05', true], ['10.00', false],
    ]);
    expect(bill.lines[2].discountPct.toFixed(2)).toBe('50.00');
    expect([bill.subtotal.toFixed(2), bill.taxAmount.toFixed(2), bill.totalAmount.toFixed(2)]).toEqual(['210.10', '22.02', '232.12']);

    if (held) {
      expect(bill.status).toBe('PENDING_APPROVAL');
      expect(bill.journalEntryId).toBeNull();
      await prisma.recurringBillLine.updateMany({ where: { recurringId: template.id }, data: { taxable: false } });
      const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { documentId: bill.id, status: 'PENDING' } });
      await approveRequest(approval.id, { orgId: org.orgId, userId: await createAdmin(org), roleType: 'ADMIN' });
    }
    const posted = await generatedBill();
    expect(posted.status).toBe('OPEN');
    expect(await readJournal(posted.journalEntryId!)).toEqual({
      status: 'POSTED', totals: ['232.12', '232.12'],
      lines: {
        [org.accounts.cogsExpense]: ['210.10', '0.00'],
        [org.accounts.apTax]: ['22.02', '0.00'],
        [org.accounts.apControl]: ['0.00', '232.12'],
      },
    });
  } finally {
    await cleanupOrg(org.orgId);
  }
});

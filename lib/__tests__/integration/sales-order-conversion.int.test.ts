import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as convert } from '@/src/app/api/v1/sales-orders/[id]/convert/route';
import { PUT as updateInvoice } from '@/src/app/api/v1/invoices/[id]/route';
import { assertTrialBalanced, cleanupOrg, createCustomer, createTestOrg, disconnect, prisma } from './harness';

afterAll(disconnect);

it('converts discounts and company PPN to one populated invoice that posts without being re-edited', async () => {
  const org = await createTestOrg();
  const user = await prisma.user.create({ data: { email: `conversion-${randomUUID()}@test.local`, fullName: 'Conversion QA', status: 'ACTIVE' } });
  try {
    const role = await prisma.role.create({ data: { organizationId: org.orgId, name: 'Admin', roleType: 'ADMIN' } });
    await prisma.userOrganization.create({ data: { organizationId: org.orgId, userId: user.id, roleId: role.id } });
    const customerId = await createCustomer(org.orgId);
    const outputTax = await prisma.account.create({ data: {
      organizationId: org.orgId, code: '2221', name: 'Output PPN', type: 'LIABILITY', normalSide: 'CREDIT',
    } });
    await prisma.organization.update({
      where: { id: org.orgId },
      data: { taxEnabled: true, taxInclusiveByDefault: false, taxDefaultRate: 10, accountDefaults: { ...org.accounts, arTax: outputTax.id } },
    });
    const order = await prisma.salesOrder.create({ data: {
      organizationId: org.orgId, number: 'SO-ROUNDING', customerName: 'Conversion customer', customerId,
      status: 'CONFIRMED', items: { create: [
        { description: 'Service A', quantity: '0.5', price: '7.40', discount: '10.00' },
        { description: 'Service B', quantity: '0.5', price: '7.40', discount: '10.00' },
      ] },
    } });
    const request = (path: string, method: 'POST' | 'PUT', body?: unknown) => new NextRequest(`http://localhost/api/v1/${path}`, {
      method,
      headers: { 'x-org-id': org.orgId, 'x-user-id': user.id, 'x-role-type': 'ADMIN', 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const submit = () => convert(request(`sales-orders/${order.id}/convert`, 'POST'), { params: Promise.resolve({ id: order.id }) });
    const responses = await Promise.all([submit(), submit()]);
    expect(responses.map(response => response.status).sort(), (await Promise.all(responses.map(response => response.clone().text()))).join('\n'))
      .toEqual([201, 400]);
    const { invoice } = await responses.find(response => response.status === 201)!.json();
    expect(invoice).toMatchObject({ status: 'DRAFT', subtotal: '6.66', taxRate: '10', taxAmount: '0.67', totalAmount: '7.33' });
    const draft = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: true } });
    expect(draft.lines.map(line => line.lineSubtotal.toFixed(2))).toEqual(['3.33', '3.33']);
    expect(await prisma.salesInvoice.count({ where: { organizationId: org.orgId, soId: order.id } })).toBe(1);
    expect(await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: 'INVOICED', invoiceId: invoice.id,
    });
    const send = await updateInvoice(request(`invoices/${invoice.id}`, 'PUT', { status: 'SENT' }), { params: Promise.resolve({ id: invoice.id }) });
    expect(send.status, await send.clone().text()).toBe(200);
    const posted = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(posted.status).toBe('SENT');
    const lines = await prisma.journalLine.findMany({ where: { entryId: { in: posted.postingJournalIds } } });
    expect(lines.find(line => line.accountId === org.accounts.arControl)?.debit.toFixed(2)).toBe('7.33');
    expect(lines.find(line => line.accountId === org.accounts.salesRevenue)?.credit.toFixed(2)).toBe('6.66');
    expect(lines.find(line => line.accountId === outputTax.id)?.credit.toFixed(2)).toBe('0.67');
    await assertTrialBalanced(org.orgId, 'sales-order conversion');
  } finally {
    await prisma.journalEntry.deleteMany({ where: { organizationId: org.orgId } });
    await cleanupOrg(org.orgId);
    await prisma.user.delete({ where: { id: user.id } });
  }
});

import { afterAll, expect, it } from 'vitest';
import { marketplaceInvoiceStatus } from '@/lib/marketplace-invoice';
import { prisma, createTestOrg, createCustomer, cleanupOrg, disconnect } from './harness';

afterAll(disconnect);
it('uses non-void persisted import provenance only, scoped to the company', async () => {
  const org = await createTestOrg(), other = await createTestOrg();
  try {
    const customerId = await createCustomer(org.orgId);
    const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'INV-PROV', issueDate: new Date('2026-01-01') } });
    const check = (orgId = org.orgId) => prisma.$transaction(tx => marketplaceInvoiceStatus(tx, orgId, invoice.id));
    expect(await check()).toBe('NONE');
    const payment = await prisma.aRPayment.create({ data: { organizationId: org.orgId, customerId, number: 'ARP-PROV', date: new Date('2026-01-01'), status: 'COMPLETED', allocations: { create: { invoiceId: invoice.id, amountApplied: 1 } } } });
    expect(await check()).toBe('NONE');
    await prisma.aRPayment.update({ where: { id: payment.id }, data: { source: 'MARKETPLACE_IMPORT' } });
    expect(await check()).toBe('MARKETPLACE');
    expect(await check(other.orgId)).toBe('NONE');
    await prisma.aRPayment.update({ where: { id: payment.id }, data: { status: 'VOID' } });
    expect(await check()).toBe('NONE');
  } finally { await cleanupOrg(org.orgId); await cleanupOrg(other.orgId); }
});

import { afterAll, expect, it } from 'vitest';
import { postArPaymentIfNeeded, postApPaymentIfNeeded } from '@/lib/payment-posting';
import { prisma, createTestOrg, createCustomer, createVendor, cleanupOrg, disconnect } from './harness';

afterAll(disconnect);

for (const kind of ['ar', 'ap'] as const) {
  it(`${kind} posting validates every journal account and preserves preferred-code bank defaults`, async () => {
    const org = await createTestOrg();
    const other = await createTestOrg();
    const date = new Date('2026-09-15');
    try {
      const party = kind === 'ar' ? await createCustomer(org.orgId) : await createVendor(org.orgId);
      const doc = kind === 'ar'
        ? await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId: party, number: 'ACCOUNT-GUARD', issueDate: date, status: 'SENT', subtotal: 1000, totalAmount: 1000 } })
        : await prisma.bill.create({ data: { organizationId: org.orgId, vendorId: party, number: 'ACCOUNT-GUARD', issueDate: date, status: 'OPEN', subtotal: 1000, totalAmount: 1000 } });
      const kasbon = await prisma.account.create({ data: { organizationId: org.orgId, code: '1800', name: 'Kasbon Karyawan', type: 'ASSET', normalSide: 'DEBIT' } });
      const count = () => prisma.journalEntry.count({ where: { organizationId: org.orgId } });
      const before = await count();
      const post = async (override: Record<string, string> = {}) => prisma.$transaction(async tx => {
        const common = { organizationId: org.orgId, number: 'ACCOUNT-GUARD-PAY', date, status: 'COMPLETED' as const, totalAmount: 105, ...override };
        if (kind === 'ar') {
          const payment = await tx.aRPayment.create({ data: { ...common, customerId: party, allocations: { create: { invoiceId: doc.id, amountApplied: 100, discountAmount: 10, penaltyAmount: 5 } } } });
          await postArPaymentIfNeeded(tx, org.orgId, payment.id);
          return tx.aRPayment.findUniqueOrThrow({ where: { id: payment.id } });
        }
        const payment = await tx.aPPayment.create({ data: { ...common, vendorId: party, allocations: { create: { billId: doc.id, amountApplied: 100, discountAmount: 10, penaltyAmount: 5 } } } });
        await postApPaymentIfNeeded(tx, org.orgId, payment.id);
        return tx.aPPayment.findUniqueOrThrow({ where: { id: payment.id } });
      });
      const fields = [
        { field: kind === 'ar' ? 'depositAccountId' : 'cashAccountId', type: 'ASSET' as const },
        { field: kind === 'ar' ? 'arAccountId' : 'apAccountId', type: kind === 'ar' ? 'ASSET' as const : 'LIABILITY' as const },
        { field: 'discountAccountId', type: kind === 'ar' ? 'EXPENSE' as const : 'REVENUE' as const },
        { field: 'penaltyAccountId', type: kind === 'ar' ? 'REVENUE' as const : 'EXPENSE' as const },
      ];
      for (const { field, type } of fields) {
        const foreign = await prisma.account.findFirstOrThrow({ where: { organizationId: other.orgId, type, isPostable: true } });
        const inactive = await prisma.account.create({ data: { organizationId: org.orgId, code: `QA-${field}-inactive`, name: 'Inactive Cash', type, normalSide: 'DEBIT', isActive: false } });
        const header = await prisma.account.create({ data: { organizationId: org.orgId, code: `QA-${field}-header`, name: 'Cash header', type, normalSide: 'DEBIT', isPostable: false } });
        const wrongType = await prisma.account.findFirstOrThrow({ where: { organizationId: org.orgId, type: { not: type }, isPostable: true } });
        for (const account of [foreign, inactive, header, wrongType]) {
          await expect(post({ [field]: account.id })).rejects.toMatchObject({ status: 422 });
          expect(await count()).toBe(before);
        }
      }
      await expect(post({ [fields[0].field]: kasbon.id })).rejects.toMatchObject({ status: 422 });
      expect(await count()).toBe(before);
      const paymentCount = kind === 'ar' ? await prisma.aRPayment.count({ where: { organizationId: org.orgId } }) : await prisma.aPPayment.count({ where: { organizationId: org.orgId } });
      expect(paymentCount).toBe(0);

      // No configured bank: preferred code 112 must remain usable without cash keywords.
      await prisma.account.update({ where: { id: org.accounts.bankAsset }, data: { code: '112', name: 'BCA 0123-456' } });
      const { bankAsset: _bankAsset, ...defaults } = org.accounts;
      await prisma.organization.update({ where: { id: org.orgId }, data: { accountDefaults: defaults } });
      const payment = await post();
      expect(payment.journalEntryId).toBeTruthy();
      expect(await prisma.journalLine.count({ where: { entryId: payment.journalEntryId!, accountId: org.accounts.bankAsset, ...(kind === 'ar' ? { debit: 105 } : { credit: 105 }) } })).toBe(1);
      expect(await prisma.journalLine.count({ where: { entryId: payment.journalEntryId! } })).toBe(4);
      expect(await count()).toBe(before + 1);
    } finally {
      await cleanupOrg(org.orgId);
      await cleanupOrg(other.orgId);
    }
  });
}

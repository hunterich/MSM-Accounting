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

for (const kind of ['ar', 'ap'] as const) {
  it(`${kind} accepts a non-default named bank only after company Banking configuration maps it`, async () => {
    const org = await createTestOrg();
    const other = await createTestOrg();
    try {
      const party = kind === 'ar' ? await createCustomer(org.orgId) : await createVendor(org.orgId);
      const bank = await prisma.account.create({ data: { organizationId: org.orgId, code: '1190', name: 'BCA 0123', type: 'ASSET', normalSide: 'DEBIT' } });
      const field = kind === 'ar' ? 'depositAccountId' : 'cashAccountId';
      const create = (accountId = bank.id) => prisma.$transaction(async tx => {
        const common = { organizationId: org.orgId, number: 'BANK-MAPPED', date: new Date('2026-09-15'), totalAmount: 100, status: 'COMPLETED' as const, [field]: accountId };
        if (kind === 'ar') {
          const payment = await tx.aRPayment.create({ data: { ...common, customerId: party } });
          await postArPaymentIfNeeded(tx, org.orgId, payment.id);
          return tx.aRPayment.findUniqueOrThrow({ where: { id: payment.id } });
        }
        const payment = await tx.aPPayment.create({ data: { ...common, vendorId: party } });
        await postApPaymentIfNeeded(tx, org.orgId, payment.id);
        return tx.aPPayment.findUniqueOrThrow({ where: { id: payment.id } });
      });
      await expect(create()).rejects.toMatchObject({ status: 422 });
      // Short Banking codes must not authorize the receivable account or named bank.
      const receivable = await prisma.account.findUniqueOrThrow({ where: { id: org.accounts.arControl } });
      await prisma.account.update({ where: { id: receivable.id }, data: { code: '1-1200' } });
      const short = await prisma.bankAccount.create({ data: { organizationId: org.orgId, code: '1', name: 'Settlement' } });
      await expect(create(receivable.id)).rejects.toMatchObject({ status: 422 });
      await expect(create()).rejects.toMatchObject({ status: 422 });
      await prisma.bankAccount.update({ where: { id: short.id }, data: { code: '01' } });
      await expect(create(receivable.id)).rejects.toMatchObject({ status: 422 });
      const mapped = await prisma.bankAccount.create({ data: { organizationId: org.orgId, name: 'BCA 0123', bankName: 'BCA', isActive: false } });
      await expect(create()).rejects.toMatchObject({ status: 422 });
      await prisma.bankAccount.update({ where: { id: mapped.id }, data: { isActive: true } });
      await expect(create(other.accounts.bankAsset)).rejects.toMatchObject({ status: 422 });
      expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(0);
      const payment = await create();
      expect(await prisma.journalLine.count({ where: { entryId: payment.journalEntryId!, accountId: bank.id, ...(kind === 'ar' ? { debit: 100 } : { credit: 100 }) } })).toBe(1);
    } finally { await cleanupOrg(org.orgId); await cleanupOrg(other.orgId); }
  });
}

it('internal configured deposit context still checks the receipt account itself', async () => {
  const org = await createTestOrg();
  const other = await createTestOrg();
  try {
    const customerId = await createCustomer(org.orgId);
    const drawer = await prisma.account.create({ data: { organizationId: org.orgId, code: '1190', name: 'Kasir 1', type: 'ASSET', normalSide: 'DEBIT' } });
    for (const accountId of [other.accounts.bankAsset, org.accounts.salesRevenue]) {
      await expect(prisma.$transaction(async tx => {
        const payment = await tx.aRPayment.create({ data: { organizationId: org.orgId, number: 'TRUST-CHECK', customerId, date: new Date('2026-09-15'), status: 'COMPLETED', totalAmount: 100, depositAccountId: accountId } });
        await postArPaymentIfNeeded(tx, org.orgId, payment.id, {}, { source: 'MARKETPLACE_HOLDING', accountId });
      })).rejects.toMatchObject({ status: 422 });
    }
    await expect(prisma.$transaction(async tx => {
      const payment = await tx.aRPayment.create({ data: { organizationId: org.orgId, number: 'TRUST-MISMATCH', customerId, date: new Date('2026-09-15'), status: 'COMPLETED', totalAmount: 100, depositAccountId: drawer.id } });
      await postArPaymentIfNeeded(tx, org.orgId, payment.id, {}, { source: 'POS_REGISTER', accountId: org.accounts.bankAsset });
    })).rejects.toMatchObject({ status: 422 });
    expect(await prisma.aRPayment.count({ where: { organizationId: org.orgId } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(0);
  } finally { await cleanupOrg(org.orgId); await cleanupOrg(other.orgId); }
});

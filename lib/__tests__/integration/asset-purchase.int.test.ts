import { afterAll, expect, it } from 'vitest';
import { createBillRecord } from '../../bills';
import { postBillToLedger } from '../../bill-posting';
import { voidBill } from '../../bill-void';
import { prisma, createTestOrg, createVendor, cleanupOrg, disconnect, accountBalance, assertTrialBalanced, journalEntryCount } from './harness';
afterAll(disconnect);
it('draft bill creates the linked asset, posting books cost once, and draft-asset void reverses it', async () => {
  const org = await createTestOrg();
  try {
    const vendorId = await createVendor(org.orgId);
    const fixed = await prisma.account.create({ data: { organizationId: org.orgId, code: '1500', name: 'Equipment', type: 'ASSET', normalSide: 'DEBIT', isActive: true, isPostable: true } });
    const category = await prisma.assetCategory.create({ data: { organizationId: org.orgId, name: 'Equipment', assetAccountId: fixed.id } });
    const bill = await prisma.$transaction(tx => createBillRecord(tx, org.orgId, { organizationId: org.orgId, vendorId, vendorInvoiceNo: 'ASSET-INVOICE', issueDate: '2026-09-01', status: 'DRAFT', taxable: true, taxInclusive: true, taxRate: 11, subtotal: 1000, taxAmount: 110, totalAmount: 1110,
      lines: [{ description: 'Equipment', quantity: 1, price: 1110, unit: 'PCS', assetPurchase: { mode: 'CREATE', name: 'Equipment', categoryId: category.id } }] }));
    expect(bill!.lines[0].assetId).toBeTruthy();
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: bill!.lines[0].assetId! } });
    expect(Number(asset.acquisitionCost)).toBe(1000); expect(asset.status).toBe('DRAFT');
    expect(await journalEntryCount(org.orgId)).toBe(0);
    await prisma.$transaction(async tx => {
      await tx.bill.update({ where: { id: bill!.id }, data: { status: 'OPEN' } });
      await postBillToLedger(tx, org.orgId, bill!);
    });
    expect(await accountBalance(org.orgId, fixed.id)).toBe(1000);
    expect(await journalEntryCount(org.orgId)).toBe(1);
    expect(await prisma.inventoryLot.count({ where: { organizationId: org.orgId, documentId: bill!.id } })).toBe(0);
    await assertTrialBalanced(org.orgId);
    await prisma.$transaction(tx => voidBill(tx, org.orgId, bill!.id, { date: new Date('2026-09-02') }));
    expect(await accountBalance(org.orgId, fixed.id)).toBe(0);
    await assertTrialBalanced(org.orgId);
  } finally { await cleanupOrg(org.orgId); }
});

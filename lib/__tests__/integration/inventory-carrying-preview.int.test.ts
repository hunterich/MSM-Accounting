import { afterAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { postBillToLedger } from '@/lib/bill-posting';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { previewInventoryCarryingValues } from '@/lib/inventory-carrying-preview';
import { prisma, createTestOrg, createVendor, createCustomer, createItem, cleanupOrg, disconnect, accountBalance } from './harness';

afterAll(disconnect);

describe('read-only INV-02 carrying-value proposal', () => {
  it('allocates the remaining book value exactly while leaving receipt costs and all postings unchanged', async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' });
    try {
      const itemId = await createItem(org.orgId, 1000), vendorId = await createVendor(org.orgId), customerId = await createCustomer(org.orgId);
      const date = new Date('2026-09-10');
      for (const [number, price] of [['A', 1000], ['B', 1200]] as const) {
        const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number, issueDate: date,
          status: 'OPEN', totalAmount: 5 * price,
          lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: 5, price, lineTotal: 5 * price } } }, include: { lines: true } });
        await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill));
      }
      const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'SALE', issueDate: date,
        status: 'SENT', subtotal: 12000, totalAmount: 12000,
        lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: 4, price: 3000, lineSubtotal: 12000 } } } });
      await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id));
      const lotsBefore = await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId }, orderBy: { id: 'asc' } });
      const movementsBefore = await prisma.inventoryLedgerEntry.findMany({ where: { organizationId: org.orgId }, orderBy: { id: 'asc' } });
      const proposal = await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const mode = await tx.$queryRaw<Array<{ transaction_read_only: string }>>`SHOW transaction_read_only`;
        expect(mode[0].transaction_read_only).toBe('on');
        return previewInventoryCarryingValues(tx, org.orgId, itemId, null);
      }, { isolationLevel: 'RepeatableRead' });
      expect(proposal.bookValue).toBe('6600.00');
      expect(proposal.ledgerQuantity).toBe('6.0000');
      const databaseUrl = process.env.DATABASE_URL!;
      expect(new URL(databaseUrl).pathname.endsWith('_test')).toBe(true);
      const cli = await promisify(execFile)(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/preview-inventory-carrying.ts',
        '--company', org.orgId, '--item', itemId], { env: { ...process.env, DATABASE_URL: databaseUrl }, timeout: 10000 });
      expect(JSON.parse(cli.stdout)).toEqual({ mode: 'READ_ONLY_PROPOSAL', ...proposal });
      const byReceipt = [...proposal.lots].sort((a, b) => a.originalReceiptUnitCost.localeCompare(b.originalReceiptUnitCost));
      expect(byReceipt.map(lot => ({ quantity: lot.quantity, receipt: lot.originalReceiptUnitCost, value: lot.proposedCarryingValue }))).toEqual([
        { quantity: '1.0000', receipt: '1000.000000', value: '1100.00' },
        { quantity: '5.0000', receipt: '1200.000000', value: '5500.00' },
      ]);
      expect(await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId }, orderBy: { id: 'asc' } })).toEqual(lotsBefore);
      expect(await prisma.inventoryLedgerEntry.findMany({ where: { organizationId: org.orgId }, orderBy: { id: 'asc' } })).toEqual(movementsBefore);
      expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(6600);
    } finally { await cleanupOrg(org.orgId); }
  });

  it('refuses an incomplete pool instead of proposing a fabricated carrying value', async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' });
    try {
      const itemId = await createItem(org.orgId, 1000);
      await prisma.inventoryLot.create({ data: { organizationId: org.orgId, itemId, documentType: 'PURCHASE', documentId: 'MISSING-LEDGER',
        date: new Date('2026-09-10'), qtyIn: 1, qtyBalance: 1, unitCost: 1000 } });
      await expect(prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return previewInventoryCarryingValues(tx, org.orgId, itemId, null);
      }, { isolationLevel: 'RepeatableRead' })).rejects.toThrow('requires reconciliation');
      expect(await prisma.inventoryLedgerEntry.count({ where: { organizationId: org.orgId } })).toBe(0);
    } finally { await cleanupOrg(org.orgId); }
  });
});

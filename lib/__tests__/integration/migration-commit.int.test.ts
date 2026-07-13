import { afterAll, describe, expect, it } from 'vitest';
import { createBatch, stageEntity } from '../../migration/batch-service';
import { commitBatch, resolveControlCodes } from '../../migration/commit';
import { buildTrialBalanceReport, type GlAccount, type JournalLineRecord } from '../../gl-reporting';
import { toNumber } from '../../money';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';

afterAll(async () => { await disconnect(); });

const CUTOVER = new Date('2026-01-01T00:00:00.000Z');

/**
 * Rebuild the live Trial Balance as-of a date, exactly as the GL report route
 * does: postable accounts + POSTED journal lines dated on/before the cutover.
 * `buildTrialBalanceReport(accounts, lines)` — not `(orgId, date)`.
 */
async function liveTrialBalance(orgId: string, asOf: Date) {
  const end = new Date(asOf);
  end.setHours(23, 59, 59, 999);
  const accounts = await prisma.account.findMany({
    where: { organizationId: orgId, isPostable: true },
    select: { id: true, code: true, name: true, type: true, normalSide: true, isPostable: true },
  });
  const lines = await prisma.journalLine.findMany({
    where: { entry: { organizationId: orgId, status: 'POSTED', date: { lte: end } } },
    select: { accountId: true, debit: true, credit: true },
  });
  return buildTrialBalanceReport(
    accounts as GlAccount[],
    lines.map((l) => ({ accountId: l.accountId, debit: toNumber(l.debit), credit: toNumber(l.credit) })) as JournalLineRecord[],
  );
}

describe('migration commit', () => {
  it('writes a balanced, reconciled, stamped migration', async () => {
    const org = await createTestOrg();
    const batch = await createBatch(org.orgId, CUTOVER, null);
    const c = await resolveControlCodes(org.orgId); // { AR, AP, INVENTORY, OPENING_EQUITY } as codes

    await stageEntity(org.orgId, batch.id, 'customers', [{ name: 'PT Andi' }]);
    await stageEntity(org.orgId, batch.id, 'vendors', [{ name: 'CV Boga' }]);
    await stageEntity(org.orgId, batch.id, 'items', [
      { name: 'Widget', sku: 'WIDGET', type: 'PRODUCT', openingStock: 4, openingValue: 4_000_000 },
    ]);
    await stageEntity(org.orgId, batch.id, 'opening-journal', [
      { accountCode: c.AR, debit: 10_000_000, credit: 0 },
      { accountCode: c.INVENTORY, debit: 4_000_000, credit: 0 },
      { accountCode: c.AP, debit: 0, credit: 6_000_000 },
      { accountCode: c.OPENING_EQUITY, debit: 0, credit: 8_000_000 },
    ]);
    await stageEntity(org.orgId, batch.id, 'opening-invoices', [
      { customerName: 'PT Andi', issueDate: '2025-12-01', amount: 10_000_000 },
    ]);
    await stageEntity(org.orgId, batch.id, 'opening-bills', [
      { vendorName: 'CV Boga', issueDate: '2025-12-05', amount: 6_000_000 },
    ]);

    const result = await commitBatch(org.orgId, batch.id, null);
    expect(result.reconcile.ok).toBe(true);
    expect(result.committed).toBe(true);

    // Live TB as-of cutover equals imported TB.
    const tb = await liveTrialBalance(org.orgId, CUTOVER);
    const row = (code: string) => {
      const found = tb.rows.find((r) => r.accountCode === code);
      if (!found) throw new Error(`No TB row for account code ${code}`);
      return found;
    };
    expect(row(c.AR).endingDebit).toBe(10_000_000);
    expect(row(c.AR).endingCredit).toBe(0);
    expect(row(c.INVENTORY).endingDebit).toBe(4_000_000);
    expect(row(c.AP).endingCredit).toBe(6_000_000);
    expect(row(c.AP).endingDebit).toBe(0);
    expect(row(c.OPENING_EQUITY).endingCredit).toBe(8_000_000);
    // Whole-ledger balance holds.
    expect(tb.summary.endingDebit).toBe(tb.summary.endingCredit);

    // Exactly ONE opening journal (no double-post from stock):
    const jes = await prisma.journalEntry.count({
      where: { organizationId: org.orgId, source: 'OPENING' },
    });
    expect(jes).toBe(1);

    // Everything stamped:
    const stampedInvoices = await prisma.salesInvoice.count({
      where: { organizationId: org.orgId, migrationBatchId: batch.id },
    });
    expect(stampedInvoices).toBe(1);
    const stampedBills = await prisma.bill.count({
      where: { organizationId: org.orgId, migrationBatchId: batch.id },
    });
    expect(stampedBills).toBe(1);
    const stampedJournals = await prisma.journalEntry.count({
      where: { organizationId: org.orgId, migrationBatchId: batch.id },
    });
    expect(stampedJournals).toBe(1);
    const stampedItems = await prisma.item.count({
      where: { organizationId: org.orgId, migrationBatchId: batch.id },
    });
    expect(stampedItems).toBe(1);

    // Opening stock wrote a lot but NO inventory GL (postGl:false).
    const lots = await prisma.inventoryLot.count({ where: { organizationId: org.orgId } });
    expect(lots).toBe(1);
    // The opening-stock lot + ledger rows are stamped so rollback can delete them.
    expect(
      await prisma.inventoryLot.count({
        where: { organizationId: org.orgId, migrationBatchId: batch.id },
      }),
    ).toBe(1);
    expect(
      await prisma.inventoryLedgerEntry.count({
        where: { organizationId: org.orgId, migrationBatchId: batch.id },
      }),
    ).toBe(1);

    // Batch marked committed.
    const committed = await prisma.migrationBatch.findUnique({ where: { id: batch.id } });
    expect(committed?.status).toBe('COMMITTED');

    await cleanupOrg(org.orgId);
  });

  it('refuses to commit and writes nothing when reconciliation fails', async () => {
    const org = await createTestOrg();
    const batch = await createBatch(org.orgId, CUTOVER, null);
    const c = await resolveControlCodes(org.orgId);
    await stageEntity(org.orgId, batch.id, 'opening-journal', [
      { accountCode: c.AR, debit: 100, credit: 0 }, // unbalanced
    ]);
    const result = await commitBatch(org.orgId, batch.id, null);
    expect(result.committed).toBe(false);
    expect(
      await prisma.journalEntry.count({ where: { organizationId: org.orgId, source: 'OPENING' } }),
    ).toBe(0);
    const stillDraft = await prisma.migrationBatch.findUnique({ where: { id: batch.id } });
    expect(stillDraft?.status).toBe('DRAFT');
    await cleanupOrg(org.orgId);
  });

  it('rejects a non-stocked item carrying opening stock and writes nothing', async () => {
    const org = await createTestOrg();
    const batch = await createBatch(org.orgId, CUTOVER, null);
    await stageEntity(org.orgId, batch.id, 'items', [
      { name: 'Consulting', sku: 'SVC', type: 'SERVICE', openingStock: 5, openingValue: 500_000 },
    ]);

    await expect(commitBatch(org.orgId, batch.id, null)).rejects.toThrow(/non-stocked/i);

    // Nothing written: no item, no lot, batch still DRAFT.
    expect(await prisma.item.count({ where: { organizationId: org.orgId } })).toBe(0);
    expect(await prisma.inventoryLot.count({ where: { organizationId: org.orgId } })).toBe(0);
    const stillDraft = await prisma.migrationBatch.findUnique({ where: { id: batch.id } });
    expect(stillDraft?.status).toBe('DRAFT');
    await cleanupOrg(org.orgId);
  });
});

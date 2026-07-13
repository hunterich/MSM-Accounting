import { afterAll, describe, expect, it } from 'vitest';
import { createBatch, stageEntity } from '../../migration/batch-service';
import { commitBatch, resolveControlCodes } from '../../migration/commit';
import { rollbackBatch } from '../../migration/rollback';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';

afterAll(async () => { await disconnect(); });
const CUTOVER = new Date('2026-01-01T00:00:00.000Z');

async function commitSmall(orgId: string) {
  const batch = await createBatch(orgId, CUTOVER, null);
  const c = await resolveControlCodes(orgId);
  await stageEntity(orgId, batch.id, 'customers', [{ name: 'PT Andi' }]);
  await stageEntity(orgId, batch.id, 'opening-journal', [
    { accountCode: c.AR, debit: 10_000_000, credit: 0 },
    { accountCode: c.OPENING_EQUITY, debit: 0, credit: 10_000_000 },
  ]);
  await stageEntity(orgId, batch.id, 'opening-invoices', [
    { customerName: 'PT Andi', issueDate: '2025-12-01', amount: 10_000_000 },
  ]);
  await commitBatch(orgId, batch.id, null);
  return batch.id;
}

describe('migration rollback', () => {
  it('removes every stamped record and marks the batch ROLLED_BACK', async () => {
    const org = await createTestOrg();
    const batchId = await commitSmall(org.orgId);
    const res = await rollbackBatch(org.orgId, batchId);
    expect(res.rolledBack).toBe(true);
    expect(await prisma.customer.count({ where: { organizationId: org.orgId, migrationBatchId: batchId } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId, migrationBatchId: batchId } })).toBe(0);
    const b = await prisma.migrationBatch.findUnique({ where: { id: batchId } });
    expect(b!.status).toBe('ROLLED_BACK');
    await cleanupOrg(org.orgId);
  });

  it('is blocked when a non-migration transaction was posted after cutover', async () => {
    const org = await createTestOrg();
    const batchId = await commitSmall(org.orgId);
    await prisma.journalEntry.create({
      data: {
        organizationId: org.orgId, entryNo: 'JE-999999', date: new Date('2026-02-01'),
        memo: 'real activity', source: 'MANUAL', status: 'POSTED',
        totalDebit: 0, totalCredit: 0, postedAt: new Date('2026-02-01'),
      },
    });
    const res = await rollbackBatch(org.orgId, batchId);
    expect(res.rolledBack).toBe(false);
    expect(res.reason).toMatch(/posted/i);
    await cleanupOrg(org.orgId);
  });
});

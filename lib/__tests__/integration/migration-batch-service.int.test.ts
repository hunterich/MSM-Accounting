import { afterAll, describe, expect, it } from 'vitest';
import { createBatch, stageEntity, getBatch } from '../../migration/batch-service';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';

afterAll(async () => { await disconnect(); });

describe('migration batch service', () => {
  it('creates a DRAFT batch and stages validated rows', async () => {
    const org = await createTestOrg();
    const batch = await createBatch(org.orgId, new Date('2026-01-01'), null);
    expect(batch.status).toBe('DRAFT');

    const res = await stageEntity(org.orgId, batch.id, 'customers', [
      { name: 'PT Andi' }, { name: '' }, // second row invalid
    ]);
    expect(res.staged).toBe(1);
    expect(res.errors.length).toBe(1);

    const reloaded = await getBatch(org.orgId, batch.id);
    expect((reloaded!.stagedData as any).customers).toHaveLength(1);
    await cleanupOrg(org.orgId);
  });
});

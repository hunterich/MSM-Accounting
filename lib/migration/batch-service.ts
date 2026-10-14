import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { MIGRATION_ENTITIES, validateRows, type MigrationEntity } from './schemas';
import { ApiError } from '../errors';

export async function createBatch(orgId: string, cutoverDate: Date, userId: string | null) {
  return prisma.migrationBatch.create({
    data: { organizationId: orgId, cutoverDate, createdById: userId },
  });
}

export async function getBatch(orgId: string, batchId: string) {
  return prisma.migrationBatch.findFirst({ where: { id: batchId, organizationId: orgId } });
}

export async function listBatches(orgId: string) {
  return prisma.migrationBatch.findMany({
    where: { organizationId: orgId }, orderBy: { createdAt: 'desc' },
  });
}

export async function stageEntity(
  orgId: string, batchId: string, entity: MigrationEntity, rows: unknown[],
) {
  if (!MIGRATION_ENTITIES.includes(entity)) throw new Error(`Unknown entity: ${entity}`);
  const { valid, errors } = validateRows(entity, rows);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "MigrationBatch" WHERE "id" = ${batchId} AND "organizationId" = ${orgId} FOR UPDATE`;
    const batch = await tx.migrationBatch.findFirst({ where: { id: batchId, organizationId: orgId } });
    if (!batch) throw new ApiError('Batch not found', 404);
    if (batch.status !== 'DRAFT') throw new ApiError('Batch is not editable', 409);
    const staged = { ...(batch.stagedData as Record<string, unknown[]>), [entity]: valid };
    await tx.migrationBatch.update({ where: { id: batchId }, data: { stagedData: staged as Prisma.InputJsonValue } });
  });
  return { staged: valid.length, errors };
}

// @ts-nocheck
import { NextResponse } from 'next/server';
import { withCors } from '@/lib/cors';
import { prisma as defaultPrisma } from '@/lib/prisma';

export function ok(data: unknown, status = 200) {
  return withCors(NextResponse.json(data, { status }));
}

/**
 * Fire-and-forget audit log writer.
 * Call after successful create/update/delete operations.
 */
export function logAudit(opts: {
  orgId: string;
  actorId?: string | null;
  entityType: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  payload?: Record<string, unknown> | null;
}) {
  defaultPrisma.auditLog.create({
    data: {
      organizationId: opts.orgId,
      actorId: opts.actorId ?? null,
      entityType: opts.entityType,
      entityId: opts.entityId,
      action: opts.action,
      payload: opts.payload ?? undefined,
    },
  }).catch((err) => {
    console.error('[AuditLog] Failed to write:', err);
  });
}

export function err(message: string, status: number) {
  return withCors(NextResponse.json({ error: message }, { status }));
}

export function listResponse(
  data: unknown[],
  total: number,
  page: number,
  limit: number
) {
  return ok({ data, total, page, limit });
}

/**
 * Sequential number generator using Postgres advisory lock.
 * Safe for concurrent requests — only one transaction increments at a time.
 *
 * @param prisma  - Prisma client instance
 * @param tableName - Prisma model name (e.g. 'SalesInvoice', 'Bill', 'ARPayment')
 * @param field   - The column holding the number string (e.g. 'invoiceNumber')
 * @param prefix  - Number prefix (e.g. 'INV', 'BILL', 'PO', 'ARP', 'APP', 'EMP')
 */
export async function nextNumber(
  prisma: any,
  tableName: string,
  field: string,
  prefix: string
): Promise<string> {
  // Derive a stable integer lock ID from the table name
  const lockId = Math.abs(
    tableName.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  );
  await prisma.$executeRaw`SELECT pg_advisory_xact_lock(${lockId})`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT MAX(CAST(SUBSTRING("${field}" FROM '[0-9]+') AS INTEGER)) AS max FROM "${tableName}"`
  );
  const max: number = rows[0]?.max ?? 0;
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { withCors } from '@/lib/cors';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { AccessError } from '@/lib/document-access';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function ok(data: unknown, status = 200) {
  return withCors(NextResponse.json(data, { status }));
}

function normalizeAuditPayload(
  payload: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (payload === undefined) return undefined;
  if (payload === null) return Prisma.JsonNull;

  // Round-trip through JSON to guarantee Prisma receives JSON-safe data.
  return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
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
  payload?: unknown;
}) {
  let payload: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined;
  try {
    payload = normalizeAuditPayload(opts.payload);
  } catch (error) {
    console.error('[AuditLog] Failed to serialize payload:', error);
    payload = undefined;
  }

  defaultPrisma.auditLog.create({
    data: {
      organizationId: opts.orgId,
      actorId: opts.actorId ?? null,
      entityType: opts.entityType,
      entityId: opts.entityId,
      action: opts.action,
      payload,
    },
  }).catch((err) => {
    console.error('[AuditLog] Failed to write:', err);
  });
}

export function err(message: string, status: number) {
  return withCors(NextResponse.json({ error: message }, { status }));
}

export function parsePaginationParams(
  req: NextRequest,
  defaults: { page?: number; limit?: number; maxLimit?: number } = {},
) {
  const { searchParams } = new URL(req.url);
  const defaultPage = defaults.page ?? 1;
  const defaultLimit = defaults.limit ?? 20;
  const maxLimit = defaults.maxLimit ?? 100;

  const rawPage = Number(searchParams.get('page') ?? defaultPage);
  const rawLimit = Number(searchParams.get('limit') ?? defaultLimit);

  const page = Number.isFinite(rawPage) ? Math.max(1, Math.trunc(rawPage)) : defaultPage;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(maxLimit, Math.max(1, Math.trunc(rawLimit)))
    : defaultLimit;

  return { searchParams, page, limit };
}

export function listResponse(
  data: unknown[],
  total: number,
  page: number,
  limit: number
) {
  return ok({ data, total, page, limit });
}

export async function softDelete(
  delegate: {
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
  },
  where: Record<string, unknown>,
  data: Record<string, unknown>,
) {
  const result = await delegate.updateMany({ where, data });
  return result.count > 0;
}

export async function validateForeignKey(
  delegate: {
    findFirst: (args: { where: Record<string, unknown>; select: { id: true } }) => Promise<{ id: string } | null>;
  },
  where: Record<string, unknown>,
  message: string,
) {
  const record = await delegate.findFirst({
    where,
    select: { id: true },
  });

  if (!record) {
    throw new ApiError(message, 404);
  }

  return record;
}

// Whitelist of allowed (tableName, field) pairs for nextNumber().
// All values are hardcoded in source — never derived from user input.
const ALLOWED_NUMBER_TARGETS = new Map<string, string>([
  ['ARPayment',       'number'],
  ['APPayment',       'number'],
  ['Bill',            'number'],
  ['CreditNote',      'number'],
  ['DebitNote',       'number'],
  ['Employee',        'employeeNo'],
  ['PurchaseOrder',   'number'],
  ['PurchaseReturn',  'number'],
  ['SalesReturn',     'number'],
  ['StockAdjustment', 'number'],
]);

/**
 * Sequential number generator using Postgres advisory lock.
 * Safe for concurrent requests — only one transaction increments at a time.
 *
 * @param prisma    - Prisma client instance (or transaction)
 * @param tableName - Prisma model name — must be in ALLOWED_NUMBER_TARGETS
 * @param field     - The column holding the number string — must match whitelist
 * @param prefix    - Number prefix (e.g. 'BILL', 'PO', 'ARP', 'APP', 'EMP')
 */
export async function nextNumber(
  prisma: any,
  tableName: string,
  field: string,
  prefix: string
): Promise<string> {
  const allowedField = ALLOWED_NUMBER_TARGETS.get(tableName);
  if (!allowedField || allowedField !== field) {
    throw new Error(`nextNumber: disallowed target "${tableName}"."${field}"`);
  }

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

export function withHandler<TContext = unknown>(
  handler: (req: NextRequest, ctx: TContext) => Promise<NextResponse>,
) {
  return async (req: NextRequest, ctx: TContext) => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      if (error instanceof ApiError || error instanceof AccessError) {
        return err(error.message, error.status);
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') return err('Duplicate record', 409);
        if (error.code === 'P2025') return err('Record not found', 404);
      }

      const message = error instanceof Error ? error.message : 'Internal error';
      return err(message, 500);
    }
  };
}

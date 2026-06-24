import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { withCors } from '@/lib/cors';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { AccessError } from '@/lib/document-access';
import { CreditLimitError } from '@/lib/credit-limit';
import { ApiError } from '@/lib/errors';

// Re-exported so existing `import { ApiError } from '@/lib/api-utils'` keeps working.
export { ApiError };

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

type AuditOpts = {
  orgId: string;
  actorId?: string | null;
  entityType: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'VOID' | 'RESET_PASSWORD' | 'CHANGE_PASSWORD';
  payload?: unknown;
};

function buildAuditData(opts: AuditOpts) {
  let payload: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined;
  try {
    payload = normalizeAuditPayload(opts.payload);
  } catch (error) {
    console.error('[AuditLog] Failed to serialize payload:', error);
    payload = undefined;
  }
  return {
    organizationId: opts.orgId,
    actorId: opts.actorId ?? null,
    entityType: opts.entityType,
    entityId: opts.entityId,
    action: opts.action,
    payload,
  };
}

/**
 * Fire-and-forget audit log writer.
 * Call after successful create/update/delete operations.
 * Failures are logged but never bubble up to the caller.
 */
export function logAudit(opts: AuditOpts): void {
  defaultPrisma.auditLog.create({ data: buildAuditData(opts) }).catch((e) => {
    console.error('[AuditLog] Failed to write:', e);
  });
}

/**
 * Transactional audit log writer — use inside `prisma.$transaction()`.
 * The audit row is committed atomically with the business operation,
 * guaranteeing the audit trail is never missing for critical mutations.
 */
export function logAuditTx(
  tx: Prisma.TransactionClient,
  opts: AuditOpts,
) {
  return tx.auditLog.create({ data: buildAuditData(opts) });
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

/**
 * FNV-1a 32-bit hash for advisory lock IDs.
 * Much better distribution than naive char-code sum — reduces lock collisions.
 */
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash || 1;
}

// Each entry maps to a hardcoded raw SQL query to eliminate any SQL injection risk.
const NUMBER_QUERIES: Record<string, (prisma: any) => Promise<Array<{ max: number | null }>>> = {
  ARPayment:      (p) => p.$queryRaw`SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max FROM "ARPayment"`,
  APPayment:      (p) => p.$queryRaw`SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max FROM "APPayment"`,
  Bill:           (p) => p.$queryRaw`SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max FROM "Bill"`,
  CreditNote:     (p) => p.$queryRaw`SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max FROM "CreditNote"`,
  DebitNote:      (p) => p.$queryRaw`SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max FROM "DebitNote"`,
  DeliveryNote:   (p) => p.$queryRaw`SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max FROM "DeliveryNote"`,
  Employee:       (p) => p.$queryRaw`SELECT MAX(CAST(SUBSTRING("employeeNo" FROM '[0-9]+') AS INTEGER)) AS max FROM "Employee"`,
  PurchaseOrder:  (p) => p.$queryRaw`SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max FROM "PurchaseOrder"`,
  PurchaseReturn: (p) => p.$queryRaw`SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max FROM "PurchaseReturn"`,
  SalesReturn:    (p) => p.$queryRaw`SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max FROM "SalesReturn"`,
  StockAdjustment:(p) => p.$queryRaw`SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max FROM "StockAdjustment"`,
  StockCount:     (p) => p.$queryRaw`SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max FROM "StockCount"`,
  PayrollRun:     (p) => p.$queryRaw`SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max FROM "PayrollRun"`,
  JournalEntry:   (p) => p.$queryRaw`SELECT MAX(CAST(SUBSTRING("entryNo" FROM '[0-9]+') AS INTEGER)) AS max FROM "JournalEntry"`,
};

/**
 * Sequential number generator using Postgres advisory lock.
 * Safe for concurrent requests — only one transaction increments at a time.
 *
 * All SQL is fully hardcoded per table — no string interpolation.
 *
 * @param prisma    - Prisma client instance (or transaction)
 * @param tableName - Prisma model name — must have a hardcoded query in NUMBER_QUERIES
 * @param field     - Unused (kept for API compat) — the field is baked into each query
 * @param prefix    - Number prefix (e.g. 'BILL', 'PO', 'ARP', 'APP', 'EMP')
 */
export async function nextNumber(
  prisma: any,
  tableName: string,
  field: string,
  prefix: string
): Promise<string> {
  const queryFn = NUMBER_QUERIES[tableName];
  if (!queryFn) {
    throw new Error(`nextNumber: disallowed target "${tableName}"`);
  }

  const lockId = fnv1aHash(`next-number:${tableName}`);
  await prisma.$executeRaw`SELECT pg_advisory_xact_lock(${lockId})`;
  const rows = await queryFn(prisma);
  const max: number = rows[0]?.max ?? 0;
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

/**
 * Extract and validate orgId from request headers.
 * Throws ApiError(401) if missing.
 */
export function requireOrg(req: NextRequest): string {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) throw new ApiError('Unauthenticated', 401);
  return orgId;
}

/**
 * Extract and validate both orgId and userId from request headers.
 * Throws ApiError(401) if either is missing.
 */
export function requireAuth(req: NextRequest): { orgId: string; userId: string } {
  const orgId = req.headers.get('x-org-id');
  const userId = req.headers.get('x-user-id');
  if (!orgId || !userId) throw new ApiError('Unauthenticated', 401);
  return { orgId, userId };
}

/**
 * Centralized error-handling wrapper for API route handlers.
 * Catches ApiError, AccessError, CreditLimitError, and Prisma errors.
 */
export function withHandler<TContext = unknown>(
  handler: (req: NextRequest, ctx: TContext) => Promise<NextResponse>,
): {
  (req: NextRequest): Promise<NextResponse>;
  (req: NextRequest, ctx: TContext): Promise<NextResponse>;
} {
  return (async (req: NextRequest, ctx?: TContext) => {
    try {
      return await handler(req, ctx as TContext);
    } catch (error) {
      if (
        error instanceof ApiError ||
        error instanceof AccessError ||
        error instanceof CreditLimitError
      ) {
        return err(error.message, error.status);
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') return err('Duplicate record', 409);
        if (error.code === 'P2025') return err('Record not found', 404);
      }

      const message = error instanceof Error ? error.message : 'Internal error';
      return err(message, 500);
    }
  }) as {
    (req: NextRequest): Promise<NextResponse>;
    (req: NextRequest, ctx: TContext): Promise<NextResponse>;
  };
}

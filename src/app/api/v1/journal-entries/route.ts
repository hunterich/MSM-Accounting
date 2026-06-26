import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { syncAccountPostingFlags } from '@/lib/account-postings';
import {
  createJournalEntryInputSchema,
  createJournalEntryResponseSchema,
} from '@/types/api';
import { corsPreflightResponse } from '@/lib/cors';
import { withPermission } from '@/lib/authz';
import { assertPeriodOpen } from '@/lib/period-guard';
import {
  ok,
  err,
  logAudit,
  withHandler,
  requireOrg,
  requireAuth,
  parsePaginationParams,
  listResponse,
  ApiError,
} from '@/lib/api-utils';

export const runtime = 'nodejs';

const JOURNAL_PREFIX = 'JE';
const JOURNAL_DIGITS = 6;
const JOURNAL_REGEX_SOURCE = '^JE-(\\d+)$';

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asMoney = (value: number): number => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

const parseIsoDate = (value: string): Date => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(`Invalid date: ${value}`, 400);
  }
  return date;
};

// FNV-1a 32-bit hash — significantly better distribution than the naive * 31 approach,
// reducing advisory lock collisions across organizations.
const hashLockKey = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash || 1;
};

const getCurrentJournalSequence = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<number> => {
  const rows = await tx.$queryRaw<Array<{ max_seq: number | null }>>`
    SELECT MAX(CAST(SUBSTRING("entryNo" FROM ${JOURNAL_REGEX_SOURCE}) AS INTEGER)) AS max_seq
    FROM "JournalEntry"
    WHERE "organizationId" = ${organizationId}
      AND "entryNo" LIKE ${`${JOURNAL_PREFIX}-%`}
  `;

  return Number(rows[0]?.max_seq ?? 0);
};

const nextJournalNumber = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> => {
  const lockKey = hashLockKey(`journal-seq:${organizationId}`);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

  const nextSequence = (await getCurrentJournalSequence(tx, organizationId)) + 1;
  return `${JOURNAL_PREFIX}-${String(nextSequence).padStart(JOURNAL_DIGITS, '0')}`;
};

const normalizeLines = (payload: any) => {
  const lines = payload.lines.map((line: any, index: number) => ({
    lineNo: index + 1,
    accountId: line.accountId,
    description: line.description || null,
    debit: asMoney(toNumber(line.debit)),
    credit: asMoney(toNumber(line.credit)),
  }));

  const totalDebit = asMoney(lines.reduce((sum: number, line: { debit: number }) => sum + line.debit, 0));
  const totalCredit = asMoney(lines.reduce((sum: number, line: { credit: number }) => sum + line.credit, 0));

  return {
    lines,
    totalDebit,
    totalCredit,
  };
};

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async (req: NextRequest) => {
  const orgId = requireOrg(req);

  const { searchParams, page, limit } = parsePaginationParams(req);
  const status = searchParams.get('status');
  const where: any = { organizationId: orgId };
  if (status) where.status = status;
  const [data, total] = await Promise.all([
    prisma.journalEntry.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { date: 'desc' },
      include: {
        lines: {
          include: { account: { select: { code: true, name: true } } },
        },
      },
    }),
    prisma.journalEntry.count({ where }),
  ]);
  return listResponse(data, total, page, limit);
});

export const POST = withPermission({ module: 'GL_JOURNAL', action: 'create' }, async (request: NextRequest) => {
  const { orgId, userId } = requireAuth(request);

  const rawPayload = await request.json();
  if (rawPayload?.organizationId && rawPayload.organizationId !== orgId) {
    throw new ApiError('organizationId does not match current session', 403);
  }

  const parsedPayload = createJournalEntryInputSchema.safeParse({
    ...rawPayload,
    organizationId: orgId,
  });

  if (!parsedPayload.success) {
    return err('Invalid journal entry payload', 400);
  }

  const payload = parsedPayload.data;

  const createdEntry = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: { id: payload.organizationId },
      select: { id: true },
    });

    if (!organization) {
      throw new ApiError('Organization not found', 404);
    }

    const entryDate = parseIsoDate(payload.date);

    if (payload.periodId) {
      const period = await tx.accountingPeriod.findFirst({
        where: {
          id: payload.periodId,
          organizationId: payload.organizationId,
        },
        select: {
          id: true,
          status: true,
          isLocked: true,
          startDate: true,
          endDate: true,
        },
      });

      if (!period) {
        throw new ApiError('Accounting period not found', 404);
      }

      // A supplied periodId must actually contain the entry date — otherwise the
      // date-based closed-period guard could be bypassed by tagging an OPEN period.
      if (entryDate < period.startDate || entryDate > period.endDate) {
        throw new ApiError('Accounting period does not match the entry date', 422);
      }

      if (period.status === 'CLOSED' || period.isLocked) {
        throw new ApiError('Accounting period is closed/locked', 422);
      }
    }

    // A POSTED entry writes to the ledger immediately, so resolve the period by
    // the entry DATE (not just an optional periodId) and refuse a closed/locked
    // one — mirroring the automatic posting paths (invoices/bills/payments).
    if (payload.status === 'POSTED') {
      await assertPeriodOpen(tx, payload.organizationId, entryDate);
    }

    const { lines, totalDebit, totalCredit } = normalizeLines(payload);

    if (totalDebit <= 0 || totalCredit <= 0) {
      throw new ApiError('Journal totals must be greater than zero', 422);
    }

    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
      throw new ApiError(
        `Unbalanced journal entry. totalDebit=${totalDebit} totalCredit=${totalCredit}`,
        422,
      );
    }

    const accountIds: string[] = Array.from(new Set(lines.map((line: any) => line.accountId as string)));
    const accounts = await tx.account.findMany({
      where: {
        organizationId: payload.organizationId,
        id: { in: accountIds },
        isPostable: true,
        isActive: true,
      },
      select: { id: true },
    });

    if (accounts.length !== accountIds.length) {
      throw new ApiError('One or more journal line accounts are invalid/inactive', 404);
    }

    const entryNo = await nextJournalNumber(tx, payload.organizationId);

    const entry = await tx.journalEntry.create({
      data: {
        organizationId: payload.organizationId,
        entryNo,
        date: entryDate,
        memo: payload.memo,
        source: payload.source,
        status: payload.status,
        periodId: payload.periodId || null,
        totalDebit,
        totalCredit,
        postedAt: payload.status === 'POSTED' ? new Date() : null,
        lines: {
          create: lines,
        },
      },
      select: {
        id: true,
        entryNo: true,
        totalDebit: true,
        totalCredit: true,
        status: true,
      },
    });

    await syncAccountPostingFlags(tx, payload.organizationId, accountIds);
    return entry;
  });

  const responsePayload = createJournalEntryResponseSchema.parse({
    id: createdEntry.id,
    entryNo: createdEntry.entryNo,
    totalDebit: toNumber(createdEntry.totalDebit),
    totalCredit: toNumber(createdEntry.totalCredit),
    status: createdEntry.status,
  });

  logAudit({ orgId, actorId: userId, entityType: 'JournalEntry', entityId: createdEntry.id, action: 'CREATE', payload: rawPayload });
  return ok(responsePayload, 201);
});

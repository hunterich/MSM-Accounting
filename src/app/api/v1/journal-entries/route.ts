// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  createJournalEntryInputSchema,
  createJournalEntryResponseSchema,
} from '@/types/api';
import { corsPreflightResponse } from '@/lib/cors';
import { listResponse, logAudit } from '@/lib/api-utils';
import { syncAccountPostingFlags } from '@/lib/account-postings';

export const runtime = 'nodejs';

const JOURNAL_PREFIX = 'JE';
const JOURNAL_DIGITS = 6;
const JOURNAL_REGEX_SOURCE = '^JE-(\\d+)$';

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

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

const hashLockKey = (input: string): number => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
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
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

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

  const totalDebit = asMoney(lines.reduce((sum, line) => sum + line.debit, 0));
  const totalCredit = asMoney(lines.reduce((sum, line) => sum + line.credit, 0));

  return {
    lines,
    totalDebit,
    totalCredit,
  };
};

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) {
    return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page') ?? 1));
  const limit = Math.min(100, Number(searchParams.get('limit') ?? 20));
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
}

export async function POST(request: NextRequest) {
  try {
    const orgId = request.headers.get('x-org-id');
    if (!orgId) {
      return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });
    }

    const rawPayload = await request.json();
    if (rawPayload?.organizationId && rawPayload.organizationId !== orgId) {
      return NextResponse.json(
        { message: 'organizationId does not match current session' },
        { status: 403 },
      );
    }

    const parsedPayload = createJournalEntryInputSchema.safeParse({
      ...rawPayload,
      organizationId: orgId,
    });

    if (!parsedPayload.success) {
      return NextResponse.json(
        {
          message: 'Invalid journal entry payload',
          issues: parsedPayload.error.issues,
        },
        { status: 400 },
      );
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
          },
        });

        if (!period) {
          throw new ApiError('Accounting period not found', 404);
        }

        if (period.status === 'CLOSED' || period.isLocked) {
          throw new ApiError('Accounting period is closed/locked', 422);
        }
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

      const accountIds = Array.from(new Set(lines.map((line) => line.accountId)));
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
          date: parseIsoDate(payload.date),
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

    logAudit({ orgId: orgId!, actorId: request.headers.get('x-user-id'), entityType: 'JournalEntry', entityId: createdEntry.id, action: 'CREATE', payload: rawPayload });
    return NextResponse.json(responsePayload, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return NextResponse.json(
          { message: 'Journal number collision detected. Please retry.' },
          { status: 409 },
        );
      }
    }

    const message = error instanceof Error ? error.message : 'Failed to create journal entry';
    return NextResponse.json({ message }, { status: 500 });
  }
}

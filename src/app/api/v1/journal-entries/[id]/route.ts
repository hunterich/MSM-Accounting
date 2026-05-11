import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit } from '@/lib/api-utils';
import { createJournalEntryInputSchema } from '@/types/api';
import { syncAccountPostingFlags } from '@/lib/account-postings';

const ZERO = new Prisma.Decimal(0);
const TOLERANCE = new Prisma.Decimal('0.005');

function toDecimal(value: unknown): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  if (value === null || value === undefined || value === '') return ZERO;
  try {
    const d = new Prisma.Decimal(value as Prisma.Decimal.Value);
    return d.isFinite() ? d : ZERO;
  } catch {
    return ZERO;
  }
}

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const entry = await prisma.journalEntry.findFirst({
    where: { id, organizationId: orgId },
    include: {
      lines: { include: { account: { select: { code: true, name: true } } } },
    },
  });
  if (!entry) return err('Not found', 404);
  return ok(entry);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const body = await req.json();
  // Only allow editing DRAFT entries — scope check to org
  const existing = await prisma.journalEntry.findFirst({
    where: { id, organizationId: orgId },
    include: { lines: { select: { accountId: true } } },
  });
  if (!existing) return err('Not found', 404);
  if (existing.status !== 'DRAFT') return err('Only DRAFT entries can be edited', 400);

  const parsedPayload = createJournalEntryInputSchema.safeParse({
    ...body,
    organizationId: orgId,
  });
  if (!parsedPayload.success) {
    return err(parsedPayload.error.issues[0]?.message || 'Invalid journal entry payload', 400);
  }

  const payload = parsedPayload.data;
  const lines = payload.lines.map((line, index) => ({
    accountId: line.accountId,
    description: line.description || null,
    debit: toDecimal(line.debit),
    credit: toDecimal(line.credit),
    lineNo: index + 1,
  }));
  const totalDebit = lines.reduce<Prisma.Decimal>((sum, line) => sum.plus(line.debit), ZERO);
  const totalCredit = lines.reduce<Prisma.Decimal>((sum, line) => sum.plus(line.credit), ZERO);
  if (totalDebit.lte(0) || totalCredit.lte(0)) {
    return err('Journal totals must be greater than zero', 422);
  }
  if (totalDebit.minus(totalCredit).abs().gt(TOLERANCE)) {
    return err(`Unbalanced journal entry. totalDebit=${totalDebit.toString()} totalCredit=${totalCredit.toString()}`, 422);
  }

  const accountIds = Array.from(new Set(lines.map((line) => line.accountId)));
  const accounts = await prisma.account.findMany({
    where: {
      organizationId: orgId,
      id: { in: accountIds },
      isPostable: true,
      isActive: true,
    },
    select: { id: true },
  });
  if (accounts.length !== accountIds.length) {
    return err('One or more journal line accounts are invalid/inactive', 404);
  }

  const touchedAccountIds = Array.from(new Set([
    ...existing.lines.map((line) => line.accountId),
    ...accountIds,
  ]));

  const updated = await prisma.$transaction(async (tx) => {
    await tx.journalEntry.update({
      where: { id, organizationId: orgId },
      data: {
        date: new Date(payload.date),
        memo: payload.memo,
        source: payload.source,
        status: payload.status,
        periodId: payload.periodId || null,
        totalDebit,
        totalCredit,
        postedAt: payload.status === 'POSTED' ? new Date() : null,
        updatedAt: new Date(),
      },
    });
    await tx.journalLine.deleteMany({ where: { entryId: id } });
    await tx.journalLine.createMany({
      data: lines.map((line) => ({
        ...line,
        entryId: id,
      })),
    });
    await syncAccountPostingFlags(tx, orgId, touchedAccountIds);
    return tx.journalEntry.findFirst({
      where: { id, organizationId: orgId },
      include: { lines: { include: { account: { select: { code: true, name: true } } } } },
    });
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'JournalEntry', entityId: id, action: 'UPDATE', payload: body });
  return ok(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  const existing = await prisma.journalEntry.findFirst({
    where: { id, organizationId: orgId },
    include: { lines: { select: { accountId: true } } },
  });
  if (!existing) return err('Not found', 404);
  if (existing.status !== 'DRAFT') return err('Only DRAFT entries can be deleted', 400);
  await prisma.$transaction(async (tx) => {
    await tx.journalEntry.delete({ where: { id, organizationId: orgId } });
    await syncAccountPostingFlags(tx, orgId, existing.lines.map((line) => line.accountId));
  });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'JournalEntry', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
}

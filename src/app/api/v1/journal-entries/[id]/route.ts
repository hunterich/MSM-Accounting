import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit } from '@/lib/api-utils';
import { createJournalEntryInputSchema } from '@/types/api';
import { syncAccountPostingFlags } from '@/lib/account-postings';

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
    debit: Number(line.debit) || 0,
    credit: Number(line.credit) || 0,
    lineNo: index + 1,
  }));
  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
  if (totalDebit <= 0 || totalCredit <= 0) {
    return err('Journal totals must be greater than zero', 422);
  }
  if (Math.abs(totalDebit - totalCredit) > 0.0001) {
    return err(`Unbalanced journal entry. totalDebit=${totalDebit} totalCredit=${totalCredit}`, 422);
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

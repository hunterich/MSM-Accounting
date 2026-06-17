// GET /api/v1/bills/[id]/journal
// Returns the GL journal entry posted for a bill (Accurate's "Rincian Jurnal").
// Bills don't store a journalEntryId FK, so we resolve by the deterministic memo
// `Bill: <number>` (org-scoped, system-posted). Works for existing bills too.
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, requireOrg, withHandler } from '@/lib/api-utils';
import { toNumber } from '@/lib/money';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const orgId = requireOrg(req);
  const { id } = await ctx.params;

  const bill = await prisma.bill.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, number: true },
  });
  if (!bill) return err('Bill not found', 404);

  const entry = await prisma.journalEntry.findFirst({
    where: { organizationId: orgId, memo: `Bill: ${bill.number}`, status: 'POSTED' },
    orderBy: { postedAt: 'desc' },
    include: {
      lines: {
        orderBy: { lineNo: 'asc' },
        include: { account: { select: { code: true, name: true } } },
      },
    },
  });
  if (!entry) return ok(null);

  return ok({
    id: entry.id,
    entryNo: entry.entryNo,
    date: entry.date,
    memo: entry.memo,
    status: entry.status,
    totalDebit: toNumber(entry.totalDebit),
    totalCredit: toNumber(entry.totalCredit),
    lines: entry.lines.map((l) => ({
      lineNo: l.lineNo,
      accountCode: l.account?.code ?? '',
      accountName: l.account?.name ?? '',
      description: l.description ?? '',
      debit: toNumber(l.debit),
      credit: toNumber(l.credit),
    })),
  });
});

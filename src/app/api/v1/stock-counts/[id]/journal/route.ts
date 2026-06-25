// GET /api/v1/stock-counts/[id]/journal
// Returns the GL journal entry posted for a stock count's generated adjustment.
// The JE is resolved by memo `Stock adjustment: <number>` (org-scoped, system-posted).
// count → generatedAdjustmentId → StockAdjustment.number → JournalEntry by memo.
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

  const count = await prisma.stockCount.findFirst({
    where: { id, organizationId: orgId },
    select: { generatedAdjustmentId: true },
  });
  if (!count) return err('Stock count not found', 404);
  if (!count.generatedAdjustmentId) return ok(null); // not posted, or posted with no variance

  const adj = await prisma.stockAdjustment.findFirst({
    where: { id: count.generatedAdjustmentId, organizationId: orgId },
    select: { number: true, status: true },
  });
  if (!adj) return ok(null);
  // A voided adjustment's variance JE has been reversed (append-only storno), so
  // there is no live posted journal — don't resolve the superseded entry by memo.
  if (adj.status === 'VOID') return ok(null);

  const entry = await prisma.journalEntry.findFirst({
    where: { organizationId: orgId, memo: `Stock adjustment: ${adj.number}`, status: 'POSTED' },
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

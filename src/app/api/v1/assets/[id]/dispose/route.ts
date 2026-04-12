import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok, requireOrg, withHandler } from '@/lib/api-utils';
import { assetDisposalInputSchema } from '@/types/api';
import { calculateDisposalGainLoss } from '@/lib/depreciation';
import { toNumber, asMoney } from '@/lib/money';
import { resolveAccountDefaultId } from '@/lib/account-defaults';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

/** Find account by keyword search on name field */
function findAccountByKeyword(accounts: any[], keywords: string[], type?: string): string | null {
  for (const kw of keywords) {
    const match = accounts.find((a: any) =>
      a.name?.toLowerCase().includes(kw.toLowerCase()) &&
      (!type || a.type === type) &&
      a.isPostable !== false,
    );
    if (match) return match.id;
  }
  return null;
}

export const POST = withHandler(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const orgId = requireOrg(req);
  const { id } = await params;
  const body = await req.json();
  const parsed = assetDisposalInputSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid payload', 400);
  }

  const result = await prisma.$transaction(async (tx: any) => {
    const asset = await tx.asset.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: { category: true },
    });
    if (!asset) throw new ApiError('Asset not found', 404);
    if (asset.status !== 'ACTIVE' && asset.status !== 'FULLY_DEPRECIATED') {
      throw new ApiError('Only ACTIVE or FULLY_DEPRECIATED assets can be disposed', 422);
    }

    const bookValue = toNumber(asset.bookValue);
    const disposalAmount = parsed.data.disposalAmount;
    const { gainLoss, isGain } = calculateDisposalGainLoss(bookValue, disposalAmount);

    // Resolve account IDs for journal entry
    const accounts = await tx.account.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
    });

    const cashAccountId = resolveAccountDefaultId(accounts, undefined, 'bankAsset');
    const accumDepAccountId = asset.category?.accumDepAccountId
      || findAccountByKeyword(accounts, ['akumulasi penyusutan', 'accumulated depreciation', 'akum. penyusutan'], 'Asset');
    const assetAccountId = asset.category?.assetAccountId
      || findAccountByKeyword(accounts, ['aset tetap', 'fixed asset', 'peralatan', 'equipment'], 'Asset');
    const gainLossAccountId = isGain
      ? findAccountByKeyword(accounts, ['keuntungan pelepasan', 'gain on disposal', 'pendapatan lain'], 'Revenue')
      : findAccountByKeyword(accounts, ['kerugian pelepasan', 'loss on disposal', 'beban lain'], 'Expense');

    const acquisitionCost = toNumber(asset.acquisitionCost);
    const accumulatedDep = toNumber(asset.accumulatedDepreciation);

    // Create journal entry for disposal
    let journalEntryId: string | null = null;

    if (cashAccountId && assetAccountId) {
      const entryRows = await tx.$queryRaw`
        SELECT MAX(CAST(SUBSTRING("entryNo" FROM '^JE-([0-9]+)$') AS INTEGER)) AS max_seq
        FROM "JournalEntry"
        WHERE "organizationId" = ${orgId}
          AND "entryNo" LIKE ${'JE-%'}
      `;
      const nextSeq = (Number((entryRows as any)[0]?.max_seq ?? 0)) + 1;
      const entryNo = `JE-${String(nextSeq).padStart(6, '0')}`;

      const lines: any[] = [];
      let lineNo = 1;

      // Debit: Cash/Bank for disposal proceeds
      if (disposalAmount > 0) {
        lines.push({
          lineNo: lineNo++,
          accountId: cashAccountId,
          description: `Disposal proceeds - ${asset.assetNo}`,
          debit: asMoney(disposalAmount),
          credit: 0,
        });
      }

      // Debit: Accumulated Depreciation (clear it out)
      if (accumulatedDep > 0 && accumDepAccountId) {
        lines.push({
          lineNo: lineNo++,
          accountId: accumDepAccountId,
          description: `Clear accum. dep. - ${asset.assetNo}`,
          debit: asMoney(accumulatedDep),
          credit: 0,
        });
      }

      // Credit: Asset account (remove asset at cost)
      lines.push({
        lineNo: lineNo++,
        accountId: assetAccountId,
        description: `Remove asset - ${asset.assetNo}`,
        debit: 0,
        credit: asMoney(acquisitionCost),
      });

      // Gain or loss
      if (Math.abs(gainLoss) > 0.005 && gainLossAccountId) {
        if (isGain) {
          lines.push({
            lineNo: lineNo++,
            accountId: gainLossAccountId,
            description: `Gain on disposal - ${asset.assetNo}`,
            debit: 0,
            credit: asMoney(Math.abs(gainLoss)),
          });
        } else {
          lines.push({
            lineNo: lineNo++,
            accountId: gainLossAccountId,
            description: `Loss on disposal - ${asset.assetNo}`,
            debit: asMoney(Math.abs(gainLoss)),
            credit: 0,
          });
        }
      }

      const totalDebit = asMoney(lines.reduce((s: number, l: any) => s + l.debit, 0));
      const totalCredit = asMoney(lines.reduce((s: number, l: any) => s + l.credit, 0));

      const je = await tx.journalEntry.create({
        data: {
          organizationId: orgId,
          entryNo,
          date: new Date(parsed.data.disposalDate),
          memo: `Asset disposal: ${asset.assetNo} - ${asset.name}`,
          source: 'SYSTEM',
          status: 'POSTED',
          postedAt: new Date(),
          totalDebit,
          totalCredit,
          lines: { create: lines },
        },
      });
      journalEntryId = je.id;
    }

    const updated = await tx.asset.update({
      where: { id },
      data: {
        status: 'DISPOSED',
        disposalDate: new Date(parsed.data.disposalDate),
        disposalAmount: parsed.data.disposalAmount,
        disposalMethod: parsed.data.disposalMethod,
        disposalNotes: parsed.data.notes,
        disposalGainLoss: gainLoss,
      },
      include: { category: { select: { id: true, name: true } } },
    });

    return { asset: updated, gainLoss, isGain, journalEntryId };
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Asset',
    entityId: id,
    action: 'UPDATE',
    payload: { action: 'dispose', ...parsed.data },
  });

  return ok(result);
});

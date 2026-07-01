import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, nextNumber, ok, requireOrg } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { assetDisposalInputSchema } from '@/types/api';
import { calculateDisposalGainLoss } from '@/lib/depreciation';
import { toNumber, asMoney } from '@/lib/money';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from '@/lib/account-defaults';
import { assertPeriodOpen } from '@/lib/period-guard';

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

export const POST = withPermission({ module: 'GL_JOURNAL', action: 'create' }, async function POST(
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

    // Refuse to post the disposal gain/loss into a closed/locked period.
    await assertPeriodOpen(tx, orgId, new Date(parsed.data.disposalDate));

    // Atomically claim DISPOSED before building/posting the disposal JE. The
    // guarded updateMany takes a row lock; a concurrent dispose blocks here,
    // then sees the row already DISPOSED → count 0 → 409. This is the race
    // guard — it MUST run before the JE is created, or two concurrent disposes
    // both post a gain/loss JE (double GL). The remaining disposal fields are
    // written by the follow-up update below once gain/loss is computed.
    const claim = await tx.asset.updateMany({
      where: {
        id,
        organizationId: orgId,
        status: { in: ['ACTIVE', 'FULLY_DEPRECIATED'] },
        deletedAt: null,
      },
      data: { status: 'DISPOSED' },
    });
    if (claim.count !== 1) throw new ApiError('Asset already disposed', 409);

    const bookValue = toNumber(asset.bookValue);
    const disposalAmount = parsed.data.disposalAmount;
    const { gainLoss, isGain } = calculateDisposalGainLoss(bookValue, disposalAmount);

    // Resolve account IDs for journal entry
    const accounts = await tx.account.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
    });

    const settings = await loadOrgAccountDefaults(tx, orgId);
    const cashAccountId = resolveAccountDefaultId(accounts, settings, 'bankAsset');
    // NOTE: `type` must match the Prisma `AccountType` enum, which is uppercase
    // (`ASSET` / `REVENUE` / `EXPENSE`). Filtering on capitalised 'Revenue' /
    // 'Expense' / 'Asset' never matched, so keyword-resolved gain/loss accounts
    // silently failed to resolve → the gain/loss line was dropped → the disposal
    // JE was unbalanced.
    const accumDepAccountId = asset.category?.accumDepAccountId
      || findAccountByKeyword(accounts, ['akumulasi penyusutan', 'accumulated depreciation', 'akum. penyusutan'], 'ASSET');
    const assetAccountId = asset.category?.assetAccountId
      || findAccountByKeyword(accounts, ['aset tetap', 'fixed asset', 'peralatan', 'equipment'], 'ASSET');
    const gainLossAccountId = isGain
      ? findAccountByKeyword(accounts, ['keuntungan pelepasan', 'gain on disposal', 'pendapatan lain'], 'REVENUE')
      : findAccountByKeyword(accounts, ['kerugian pelepasan', 'loss on disposal', 'beban lain'], 'EXPENSE');

    const acquisitionCost = toNumber(asset.acquisitionCost);
    const accumulatedDep = toNumber(asset.accumulatedDepreciation);

    // Required GL accounts for a balanced disposal entry. A missing account used
    // to silently skip the JE while still flipping the asset to DISPOSED, leaving
    // the asset register and the GL permanently divergent. Fail the disposal
    // instead so the whole transaction rolls back and the asset stays ACTIVE.
    if (!assetAccountId) {
      throw new ApiError('Cannot post disposal: no fixed-asset GL account configured for this asset/category', 422);
    }
    if (disposalAmount > 0 && !cashAccountId) {
      throw new ApiError('Cannot post disposal: no cash/bank GL account configured (bankAsset default)', 422);
    }
    if (accumulatedDep > 0 && !accumDepAccountId) {
      throw new ApiError('Cannot post disposal: no accumulated-depreciation GL account configured for this asset/category', 422);
    }
    if (Math.abs(gainLoss) > 0.005 && !gainLossAccountId) {
      throw new ApiError(`Cannot post disposal: no ${isGain ? 'gain' : 'loss'}-on-disposal GL account configured`, 422);
    }

    // Create journal entry for disposal
    let journalEntryId: string | null = null;

    {
      // Use the advisory-locked sequence generator (same as every other JE
      // path) so concurrent JE inserts can't collide on entryNo.
      const entryNo = await nextNumber(tx, 'JournalEntry', 'entryNo', 'JE');

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

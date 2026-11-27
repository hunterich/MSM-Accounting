import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok, requireOrg } from '@/lib/api-utils';
import { postJournalEntry, type JournalLineInput } from '@/lib/journal-posting';
import { withPermission, canOverrideTransactionDate } from '@/lib/authz';
import { assetDisposalInputSchema } from '@/types/api';
import { roundMoneyDecimal } from '@/lib/money-decimal';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from '@/lib/account-defaults';
import { assertPeriodOpen } from '@/lib/period-guard';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

type AccountRow = { id: string; code: string; name: string; type: string; isActive: boolean; isPostable: boolean };

/**
 * Dispose of a fixed asset: remove it at cost, clear its accumulated
 * depreciation, record any proceeds and post the gain or loss.
 *
 * Accounts are never guessed from account names any more (SEC-04, the same
 * rule #232 applied to depreciation). The asset and accumulated-depreciation
 * accounts come from the asset's category; the gain/loss accounts are the
 * company's "Gain/Loss on Asset Disposal" account defaults (standard chart
 * 4-9300 / 5-9100, or the account chosen in Settings). Proceeds go to the
 * Bank / Cash default. Anything missing refuses the whole disposal and names
 * what to fix; nothing is posted and the asset stays as it was.
 *
 * The journal is posted through `postJournalEntry`, which refuses to save it
 * unless debits equal credits, and the asset's stored book value must equal
 * cost less accumulated depreciation before anything is posted.
 */
export const POST = withPermission({ module: 'GL_JOURNAL', action: 'create' }, async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const orgId = requireOrg(req);

  // SETTINGS/edit doubles as the right to post outside the transaction-date
  // window: it is the right that edits the window, so it cannot be withheld here.
  const dateOverride = { overrideDateRestriction: await canOverrideTransactionDate(req) };
  const { id } = await params;
  const body = await req.json();
  const parsed = assetDisposalInputSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid payload', 400);
  }
  const disposalDate = new Date(parsed.data.disposalDate);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.asset.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: { status: true },
    });
    if (!existing) throw new ApiError('Asset not found', 404);
    if (existing.status !== 'ACTIVE' && existing.status !== 'FULLY_DEPRECIATED') {
      throw new ApiError('Only ACTIVE or FULLY_DEPRECIATED assets can be disposed', 422);
    }

    // Refuse to post the disposal gain/loss into a closed/locked period.
    await assertPeriodOpen(tx, orgId, disposalDate, dateOverride);

    // Atomically claim DISPOSED before building/posting the disposal JE. The
    // guarded updateMany takes a row lock; a concurrent dispose blocks here,
    // then sees the row already DISPOSED → count 0 → 409. This is the race
    // guard — it MUST run before the JE is created, or two concurrent disposes
    // both post a gain/loss JE (double GL). Any refusal below rolls the claim back.
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

    // Read the amounts only now, while the claim holds the row lock, so a
    // depreciation run cannot change them between this read and the posting.
    const asset = await tx.asset.findFirstOrThrow({
      where: { id, organizationId: orgId },
      include: { category: true },
    });

    const cost = roundMoneyDecimal(asset.acquisitionCost.toString());
    const accumulated = roundMoneyDecimal(asset.accumulatedDepreciation.toString());
    const storedBookValue = roundMoneyDecimal(asset.bookValue.toString());
    const bookValue = cost.minus(accumulated);
    if (!bookValue.eq(storedBookValue)) {
      throw new ApiError(
        `Cannot dispose ${asset.assetNo} ${asset.name}: its book value (${storedBookValue.toFixed(2)}) does not equal ` +
        `acquisition cost (${cost.toFixed(2)}) less accumulated depreciation (${accumulated.toFixed(2)}). ` +
        'Correct the asset record first. Nothing was posted.',
        422,
      );
    }
    const proceeds = roundMoneyDecimal(parsed.data.disposalAmount);
    const gainLoss = proceeds.minus(bookValue); // > 0 gain, < 0 loss
    const isGain = gainLoss.gte(0);

    // Resolve every account up front and refuse once, naming all problems.
    const accounts: AccountRow[] = await tx.account.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
    });
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const problems: string[] = [];
    const requireCategoryAsset = (accountId: string | null | undefined, label: string): string => {
      const account = accountId ? accountById.get(accountId) : undefined;
      if (!accountId) problems.push(`no ${label} account is set on the asset category`);
      else if (!account || account.type !== 'ASSET' || !account.isPostable) {
        problems.push(`the category's ${label} account is inactive, not postable or not an Asset account`);
      }
      return accountId ?? '';
    };

    const assetAccountId = requireCategoryAsset(asset.category?.assetAccountId, 'fixed-asset');
    const accumDepAccountId = accumulated.gt(0)
      ? requireCategoryAsset(asset.category?.accumDepAccountId, 'accumulated depreciation')
      : '';

    const settings = await loadOrgAccountDefaults(tx, orgId);
    const cashAccountId = proceeds.gt(0) ? resolveAccountDefaultId(accounts, settings, 'bankAsset') : '';
    if (proceeds.gt(0) && !cashAccountId) {
      problems.push('no Bank / Cash account default is available for the proceeds');
    }
    const gainLossKey = isGain ? 'assetDisposalGain' : 'assetDisposalLoss';
    const gainLossAccountId = gainLoss.isZero() ? '' : resolveAccountDefaultId(accounts, settings, gainLossKey);
    if (!gainLoss.isZero() && !gainLossAccountId) {
      problems.push(
        `no ${isGain ? 'Gain' : 'Loss'} on Asset Disposal account: add account ${isGain ? '4-9300' : '5-9100'} ` +
        `or choose one under Settings → Accounts`,
      );
    }

    if (problems.length > 0) {
      const category = asset.category?.name ? ` (category "${asset.category.name}")` : '';
      throw new ApiError(
        `Cannot dispose ${asset.assetNo} ${asset.name}${category}: ${problems.join('; ')}. Nothing was posted.`,
        422,
      );
    }

    const lines: JournalLineInput<string>[] = [];
    const push = (accountId: string, description: string, debit: string, credit: string) =>
      lines.push({ accountId, description, debit, credit });
    if (proceeds.gt(0)) push(cashAccountId, `Disposal proceeds - ${asset.assetNo}`, proceeds.toFixed(2), '0');
    if (accumulated.gt(0)) push(accumDepAccountId, `Clear accum. dep. - ${asset.assetNo}`, accumulated.toFixed(2), '0');
    if (cost.gt(0)) push(assetAccountId, `Remove asset - ${asset.assetNo}`, '0', cost.toFixed(2));
    if (gainLoss.gt(0)) push(gainLossAccountId, `Gain on disposal - ${asset.assetNo}`, '0', gainLoss.toFixed(2));
    if (gainLoss.lt(0)) push(gainLossAccountId, `Loss on disposal - ${asset.assetNo}`, gainLoss.abs().toFixed(2), '0');

    // postJournalEntry refuses an unbalanced entry, so the asset register and
    // the GL can no longer drift apart silently.
    const journalEntryId = lines.length > 0
      ? (await postJournalEntry(tx, {
          organizationId: orgId,
          date: disposalDate,
          memo: `Asset disposal: ${asset.assetNo} - ${asset.name}`,
          source: 'SYSTEM',
          lines,
        })).id
      : null;

    const updated = await tx.asset.update({
      where: { id },
      data: {
        status: 'DISPOSED',
        disposalDate,
        disposalAmount: parsed.data.disposalAmount,
        disposalMethod: parsed.data.disposalMethod,
        disposalNotes: parsed.data.notes,
        disposalGainLoss: gainLoss.toFixed(2),
      },
      include: { category: { select: { id: true, name: true } } },
    });

    return { asset: updated, gainLoss: gainLoss.toNumber(), isGain, journalEntryId };
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

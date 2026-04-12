import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, logAudit, ok, requireOrg, withHandler } from '@/lib/api-utils';
import { assetDepreciationRunInputSchema } from '@/types/api';
import { calculateMonthlyDepreciation } from '@/lib/depreciation';
import { toNumber, asMoney } from '@/lib/money';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = assetDepreciationRunInputSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid payload', 400);
  }

  const { month, year } = parsed.data;

  const results = await prisma.$transaction(async (tx: any) => {
    // Find all active assets that haven't been depreciated for this month
    const activeAssets = await tx.asset.findMany({
      where: {
        organizationId: orgId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      include: { category: true },
    });

    if (activeAssets.length === 0) {
      throw new ApiError('No active assets found to depreciate', 422);
    }

    // Check for already-processed assets this month
    const alreadyProcessed = await tx.assetDepreciation.findMany({
      where: {
        organizationId: orgId,
        month,
        year,
      },
      select: { assetId: true },
    });
    const processedIds = new Set(alreadyProcessed.map((d: any) => d.assetId));

    const assetsToProcess = activeAssets.filter((a: any) => !processedIds.has(a.id));
    if (assetsToProcess.length === 0) {
      throw new ApiError('All active assets have already been depreciated for this period', 422);
    }

    // Resolve accounts for journal entries
    const accounts = await tx.account.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
    });

    // Find depreciation accounts by keyword since there are no specific defaults
    const findAccount = (keywords: string[], type?: string): string | null => {
      for (const kw of keywords) {
        const match = accounts.find((a: any) =>
          a.name?.toLowerCase().includes(kw.toLowerCase()) &&
          (!type || a.type === type) &&
          a.isPostable !== false,
        );
        if (match) return match.id;
      }
      return null;
    };

    const defaultDepExpenseId = findAccount(['beban penyusutan', 'depreciation expense', 'penyusutan'], 'Expense');
    const defaultAccumDepId = findAccount(['akumulasi penyusutan', 'accumulated depreciation', 'akum. penyusutan'], 'Asset');

    const processedResults: any[] = [];

    for (const asset of assetsToProcess) {
      const acquisitionCost = toNumber(asset.acquisitionCost);
      const salvageValue = toNumber(asset.salvageValue);
      const accumulatedDep = toNumber(asset.accumulatedDepreciation);
      const usefulLifeMonths = asset.usefulLifeMonths;

      // Calculate months elapsed since acquisition
      const acqDate = new Date(asset.acquisitionDate);
      const monthsElapsed = (year - acqDate.getFullYear()) * 12 + (month - (acqDate.getMonth() + 1));

      const depAmount = calculateMonthlyDepreciation(
        asset.depreciationMethod,
        acquisitionCost,
        salvageValue,
        usefulLifeMonths,
        accumulatedDep,
        monthsElapsed,
      );

      if (depAmount <= 0) continue;

      const newAccumulated = asMoney(accumulatedDep + depAmount);
      const newBookValue = asMoney(acquisitionCost - newAccumulated);
      const depDate = new Date(year, month - 1, 28); // Use 28th of the month

      // Create journal entry
      let journalEntryId: string | null = null;
      const depExpenseAccountId = asset.category?.depExpenseAccountId || defaultDepExpenseId;
      const accumDepAccountId = asset.category?.accumDepAccountId || defaultAccumDepId;

      if (depExpenseAccountId && accumDepAccountId) {
        const entryRows = await tx.$queryRaw`
          SELECT MAX(CAST(SUBSTRING("entryNo" FROM '^JE-([0-9]+)$') AS INTEGER)) AS max_seq
          FROM "JournalEntry"
          WHERE "organizationId" = ${orgId}
            AND "entryNo" LIKE ${'JE-%'}
        `;
        const nextSeq = (Number((entryRows as any)[0]?.max_seq ?? 0)) + 1;
        const entryNo = `JE-${String(nextSeq).padStart(6, '0')}`;

        const je = await tx.journalEntry.create({
          data: {
            organizationId: orgId,
            entryNo,
            date: depDate,
            memo: `Depreciation ${month}/${year}: ${asset.assetNo} - ${asset.name}`,
            source: 'SYSTEM',
            status: 'POSTED',
            postedAt: new Date(),
            totalDebit: asMoney(depAmount),
            totalCredit: asMoney(depAmount),
            lines: {
              create: [
                {
                  lineNo: 1,
                  accountId: depExpenseAccountId,
                  description: `Depreciation expense - ${asset.assetNo}`,
                  debit: asMoney(depAmount),
                  credit: 0,
                },
                {
                  lineNo: 2,
                  accountId: accumDepAccountId,
                  description: `Accum. depreciation - ${asset.assetNo}`,
                  debit: 0,
                  credit: asMoney(depAmount),
                },
              ],
            },
          },
        });
        journalEntryId = je.id;
      }

      // Create depreciation record
      await tx.assetDepreciation.create({
        data: {
          organizationId: orgId,
          assetId: asset.id,
          date: depDate,
          month,
          year,
          amount: depAmount,
          accumulatedTotal: newAccumulated,
          bookValue: newBookValue,
          journalEntryId,
        },
      });

      // Update asset
      const newStatus = newBookValue <= salvageValue ? 'FULLY_DEPRECIATED' : 'ACTIVE';
      await tx.asset.update({
        where: { id: asset.id },
        data: {
          accumulatedDepreciation: newAccumulated,
          bookValue: newBookValue,
          lastDepreciationDate: depDate,
          status: newStatus,
        },
      });

      processedResults.push({
        assetId: asset.id,
        assetNo: asset.assetNo,
        name: asset.name,
        depreciationAmount: depAmount,
        newAccumulated,
        newBookValue,
        status: newStatus,
        journalEntryId,
      });
    }

    if (processedResults.length === 0) {
      throw new ApiError('No depreciation to record — all assets may be fully depreciated', 422);
    }

    return processedResults;
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'AssetDepreciation',
    entityId: `${year}-${month}`,
    action: 'CREATE',
    payload: { month, year, assetsProcessed: results.length },
  });

  return ok({
    month,
    year,
    assetsProcessed: results.length,
    totalDepreciation: asMoney(results.reduce((s: number, r: any) => s + r.depreciationAmount, 0)),
    results,
  });
});

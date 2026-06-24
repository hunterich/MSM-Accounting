import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, requireOrg, withHandler, logAudit, ApiError } from '@/lib/api-utils';
import { asMoney, toNumber } from '@/lib/money';
import { postJournalEntry } from '@/lib/journal-posting';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from '@/lib/account-defaults';
import { assertPeriodOpen } from '@/lib/period-guard';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();

  const { newMethod, effectiveDate } = body;

  if (!newMethod || !['FIFO', 'WEIGHTED_AVERAGE'].includes(newMethod)) {
    return err('newMethod must be FIFO or WEIGHTED_AVERAGE', 400);
  }

  if (!effectiveDate) {
    return err('effectiveDate is required', 400);
  }

  // Validate org currently has a different costing method
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { costingMethod: true },
  });

  if (!org) throw new ApiError('Organization not found', 404);
  if (!org.costingMethod) throw new ApiError('Organization has no costing method set', 422);
  if (org.costingMethod === newMethod) {
    return err(`Organization is already using ${newMethod}`, 422);
  }

  const oldMethod = org.costingMethod;
  const effectiveDateObj = new Date(effectiveDate);

  const result = await prisma.$transaction(async (tx) => {
    // Get all inventory items with stock
    const items = await tx.item.findMany({
      where: {
        organizationId: orgId,
        type: { in: ['PRODUCT', 'RAW_MATERIAL'] },
      },
      select: { id: true, name: true, sku: true },
    });

    let itemsRecalculated = 0;
    let totalOldValue = 0;
    let totalNewValue = 0;

    for (const item of items) {
      // Get all open lots for this item
      const lots = await (tx as any).inventoryLot.findMany({
        where: {
          organizationId: orgId,
          itemId: item.id,
          qtyBalance: { gt: 0 },
        },
        orderBy: { date: 'asc' },
      });

      if (lots.length === 0) continue;

      const oldValue = lots.reduce(
        (sum: number, lot: any) => sum + toNumber(lot.qtyBalance) * toNumber(lot.unitCost),
        0,
      );
      totalOldValue += oldValue;

      if (newMethod === 'WEIGHTED_AVERAGE') {
        // FIFO -> WA: collapse all open lots into a single lot with weighted average cost
        const totalQty = lots.reduce((sum: number, lot: any) => sum + toNumber(lot.qtyBalance), 0);
        const totalCost = lots.reduce(
          (sum: number, lot: any) => sum + toNumber(lot.qtyBalance) * toNumber(lot.unitCost),
          0,
        );

        if (totalQty > 0) {
          const waCost = asMoney(totalCost / totalQty);

          // Delete old lots
          await (tx as any).inventoryLot.deleteMany({
            where: {
              organizationId: orgId,
              itemId: item.id,
              qtyBalance: { gt: 0 },
            },
          });

          // Create single consolidated lot
          await (tx as any).inventoryLot.create({
            data: {
              organizationId: orgId,
              itemId: item.id,
              warehouseId: lots[0].warehouseId,
              documentType: 'ADJUSTMENT',
              documentId: `COSTING-SWITCH-${effectiveDate}`,
              date: effectiveDateObj,
              qtyIn: totalQty,
              qtyOut: 0,
              qtyBalance: totalQty,
              unitCost: waCost,
            },
          });

          totalNewValue += totalQty * waCost;
          itemsRecalculated++;
        }
      } else {
        // WA -> FIFO: create a single lot per item with current WA cost
        const totalQty = lots.reduce((sum: number, lot: any) => sum + toNumber(lot.qtyBalance), 0);
        const totalCost = lots.reduce(
          (sum: number, lot: any) => sum + toNumber(lot.qtyBalance) * toNumber(lot.unitCost),
          0,
        );

        if (totalQty > 0) {
          const currentWACost = asMoney(totalCost / totalQty);

          // Delete old lots
          await (tx as any).inventoryLot.deleteMany({
            where: {
              organizationId: orgId,
              itemId: item.id,
              qtyBalance: { gt: 0 },
            },
          });

          // Create single FIFO lot at current WA cost
          await (tx as any).inventoryLot.create({
            data: {
              organizationId: orgId,
              itemId: item.id,
              warehouseId: lots[0].warehouseId,
              documentType: 'ADJUSTMENT',
              documentId: `COSTING-SWITCH-${effectiveDate}`,
              date: effectiveDateObj,
              qtyIn: totalQty,
              qtyOut: 0,
              qtyBalance: totalQty,
              unitCost: currentWACost,
            },
          });

          totalNewValue += totalQty * currentWACost;
          itemsRecalculated++;
        }
      }
    }

    // Net valuation delta caused by re-costing the open lots. A positive value
    // means the recalculated inventory is worth MORE than before (DR Inventory),
    // negative means it is worth LESS (CR Inventory). Only post when non-zero.
    const valueChange = asMoney(totalNewValue - totalOldValue);

    let journalEntryId: string | null = null;
    if (valueChange !== 0) {
      // Back-dated audit posting must respect a closed/locked period.
      await assertPeriodOpen(tx, orgId, effectiveDateObj);

      // Resolve REAL accounts the same way the other posting libs do — never
      // post to a literal/fake id (JournalLine.account is a Restrict FK, so a
      // bad id rolls back the whole switch).
      const accounts = await tx.account.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
      });
      const settings = await loadOrgAccountDefaults(tx, orgId);
      const inventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
      const varianceAccountId =
        resolveAccountDefaultId(accounts, settings, 'inventoryAdjustment') ||
        resolveAccountDefaultId(accounts, settings, 'cogsExpense');

      if (!inventoryAccountId) {
        throw new ApiError(
          'Cannot post costing adjustment: no Inventory asset account is configured for this organization',
          422,
        );
      }
      if (!varianceAccountId) {
        throw new ApiError(
          'Cannot post costing adjustment: no Inventory Variance (or COGS) account is configured for this organization',
          422,
        );
      }

      const amount = asMoney(Math.abs(valueChange));
      const memo = `Costing method changed from ${oldMethod} to ${newMethod} effective ${effectiveDate}`;
      const description = `Costing method change: ${oldMethod} to ${newMethod}`;

      const entry = await postJournalEntry(tx, {
        organizationId: orgId,
        date: effectiveDateObj,
        memo,
        source: 'SYSTEM',
        lines:
          valueChange > 0
            ? // Valuation INCREASE → DR Inventory / CR variance.
              [
                { accountId: inventoryAccountId, description, debit: amount, credit: 0 },
                { accountId: varianceAccountId, description, debit: 0, credit: amount },
              ]
            : // Valuation DECREASE → DR variance / CR Inventory.
              [
                { accountId: varianceAccountId, description, debit: amount, credit: 0 },
                { accountId: inventoryAccountId, description, debit: 0, credit: amount },
              ],
      });
      journalEntryId = entry.id;
    }

    // Update organization settings
    await tx.organization.update({
      where: { id: orgId },
      data: {
        costingMethod: newMethod as any,
        costingMethodSetAt: new Date(),
        costingMethodEffectiveDate: effectiveDateObj,
      },
    });

    return {
      itemsRecalculated,
      totalValueChange: valueChange,
      journalEntryId,
    };
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Organization',
    entityId: orgId,
    action: 'UPDATE',
    payload: { oldMethod, newMethod, effectiveDate, ...result },
  });

  return ok(result);
});

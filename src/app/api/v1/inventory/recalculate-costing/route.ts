import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, requireOrg, withHandler, logAudit, ApiError } from '@/lib/api-utils';
import { asMoney, toNumber } from '@/lib/money';

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

    // Create audit journal entry
    const entryRows = await tx.$queryRaw`
      SELECT MAX(CAST(SUBSTRING("entryNo" FROM '^JE-([0-9]+)$') AS INTEGER)) AS max_seq
      FROM "JournalEntry"
      WHERE "organizationId" = ${orgId}
        AND "entryNo" LIKE ${'JE-%'}
    `;
    const nextSeq = (Number((entryRows as any)[0]?.max_seq ?? 0)) + 1;
    const entryNo = `JE-${String(nextSeq).padStart(6, '0')}`;

    const valueChange = asMoney(totalNewValue - totalOldValue);

    const journalEntry = await tx.journalEntry.create({
      data: {
        organizationId: orgId,
        entryNo,
        date: effectiveDateObj,
        memo: `Costing method changed from ${oldMethod} to ${newMethod} effective ${effectiveDate}`,
        source: 'SYSTEM',
        status: 'POSTED',
        postedAt: new Date(),
        totalDebit: Math.abs(valueChange),
        totalCredit: Math.abs(valueChange),
        lines: {
          create: valueChange !== 0
            ? [
                {
                  lineNo: 1,
                  accountId: 'costing-adjustment',
                  description: `Costing method change: ${oldMethod} to ${newMethod}`,
                  debit: valueChange > 0 ? valueChange : 0,
                  credit: valueChange < 0 ? Math.abs(valueChange) : 0,
                },
                {
                  lineNo: 2,
                  accountId: 'inventory-valuation-adjustment',
                  description: `Costing method change: ${oldMethod} to ${newMethod}`,
                  debit: valueChange < 0 ? Math.abs(valueChange) : 0,
                  credit: valueChange > 0 ? valueChange : 0,
                },
              ]
            : [
                {
                  lineNo: 1,
                  accountId: 'costing-adjustment',
                  description: `Costing method change: ${oldMethod} to ${newMethod} (no value change)`,
                  debit: 0,
                  credit: 0,
                },
              ],
        },
      },
    });

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
      journalEntryId: journalEntry.id,
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

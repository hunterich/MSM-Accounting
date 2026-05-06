import { NextRequest } from 'next/server';
import { InventoryDocumentType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, err, ok, listResponse, nextNumber, logAudit, parsePaginationParams, validateForeignKey } from '@/lib/api-utils';
import { stockAdjustmentInputSchema } from '@/types/api';
import { resolveAccountDefaultId } from '@/lib/account-defaults';
import { postJournalEntry } from '@/lib/journal-posting';
import { asMoney, toNumber } from '@/lib/money';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const where: any = { organizationId: orgId };
  const [data, total] = await Promise.all([
    prisma.stockAdjustment.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { date: 'desc' },
      include: {
        lines: {
          include: { item: { select: { id: true, name: true, sku: true } } },
        },
      },
    }),
    prisma.stockAdjustment.count({ where }),
  ]);
  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = stockAdjustmentInputSchema.safeParse({
    ...body,
    organizationId: orgId,
  });
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid stock adjustment payload', 400);
  }
  const { lines, date, type, reason, notes, warehouseId, status } = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    if (warehouseId) {
      await validateForeignKey(tx.warehouse, { id: warehouseId, organizationId: orgId }, 'Warehouse not found in organization');
    }
    for (const line of lines) {
      await validateForeignKey(tx.item, { id: line.itemId, organizationId: orgId, isActive: true }, 'Item not found in organization');
    }

    const number = await nextNumber(tx, 'StockAdjustment', 'number', 'ADJ');
    const adj = await tx.stockAdjustment.create({
      data: {
        organizationId: orgId,
        number,
        date: new Date(date),
        type,
        reason,
        notes: notes ?? null,
        warehouseId: warehouseId ?? null,
        status,
      },
    });

    if (lines.length > 0) {
      await tx.stockAdjustmentLine.createMany({
        data: lines.map((l, idx: number) => ({
          stockAdjustmentId: adj.id,
          lineNo: l.lineNo ?? idx + 1,
          itemId: l.itemId,
          accountId: l.accountId ?? null,
          oldQty: l.oldQty,
          newQty: l.newQty,
          qtyDiff: l.qtyDiff ?? (Number(l.newQty) - Number(l.oldQty)),
          unitCost: l.unitCost,
          totalValue: l.totalValue ?? ((Number(l.newQty) - Number(l.oldQty)) * Number(l.unitCost)),
        })),
      });

      // Write the perpetual inventory ledger — currently no other route does
      // this. Without these rows, stock-on-hand reports drift.
      await tx.inventoryLedgerEntry.createMany({
        data: lines.map((l) => {
          const qtyDiff = toNumber(l.qtyDiff ?? Number(l.newQty) - Number(l.oldQty));
          const unitCost = toNumber(l.unitCost);
          return {
            organizationId: orgId,
            itemId: l.itemId,
            warehouseId: warehouseId ?? null,
            date: new Date(date),
            documentType: InventoryDocumentType.ADJUSTMENT,
            documentId: adj.id,
            qtyIn: qtyDiff > 0 ? qtyDiff : 0,
            qtyOut: qtyDiff < 0 ? -qtyDiff : 0,
            unitCost,
            valueChange: asMoney(qtyDiff * unitCost),
          };
        }),
      });

      // Net the value change across all lines and post one journal entry.
      // Lines that decrease stock (qtyDiff < 0) credit Inventory and debit
      // the variance expense; lines that increase stock do the reverse.
      // Mixed-sign batches post the net only — InventoryLedgerEntry rows
      // already capture per-line detail.
      const netValueChange = lines.reduce((sum, l) => {
        const qtyDiff = toNumber(l.qtyDiff ?? Number(l.newQty) - Number(l.oldQty));
        return sum + qtyDiff * toNumber(l.unitCost);
      }, 0);
      const netRounded = asMoney(netValueChange);

      if (Math.abs(netRounded) > 0) {
        const accounts = await tx.account.findMany({
          where: { organizationId: orgId, isActive: true },
          select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
        });
        const inventoryAccountId = resolveAccountDefaultId(accounts, undefined, 'inventoryAsset');
        // No dedicated `inventoryAdjustment` default exists yet — fall back
        // to cogsExpense as a temporary catch-all. Settings work to add a
        // proper default is tracked separately.
        const varianceAccountId = resolveAccountDefaultId(accounts, undefined, 'cogsExpense');

        if (inventoryAccountId && varianceAccountId) {
          const memo = `Stock adjustment: ${adj.number}`;
          if (netRounded > 0) {
            await postJournalEntry(tx, {
              organizationId: orgId,
              date: new Date(date),
              memo,
              lines: [
                { accountId: inventoryAccountId, description: `Inventory increase - ${adj.number}`, debit: netRounded, credit: 0 },
                { accountId: varianceAccountId,  description: `Stock variance - ${adj.number}`,    debit: 0,           credit: netRounded },
              ],
            });
          } else {
            const amount = -netRounded;
            await postJournalEntry(tx, {
              organizationId: orgId,
              date: new Date(date),
              memo,
              lines: [
                { accountId: varianceAccountId,  description: `Stock variance - ${adj.number}`,    debit: amount, credit: 0 },
                { accountId: inventoryAccountId, description: `Inventory decrease - ${adj.number}`, debit: 0,     credit: amount },
              ],
            });
          }
        }
      }
    }

    return tx.stockAdjustment.findUnique({
      where: { id: adj.id },
      include: {
        lines: {
          include: { item: { select: { id: true, name: true, sku: true } } },
        },
      },
    });
  });

  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'StockAdjustment', entityId: result!.id, action: 'CREATE', payload: { number: result!.number } });
  return ok(result, 201);
});

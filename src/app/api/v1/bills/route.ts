// Bill model: number, vendorId, issueDate, dueDate, status (BillStatus), totalAmount
// BillStatus: DRAFT | OPEN | PENDING | PAID | OVERDUE | VOID
// BillLine fields: billId, lineNo, description, quantity, unit, price, lineTotal
// Unique: @@unique([organizationId, number])
import { NextRequest } from 'next/server';
import { InventoryDocumentType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ApiError, err, listResponse, logAudit, ok, parsePaginationParams, requireOrg, withHandler } from '@/lib/api-utils';
import { billInputSchema } from '@/types/api';
import { createBillRecord } from '@/lib/bills';
import { addCostLayer } from '@/lib/inventory-costing';
import { resolveAccountDefaultId } from '@/lib/account-defaults';
import { toNumber, asMoney } from '@/lib/money';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams, page, limit } = parsePaginationParams(req, { limit: 20, maxLimit: 100 });
  const status = searchParams.get('status');
  const search = searchParams.get('search');
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const vendorId = searchParams.get('vendorId');

  const where: any = { organizationId: orgId };
  if (status) where.status = status;
  if (search) where.OR = [
    { number: { contains: search, mode: 'insensitive' } },
    { vendor: { name: { contains: search, mode: 'insensitive' } } },
  ];
  if (dateFrom || dateTo) {
    where.issueDate = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo   ? { lte: new Date(dateTo)   } : {}),
    };
  }
  if (vendorId) where.vendorId = vendorId;

  const [data, total] = await Promise.all([
    prisma.bill.findMany({
      where, skip: (page - 1) * limit, take: limit,
      orderBy: { issueDate: 'desc' },
      include: { vendor: { select: { id: true, name: true, code: true } }, lines: true, attachments: true },
    }),
    prisma.bill.count({ where }),
  ]);

  return listResponse(data, total, page, limit);
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);
  const body = await req.json();
  const parsed = billInputSchema.safeParse({
    ...body,
    organizationId: orgId,
  });
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid bill payload', 400);
  }

  const bill = await prisma.$transaction(async (tx: any) => {
    const createdBill = await createBillRecord(tx, orgId, parsed.data);

    // Add cost layers when bill status is APPROVED (or OPEN — treated as approved/ready)
    // Cast to string for forward-compatibility in case APPROVED is added to the enum later
    if ((parsed.data.status as string) === 'APPROVED' && createdBill) {
      const organization = await tx.organization.findUnique({
        where: { id: orgId },
        select: { costingMethod: true },
      });

      if (organization?.costingMethod) {
        const billLines = createdBill.lines ?? [];
        const itemIds = billLines
          .map((l: any) => l.itemId)
          .filter((id: string | null) => Boolean(id)) as string[];

        if (itemIds.length > 0) {
          const inventoryItems = await tx.item.findMany({
            where: {
              id: { in: itemIds },
              organizationId: orgId,
              type: { in: ['PRODUCT', 'RAW_MATERIAL'] },
            },
            select: { id: true },
          });
          const inventoryItemIds = new Set(inventoryItems.map((i: any) => i.id));

          const inventoryLines = billLines.filter(
            (l: any) => l.itemId && inventoryItemIds.has(l.itemId),
          );

          if (inventoryLines.length > 0) {
            // Resolve account IDs once
            const accounts = await tx.account.findMany({
              where: { organizationId: orgId, isActive: true },
              select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
            });

            const inventoryAccountId = resolveAccountDefaultId(accounts, undefined, 'inventoryAsset');
            const apAccountId = resolveAccountDefaultId(accounts, undefined, 'apControl');

            const billDate = createdBill.issueDate
              ? new Date(createdBill.issueDate)
              : new Date();

            for (const line of inventoryLines) {
              const qty = toNumber(line.quantity);
              const unitCost = toNumber(line.price);
              if (qty <= 0 || !line.itemId) continue;

              await addCostLayer(
                tx,
                orgId,
                line.itemId as string,
                null,
                qty,
                unitCost,
                InventoryDocumentType.PURCHASE,
                createdBill.id,
                billDate,
              );

              if (inventoryAccountId && apAccountId) {
                const lineTotal = asMoney(qty * unitCost);

                // Generate entryNo for this GL entry
                const entryRows = await tx.$queryRaw`
                  SELECT MAX(CAST(SUBSTRING("entryNo" FROM '^JE-([0-9]+)$') AS INTEGER)) AS max_seq
                  FROM "JournalEntry"
                  WHERE "organizationId" = ${orgId}
                    AND "entryNo" LIKE ${'JE-%'}
                `;
                const nextSeq = (Number((entryRows as any)[0]?.max_seq ?? 0)) + 1;
                const entryNo = `JE-${String(nextSeq).padStart(6, '0')}`;

                await tx.journalEntry.create({
                  data: {
                    organizationId: orgId,
                    entryNo,
                    date: billDate,
                    memo: `Inventory receipt: ${createdBill.number}`,
                    source: 'SYSTEM',
                    status: 'POSTED',
                    postedAt: new Date(),
                    totalDebit: lineTotal,
                    totalCredit: lineTotal,
                    lines: {
                      create: [
                        {
                          lineNo: 1,
                          accountId: inventoryAccountId,
                          description: `Inventory - ${createdBill.number}`,
                          debit: lineTotal,
                          credit: 0,
                        },
                        {
                          lineNo: 2,
                          accountId: apAccountId,
                          description: `AP Control - ${createdBill.number}`,
                          debit: 0,
                          credit: lineTotal,
                        },
                      ],
                    },
                  },
                });
              }
            }
          }
        }
      }
    }

    return createdBill;
  });

  logAudit({
    orgId,
    actorId: req.headers.get('x-user-id'),
    entityType: 'Bill',
    entityId: bill!.id,
    action: 'CREATE',
    payload: { number: bill!.number },
  });
  return ok(bill, 201);
});

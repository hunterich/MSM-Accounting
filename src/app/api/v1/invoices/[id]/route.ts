import { NextRequest, NextResponse } from 'next/server';
import { InventoryDocumentType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';
import { AccessError, applyInvoiceAccessScope, getInvoiceAccessContext } from '@/lib/document-access';
import { calculateAndPostCOGS } from '@/lib/inventory-costing';
import { resolveAccountDefaultId } from '@/lib/account-defaults';
import { toNumber, asMoney } from '@/lib/money';
import { postJournalEntry } from '@/lib/journal-posting';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const orgId = _req.headers.get('x-org-id');
    const userId = _req.headers.get('x-user-id');
    if (!orgId || !userId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const access = await getInvoiceAccessContext(orgId, userId);
    const invoice = await prisma.salesInvoice.findFirst({
      where: applyInvoiceAccessScope({ id, organizationId: orgId }, access),
      include: {
        customer: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        lines: true,
      },
    });
    if (!invoice) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(invoice));
  } catch (error) {
    if (error instanceof AccessError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }

    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const orgId = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId || !userId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const access = await getInvoiceAccessContext(orgId, userId);
    const body = await req.json();
    const { lines, ...header } = body;
    delete header.organizationId;
    delete header.createdById;

    const isStatusOnlyUpdate = header.status && Object.keys(header).length === 1;

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.salesInvoice.findFirst({
        where: applyInvoiceAccessScope({ id, organizationId: orgId }, access),
        select: { id: true, status: true, number: true, issueDate: true, organizationId: true },
      });

      if (!existing) {
        throw new AccessError('Invoice not found', 404);
      }

      if (existing.status !== 'DRAFT' && !isStatusOnlyUpdate) {
        throw new AccessError('Only DRAFT invoices can be modified', 403);
      }

      await tx.salesInvoice.update({
        where: { id },
        data: { ...header, updatedAt: new Date() },
      });

      if (lines) {
        await tx.salesInvoiceLine.deleteMany({ where: { invoiceId: id } });
        await tx.salesInvoiceLine.createMany({
          data: lines.map((l: any, idx: number) => ({
            ...l,
            invoiceId: id,
            lineNo: l.lineNo ?? idx + 1,
          })),
        });
      }

      // Post COGS when invoice transitions DRAFT → SENT
      if (existing.status === 'DRAFT' && header.status === 'SENT') {
        const organization = await tx.organization.findUnique({
          where: { id: existing.organizationId },
          select: { costingMethod: true },
        });

        if (organization?.costingMethod) {
          const invoiceLines = await tx.salesInvoiceLine.findMany({
            where: { invoiceId: id },
            select: { itemId: true, quantity: true },
          });

          const itemIds = invoiceLines
            .map((l) => l.itemId)
            .filter((itemId): itemId is string => Boolean(itemId));

          if (itemIds.length > 0) {
            const inventoryItems = await tx.item.findMany({
              where: {
                id: { in: itemIds },
                organizationId: existing.organizationId,
                type: { in: ['PRODUCT', 'RAW_MATERIAL'] },
              },
              select: { id: true },
            });
            const inventoryItemIds = new Set(inventoryItems.map((i) => i.id));

            const linesWithInventory = invoiceLines.filter(
              (l) => l.itemId && inventoryItemIds.has(l.itemId),
            );

            if (linesWithInventory.length > 0) {
              const accounts = await tx.account.findMany({
                where: { organizationId: existing.organizationId, isActive: true },
                select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
              });

              const cogsAccountId = resolveAccountDefaultId(accounts, undefined, 'cogsExpense');
              const inventoryAccountId = resolveAccountDefaultId(accounts, undefined, 'inventoryAsset');
              const invoiceDate = new Date(existing.issueDate);

              for (const line of linesWithInventory) {
                const qty = toNumber(line.quantity);
                if (qty <= 0 || !line.itemId) continue;

                const cogs = await calculateAndPostCOGS(
                  tx,
                  existing.organizationId,
                  line.itemId,
                  null,
                  qty,
                  InventoryDocumentType.SALES,
                  id,
                  invoiceDate,
                );

                if (cogs > 0 && cogsAccountId && inventoryAccountId) {
                  await postJournalEntry(tx, {
                    organizationId: existing.organizationId,
                    date: invoiceDate,
                    memo: `COGS auto-post: ${existing.number}`,
                    lines: [
                      {
                        accountId: cogsAccountId,
                        description: `COGS - ${existing.number}`,
                        debit: cogs,
                        credit: 0,
                      },
                      {
                        accountId: inventoryAccountId,
                        description: `Inventory reduction - ${existing.number}`,
                        debit: 0,
                        credit: cogs,
                      },
                    ],
                  });
                }
              }
            }
          }
        }
      }

      return tx.salesInvoice.findFirst({
        where: applyInvoiceAccessScope({ id, organizationId: orgId }, access),
        include: {
          customer: true,
          createdBy: { select: { id: true, fullName: true, email: true } },
          lines: true,
        },
      });
    });
    logAudit({ orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'SalesInvoice', entityId: id, action: 'UPDATE', payload: body });
    return withCors(NextResponse.json(updated));
  } catch (error) {
    if (error instanceof AccessError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }

    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const orgId = _req.headers.get('x-org-id');
    const userId = _req.headers.get('x-user-id');
    if (!orgId || !userId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const access = await getInvoiceAccessContext(orgId, userId);
    const existing = await prisma.salesInvoice.findFirst({
      where: applyInvoiceAccessScope({ id, organizationId: orgId }, access),
      select: { id: true, status: true },
    });

    if (!existing) {
      return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    }

    if (existing.status !== 'DRAFT') {
      return withCors(NextResponse.json({ error: 'Only DRAFT invoices can be deleted' }, { status: 403 }));
    }

    await prisma.salesInvoice.update({ where: { id, organizationId: orgId }, data: { deletedAt: new Date() } });
    logAudit({ orgId: orgId!, actorId: _req.headers.get('x-user-id'), entityType: 'SalesInvoice', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    if (error instanceof AccessError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }

    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

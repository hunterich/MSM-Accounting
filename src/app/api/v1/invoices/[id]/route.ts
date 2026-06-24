import { NextRequest, NextResponse } from 'next/server';
import { InventoryDocumentType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit } from '@/lib/api-utils';
import { AccessError, applyInvoiceAccessScope, getInvoiceAccessContext } from '@/lib/document-access';
import { assertPeriodOpen } from '@/lib/period-guard';
import { calculateAndPostCOGS } from '@/lib/inventory-costing';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from '@/lib/account-defaults';
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

    const body = await req.json();
    const { lines, ...header } = body;
    delete header.organizationId;
    delete header.createdById;

    // Voiding a posted invoice must reverse its journal entries and restore the
    // sold stock — that only happens through the dedicated endpoint. A bare
    // status flip here would leave the GL + inventory wrong (the bug this guards).
    // Checked before any DB work so a rejected void is a cheap 422.
    if (String(header.status ?? '').toUpperCase() === 'VOID') {
      return withCors(NextResponse.json(
        { error: 'Void a posted invoice through POST /api/v1/invoices/:id/void' },
        { status: 422 },
      ));
    }

    const access = await getInvoiceAccessContext(orgId, userId);
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

      // Post AR + COGS journals when invoice transitions DRAFT → SENT.
      // The AR-side post (DR AR / CR Sales / CR Tax) runs for every invoice;
      // the COGS post only runs when the org has a costing method and the
      // invoice has inventory lines.
      if (existing.status === 'DRAFT' && header.status === 'SENT') {
        // Refuse to post into a closed/locked accounting period.
        await assertPeriodOpen(tx, existing.organizationId, new Date(existing.issueDate));

        const invoiceHeader = await tx.salesInvoice.findUnique({
          where: { id },
          select: {
            number: true,
            issueDate: true,
            subtotal: true,
            discountAmount: true,
            totalAmount: true,
            taxAmount: true,
          },
        });
        const accounts = await tx.account.findMany({
          where: { organizationId: existing.organizationId, isActive: true },
          select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
        });
        const settings = await loadOrgAccountDefaults(tx, existing.organizationId);

        if (invoiceHeader) {
          const totalAmount = toNumber(invoiceHeader.totalAmount);
          const taxAmount = toNumber(invoiceHeader.taxAmount);
          const discountAmount = toNumber(invoiceHeader.discountAmount);
          // Revenue is gross of any discount line we post separately below;
          // when we post a contra-revenue discount line, salesRevenue is
          // credited at the larger pre-discount amount.
          const baseRevenue = totalAmount - taxAmount;
          const arAccountId = resolveAccountDefaultId(accounts, settings, 'arControl');
          const salesAccountId = resolveAccountDefaultId(accounts, settings, 'salesRevenue');
          const taxAccountId = taxAmount > 0
            ? resolveAccountDefaultId(accounts, settings, 'arTax')
            : null;
          const salesDiscountAccountId =
            discountAmount > 0
              ? (resolveAccountDefaultId(accounts, settings, 'salesDiscount')
                || resolveAccountDefaultId(accounts, settings, 'arDiscount'))
              : null;
          const roundingAccountId =
            resolveAccountDefaultId(accounts, settings, 'roundingAccount')
            || resolveAccountDefaultId(accounts, settings, 'cogsExpense');
          const arInvoiceDate = new Date(invoiceHeader.issueDate);

          if (totalAmount > 0 && arAccountId && salesAccountId && (taxAmount === 0 || taxAccountId)) {
            const splitDiscount = discountAmount > 0 && Boolean(salesDiscountAccountId);
            const revenueCredit = splitDiscount
              ? asMoney(baseRevenue + discountAmount)
              : baseRevenue;
            const arLines: Array<{ accountId: string; description: string; debit: number; credit: number }> = [
              {
                accountId: arAccountId,
                description: `AR - ${invoiceHeader.number}`,
                debit: totalAmount,
                credit: 0,
              },
              {
                accountId: salesAccountId,
                description: `Sales - ${invoiceHeader.number}`,
                debit: 0,
                credit: revenueCredit,
              },
            ];
            if (splitDiscount && salesDiscountAccountId) {
              arLines.push({
                accountId: salesDiscountAccountId,
                description: `Sales discount - ${invoiceHeader.number}`,
                debit: discountAmount,
                credit: 0,
              });
            }
            if (taxAmount > 0 && taxAccountId) {
              arLines.push({
                accountId: taxAccountId,
                description: `Output tax - ${invoiceHeader.number}`,
                debit: 0,
                credit: taxAmount,
              });
            }

            // Tax-inclusive math frequently leaves a sub-rupiah residual
            // between totalAmount and (revenue - discount + tax). Book it to
            // the rounding account so the entry balances exactly.
            const sumDebits  = arLines.reduce((s, l) => s + l.debit, 0);
            const sumCredits = arLines.reduce((s, l) => s + l.credit, 0);
            const rounding = asMoney(sumDebits - sumCredits);
            if (Math.abs(rounding) > 0 && roundingAccountId) {
              arLines.push({
                accountId: roundingAccountId,
                description: `Rounding - ${invoiceHeader.number}`,
                debit:  rounding < 0 ? -rounding : 0,
                credit: rounding > 0 ?  rounding : 0,
              });
            }

            await postJournalEntry(tx, {
              organizationId: existing.organizationId,
              date: arInvoiceDate,
              memo: `Sales recognition: ${invoiceHeader.number}`,
              lines: arLines,
            });
          }
        }

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

              const cogsAccountId = resolveAccountDefaultId(accounts, settings, 'cogsExpense');
              const inventoryAccountId = resolveAccountDefaultId(accounts, settings, 'inventoryAsset');
              const invoiceDate = new Date(existing.issueDate);

              // Never relieve inventory without booking COGS. If the accounts
              // can't be resolved, block the SEND so revenue is not recognised
              // while the inventory asset is left overstated on the books.
              if (!cogsAccountId || !inventoryAccountId) {
                throw new ApiError(
                  `Cannot post COGS for ${existing.number}: no Inventory Asset / COGS account is configured. Map default accounts in Settings before sending invoices with stocked items.`,
                  422,
                );
              }

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

                if (cogs > 0) {
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
    if (error instanceof AccessError || error instanceof ApiError) {
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

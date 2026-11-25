import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit } from '@/lib/api-utils';
import { withPermission, canOverrideTransactionDate } from '@/lib/authz';
import { readScope } from '@/lib/authz-read-scopes';
import { AccessError, applyInvoiceAccessScope, getInvoiceAccessContext } from '@/lib/document-access';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { assertStoredDocumentOffsets } from '@/lib/document-offset-accounts';
import { reverseInvoicePosting } from '@/lib/repost';
import { assertPeriodOpen } from '@/lib/period-guard';
import { routeForApproval } from '@/lib/approval/engine';
import { assertItemsActive } from '@/lib/item-availability';
import { lockInventoryItems, assertCorrectedSalesValue } from '@/lib/inventory-costing';
import { calculateInvoiceTotals, sameInvoiceLinePricing } from '@/lib/invoice-totals';
import { roundMoneyDecimal } from '@/lib/money-decimal';
import { updateInvoiceAmountsSchema } from '@/types/api';

export const runtime = 'nodejs';

function sameInvoiceHeaderValue(submitted: unknown, saved: unknown) {
  if (saved instanceof Date) return typeof submitted === 'string' && saved.getTime() === new Date(submitted).getTime();
  return (submitted === '' ? null : submitted ?? null) === (saved === '' ? null : saved ?? null);
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission(readScope('invoices'), async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
        lines: { orderBy: { lineNo: 'asc' } },
        charges: { orderBy: { lineNo: 'asc' } },
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
});

export const PUT = withPermission({ module: 'AR_INVOICES', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  try {
    const orgId = req.headers.get('x-org-id');

  // SETTINGS/edit doubles as the right to post outside the transaction-date
  // window: it is the right that edits the window, so it cannot be withheld here.
  const dateOverride = { overrideDateRestriction: await canOverrideTransactionDate(req) };
    const userId = req.headers.get('x-user-id');
    if (!orgId || !userId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const body = await req.json();
    const {
      lines: _lines, charges: _charges, discountPct: _discountPct,
      taxEnabled: _taxEnabled, taxInclusive: _taxInclusive, taxRate: _taxRate,
      subtotal, discountAmount, taxAmount, totalAmount, ...header
    } = body;
    delete header.organizationId;
    delete header.createdById;
    delete header.postingTracked;
    delete header.postingJournalIds;

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

    const parsed = updateInvoiceAmountsSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message || 'Invalid invoice amounts', 400);
    const { lines, charges, discountPct, taxEnabled, taxInclusive, taxRate } = parsed.data;
    const recalculateAmounts = Object.values(parsed.data).some(value => value !== undefined)
      || [subtotal, discountAmount, taxAmount, totalAmount].some(value => value !== undefined);
    const access = await getInvoiceAccessContext(orgId, userId);
    const isStatusOnlyUpdate = header.status && Object.keys(header).length === 1 && !recalculateAmounts;

    // Captured inside the transaction for the audit trail of an edit-after-post.
    let postedEditBefore: unknown = null;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SalesInvoice" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`;
      const existing = await tx.salesInvoice.findFirst({
        where: applyInvoiceAccessScope({ id, organizationId: orgId }, access),
        include: {
          lines: {
            select: { id: true, itemId: true, code: true, description: true, quantity: true, unit: true, price: true, discountPct: true, lineSubtotal: true, taxable: true },
            orderBy: { lineNo: 'asc' },
          },
          charges: { select: { label: true, accountId: true, amount: true, taxRate: true }, orderBy: { lineNo: 'asc' } },
          _count: { select: { paymentAllocations: true, salesReturns: true,
            creditNotes: { where: { status: { not: 'VOID' } } } } },
        },
      });

      if (!existing) {
        throw new AccessError('Invoice not found', 404);
      }

      if (isStatusOnlyUpdate && header.status !== existing.status && !(existing.status === 'DRAFT' && header.status === 'SENT')) {
        throw new AccessError('Invoice status is managed by sending, settlement or voiding; use the corresponding action.', 422);
      }
      if (header.customerId && !await tx.customer.findFirst({ where: { id: header.customerId, organizationId: orgId }, select: { id: true } })) {
        throw new AccessError('Customer not found in organization.', 422);
      }

      if (lines) {
        await assertItemsActive(tx, orgId, lines.map(line => line.itemId), {
          allowItemIds: existing.lines.flatMap((line) => line.itemId ? [line.itemId] : []),
        });
      }

      const savedById = new Map(existing.lines.map(line => [line.id, line]));
      const usedLineIds = new Set<string>();
      const matchesLegacyOrder = lines?.length === existing.lines.length && !lines.some(line => line.id);
      let linesUnchanged = !lines || lines.length === existing.lines.length;
      const submittedLines = lines?.map((line, index) => {
        const samePosition = existing.lines[index];
        const sameDescription = samePosition && line.description === samePosition.description && (line.code || null) === (samePosition.code || null);
        // A legacy payload without line IDs can retain values on an unchanged ordered list.
        const saved = line.id ? savedById.get(line.id) : matchesLegacyOrder && sameDescription ? samePosition : undefined;
        if (line.id && !saved) throw new ApiError('The invoice lines have changed. Reload the invoice before saving.', 409);
        if (saved && usedLineIds.has(saved.id)) throw new ApiError('An invoice line can only appear once in an edit.', 422);
        if (saved) usedLineIds.add(saved.id);
        const samePrice = saved && sameInvoiceLinePricing(line, saved);
        linesUnchanged &&= !!samePrice && saved === samePosition && !!sameDescription
          && (saved.taxable ?? null) === (line.taxable ?? null);
        return { ...line, lineSubtotal: samePrice ? saved.lineSubtotal : undefined };
      });
      const chargesUnchanged = !charges || (charges.length === existing.charges.length && charges.every((charge, index) => {
        const saved = existing.charges[index];
        return charge.label === saved.label && (charge.accountId || null) === (saved.accountId || null)
          && roundMoneyDecimal(charge.amount).eq(saved.amount) && roundMoneyDecimal(charge.taxRate ?? 0).eq(saved.taxRate);
      }));
      const canEditPosted = existing.status === 'SENT' || existing.status === 'OVERDUE';
      const isNotesOnlyUpdate = canEditPosted && 'notes' in header && linesUnchanged && chargesUnchanged
        && (taxEnabled === undefined || taxEnabled === existing.taxEnabled)
        && (taxInclusive === undefined || taxInclusive === existing.taxInclusive)
        && (taxRate === undefined || roundMoneyDecimal(taxRate).eq(existing.taxRate))
        && (discountPct === undefined || roundMoneyDecimal(discountPct).eq(existing.discountPct))
        && Object.entries(header).every(([key, value]) => key === 'notes'
          || sameInvoiceHeaderValue(value, existing[key as keyof typeof existing]));

      const amounts = recalculateAmounts && !isNotesOnlyUpdate ? calculateInvoiceTotals({
        lines: submittedLines ?? existing.lines,
        charges: charges ?? existing.charges,
        discountPct: discountPct ?? existing.discountPct,
        tax: { enabled: taxEnabled, inclusive: taxInclusive, rate: taxRate },
      }, {
        taxEnabled: existing.taxEnabled,
        taxInclusiveByDefault: existing.taxInclusive,
        taxDefaultRate: existing.taxRate,
      }) : null;

      // DRAFT → edit freely. SENT/OVERDUE field edit → edit-after-post: reverse the
      // posting, apply the edit, re-post — bounded by the open period. A status-only
      // update (e.g. marking paid) is NOT an edit and skips this. Everything else
      // (PAID/VOID/PENDING_APPROVAL) → must be voided to change.
      const isDraft = existing.status === 'DRAFT';
      const isPostedEdit = canEditPosted && !isStatusOnlyUpdate && !isNotesOnlyUpdate;
      if (!isDraft && !canEditPosted && !isStatusOnlyUpdate) {
        throw new AccessError(`Cannot edit a ${existing.status} invoice — void it to change.`, 403);
      }

      // A DRAFT → SENT finalize ("send"). Gated below by an atomic status claim so
      // two concurrent sends can't both post the GL (double AR + revenue).
      const isDraftSend = isDraft && header.status === 'SENT';

      if (isPostedEdit) {
        if (!existing.postingTracked && await tx.item.count({ where: { organizationId: orgId,
          id: { in: existing.lines.flatMap(line => line.itemId ? [line.itemId] : []) }, type: { in: ['PRODUCT', 'RAW_MATERIAL'] } } })) {
          throw new AccessError('This historical invoice has no original stock-lot tracking — void it to change.', 422);
        }
        if (existing._count.paymentAllocations > 0) {
          throw new AccessError('Cannot edit an invoice with receipts applied — unallocate them first.', 422);
        }
        if (existing._count.salesReturns > 0 || existing._count.creditNotes > 0) {
          throw new AccessError('Invoices linked to returns or credit notes must be voided and replaced to change their lines.', 422);
        }
        const newDate = header.issueDate ? new Date(header.issueDate) : new Date(existing.issueDate);
        await assertPeriodOpen(tx, existing.organizationId, new Date(existing.issueDate)); // posted period
        await assertPeriodOpen(tx, existing.organizationId, newDate);                       // re-post period
        await lockInventoryItems(tx, orgId, [...existing.lines, ...(lines ?? [])].flatMap(line => line.itemId ? [line.itemId] : []));
        postedEditBefore = await tx.salesInvoice.findFirst({ where: { id }, include: { lines: true, charges: true } });
        await reverseInvoicePosting(tx, existing.organizationId, existing, { date: newDate });
      }

      // Atomically claim the DRAFT → SENT transition before any GL side effect:
      // only the request whose guarded updateMany flips the row (count === 1) may
      // post. A concurrent send blocks on the row lock, then sees status ≠ DRAFT →
      // count 0 → skips posting (the invoice is already SENT/PENDING_APPROVAL, so a
      // double-click is a harmless no-op). Mirrors the claim in lib/invoice-void.ts.
      let sendClaimWon = false;
      if (isDraftSend) {
        const claim = await tx.salesInvoice.updateMany({
          where: { id, organizationId: orgId, status: 'DRAFT' },
          data: { status: 'SENT' },
        });
        sendClaimWon = claim.count === 1;
      }

      await tx.salesInvoice.update({
        where: { id },
        data: {
          ...(isNotesOnlyUpdate ? { notes: header.notes } : header),
          ...(amounts && {
            subtotal: amounts.subtotal, discountPct: amounts.discountPct, discountAmount: amounts.discountAmount,
            taxEnabled: amounts.taxEnabled, taxInclusive: amounts.taxInclusive, taxRate: amounts.taxRate,
            taxAmount: amounts.taxAmount, totalAmount: amounts.totalAmount,
          }),
          // The claim above is the sole authority for the DRAFT → SENT status flip —
          // don't let the blind header spread re-write it (that would revert the
          // claimed SENT, or clobber a concurrent PENDING_APPROVAL hold).
          ...(isDraftSend && { status: undefined }),
          // An edit never un-posts an invoice — keep it SENT/OVERDUE.
          ...(isPostedEdit && { status: existing.status }),
          updatedAt: new Date(),
        },
      });

      if (lines && amounts) {
        await tx.salesInvoiceLine.deleteMany({ where: { invoiceId: id } });
        await tx.salesInvoiceLine.createMany({
          data: amounts.lines.map(line => ({ ...line, invoiceId: id })),
        });
      }

      if (charges && amounts) {
        await tx.salesInvoiceCharge.deleteMany({ where: { invoiceId: id } });
        if (amounts.charges.length > 0) {
          await tx.salesInvoiceCharge.createMany({
            data: amounts.charges.map(charge => ({ ...charge, invoiceId: id })),
          });
        }
      }

      if (!isNotesOnlyUpdate) await assertStoredDocumentOffsets(tx, orgId, 'INVOICE', id);
      // Edit-after-post: re-post AR (+ charges) from the freshly-edited invoice
      // (its prior entries and exact inventory draws were reversed above).
      if (isPostedEdit) {
        await postInvoiceSend(tx, existing.organizationId, existing.id, dateOverride);
        await assertCorrectedSalesValue(tx, existing.organizationId, existing.id);
      }

      // Post AR + COGS journals when the invoice transitions DRAFT → SENT,
      // unless the approval engine routes the finalize for approval first. Only
      // the request that won the atomic claim above reaches here — the loser
      // (sendClaimWon === false) already left the row SENT/PENDING_APPROVAL and
      // must NOT post a second time.
      // The AR-side post (DR AR / CR Sales / CR Tax) runs for every invoice;
      // the COGS post only runs when the org has a costing method and the
      // invoice has inventory lines.
      if (isDraftSend && sendClaimWon) {
        const routed = await routeForApproval(tx, {
          orgId: existing.organizationId,
          userId,
          documentType: 'INVOICE',
          documentId: existing.id,
        });
        if (routed) {
          // HELD for approval: the claim above stamped status='SENT'; override it
          // back to PENDING_APPROVAL and post NO GL.
          await tx.salesInvoice.update({
            where: { id: existing.id },
            data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
          });
        } else {
          // Not required / already approved: keep SENT and post the GL.
          await postInvoiceSend(tx, existing.organizationId, existing.id, dateOverride);
        }
      }

      return tx.salesInvoice.findFirst({
        where: applyInvoiceAccessScope({ id, organizationId: orgId }, access),
        include: {
          customer: true,
          createdBy: { select: { id: true, fullName: true, email: true } },
          lines: { orderBy: { lineNo: 'asc' } },
          charges: { orderBy: { lineNo: 'asc' } },
        },
      });
    });
    // For an edit-after-post, log before→after so the journal re-post is
    // attributable (who changed what); a plain draft edit logs the submitted body.
    logAudit({
      orgId: orgId!, actorId: req.headers.get('x-user-id'), entityType: 'SalesInvoice', entityId: id, action: 'UPDATE',
      payload: postedEditBefore ? { reposted: true, before: postedEditBefore, after: body } : body,
    });
    return withCors(NextResponse.json(updated));
  } catch (error) {
    if (error instanceof AccessError || error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }

    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});

export const DELETE = withPermission({ module: 'AR_INVOICES', action: 'delete' }, async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
});

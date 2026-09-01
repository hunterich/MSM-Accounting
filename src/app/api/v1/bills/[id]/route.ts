import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { ApiError, logAudit, validateForeignKey } from '@/lib/api-utils';
import { updateBillInputSchema } from '@/types/api';
import { postBillToLedger } from '@/lib/bill-posting';
import { applyBillPoReceipt } from '@/lib/bill-po-receipt';
import { assertPeriodOpen } from '@/lib/period-guard';
import { reverseBillPosting } from '@/lib/repost';
import { routeForApproval } from '@/lib/approval/engine';
import { withPermission, canOverrideTransactionDate } from '@/lib/authz';

function isFakturDuplicate(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes('vendorInvoiceNo') : String(target ?? '').includes('vendorInvoiceNo');
}

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    // The list/edit links use the display id, which is the bill NUMBER; resolve
    // either the cuid or the number so edit-loading works from any entry point.
    const bill = await prisma.bill.findFirst({
      where: { organizationId: orgId, OR: [{ id }, { number: id }] },
      include: { vendor: true, lines: true, charges: true, attachments: true },
    });
    if (!bill) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    return withCors(NextResponse.json(bill));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export const PUT = withPermission({ module: 'AP_BILLS', action: 'edit' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');

  // SETTINGS/edit doubles as the right to post outside the transaction-date
  // window: it is the right that edits the window, so it cannot be withheld here.
  const dateOverride = { overrideDateRestriction: await canOverrideTransactionDate(req) };
  const userId = req.headers.get('x-user-id');
  if (!orgId || !userId) {
    return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
  }
  try {
    const body = await req.json();
    const parsed = updateBillInputSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid bill payload', issues: parsed.error.issues }, { status: 400 }));
    }
    const { lines, charges, ...header } = parsed.data;

    // Captured inside the transaction for the audit trail of an edit-after-post.
    let postedEditBefore: unknown = null;

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.bill.findFirst({
        where: { id, organizationId: orgId },
        select: {
          id: true, status: true, vendorInvoiceNo: true, poId: true,
          number: true, issueDate: true, journalEntryId: true,
          _count: { select: { paymentAllocations: true, purchaseReturns: true, debitNotes: true } },
        },
      });
      if (!existing) return null;

      // DRAFT → edit freely (no GL yet). OPEN/OVERDUE → edit-after-post: reverse
      // the posting, apply the edit, re-post — all here so the GL stays in sync,
      // bounded by the open period (the monthly-close window). Everything else
      // (PAID/VOID/PENDING_APPROVAL/PENDING) → must be voided to change.
      const isDraft = existing.status === 'DRAFT';
      const isPostedEdit = !isDraft && (existing.status === 'OPEN' || existing.status === 'OVERDUE');
      if (!isDraft && !isPostedEdit) {
        throw new ApiError(`Cannot edit a ${existing.status} bill — void it to change.`, 403);
      }

      if (isPostedEdit) {
        // PO-sourced bills couple to receivedQty + GR/IR clearing on the PO, so
        // editing them in place isn't supported — void + re-receive instead.
        // Inventory bills ARE supported: reverseBillPosting deletes the cost layers
        // (and throws a clear 422 if the stock has already been consumed/sold) and
        // the re-post re-books them, so GL + ledger + lots stay reconciled.
        if (existing.poId) {
          throw new ApiError('This bill came from a purchase order — void it to change (its receipt must be unwound first).', 422);
        }
        if (existing._count.paymentAllocations > 0) {
          throw new ApiError('Cannot edit a bill with payments applied — unallocate its payments first.', 422);
        }
        if (existing._count.purchaseReturns > 0 || existing._count.debitNotes > 0) {
          throw new ApiError('Cannot edit a bill with returns or debit notes against it — reverse those first.', 422);
        }
        const newDate = header.issueDate ? new Date(header.issueDate) : new Date(existing.issueDate);
        await assertPeriodOpen(tx, orgId, new Date(existing.issueDate), dateOverride); // the period it's posted in
        await assertPeriodOpen(tx, orgId, newDate, dateOverride);                       // the period it re-posts into
        postedEditBefore = await tx.bill.findFirst({ where: { id, organizationId: orgId }, include: { lines: true, charges: true } });
        await reverseBillPosting(
          tx, orgId,
          { id: existing.id, number: existing.number, poId: existing.poId, journalEntryId: existing.journalEntryId },
          { date: newDate },
        );
      }
      if (header.vendorId) {
        await validateForeignKey(tx.vendor, { id: header.vendorId, organizationId: orgId }, 'Vendor not found in organization');
      }
      if (header.poId) {
        await validateForeignKey(tx.purchaseOrder, { id: header.poId, organizationId: orgId }, 'Purchase order not found in organization');
      }
      // A bill can't be approved without a supplier invoice # (the per-vendor
      // duplicate guard). Honour either a value sent in this update or one already stored.
      if (existing.status === 'DRAFT' && header.status === 'OPEN') {
        const effectiveFaktur = header.vendorInvoiceNo !== undefined ? header.vendorInvoiceNo : existing.vendorInvoiceNo;
        if (!effectiveFaktur) {
          throw new ApiError('Supplier invoice # (No. Faktur) is required to approve a bill.', 400);
        }
      }
      await tx.bill.update({
        where: { id, organizationId: orgId },
        data: {
          ...header,
          // An edit never un-posts a bill — keep it OPEN/OVERDUE (a draft downgrade
          // would be a void, which has its own endpoint).
          ...(isPostedEdit && { status: existing.status }),
          // Empty faktur # stores as NULL so the per-vendor unique index ignores it.
          ...(header.vendorInvoiceNo !== undefined && { vendorInvoiceNo: header.vendorInvoiceNo || null }),
          updatedAt: new Date(),
        },
      });
      if (lines) {
        await tx.billLine.deleteMany({ where: { billId: id } });
        await tx.billLine.createMany({
          data: lines.map((l, idx: number) => ({
            billId: id,
            itemId: l.itemId || null,
            accountId: l.accountId || null,
            purchaseOrderLineId: l.purchaseOrderLineId || null,
            lineNo: l.lineNo ?? idx + 1,
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            price: l.price,
            lineTotal: l.lineTotal ?? (Number(l.quantity) * Number(l.price)),
          })),
        });
      }
      if (charges) {
        await tx.billCharge.deleteMany({ where: { billId: id } });
        if (charges.length > 0) {
          await tx.billCharge.createMany({
            data: charges.map((c, idx: number) => ({
              billId: id,
              lineNo: c.lineNo ?? idx + 1,
              label: c.label,
              accountId: c.accountId || null,
              amount: c.amount,
              taxRate: c.taxRate ?? 0,
            })),
          });
        }
      }
      // Edit-after-post: re-post the bill's GL + inventory from the freshly-edited
      // lines/charges (the old entry + cost layers were reversed above). No PO
      // receipt — edit-after-post is restricted to non-PO bills.
      if (isPostedEdit) {
        const finalized = await tx.bill.findFirst({
          where: { id, organizationId: orgId },
          include: { lines: true, charges: true },
        });
        if (finalized) await postBillToLedger(tx, orgId, finalized as any);
      }

      // Recognize GL + inventory when the bill is finalized (DRAFT -> OPEN),
      // unless the approval engine routes the finalize for approval first.
      if (existing.status === 'DRAFT' && header.status === 'OPEN') {
        const routed = await routeForApproval(tx, {
          orgId,
          userId,
          documentType: 'BILL',
          documentId: id,
        });
        if (routed) {
          // HELD for approval: the header update above already stamped
          // status='OPEN'; override it back to PENDING_APPROVAL and post NO GL.
          await tx.bill.update({
            where: { id, organizationId: orgId },
            data: { status: 'PENDING_APPROVAL', updatedAt: new Date() },
          });
        } else {
          const finalized = await tx.bill.findFirst({
            where: { id, organizationId: orgId },
            include: { lines: true, charges: true },
          });
          if (finalized) {
            // Refuse to post into a closed/locked accounting period (mirrors the
            // create-as-OPEN path in bills/route.ts).
            await assertPeriodOpen(tx, orgId, finalized.issueDate ? new Date(finalized.issueDate) : new Date(), dateOverride);
            // Apply the PO receipt on this DRAFT -> OPEN finalize, exactly once.
            // For a direct-bill-from-PO created as DRAFT the receivedQty increment
            // was deferred to finalize and lands here. For a goods-receipt bill
            // (receivedQty already incremented + inventory lots booked at receipt)
            // applyBillPoReceipt detects the existing lots and no-ops, so the
            // receipt never double-counts. Runs BEFORE postBillToLedger books
            // this finalize's lots.
            await applyBillPoReceipt(tx, orgId, id);
            await postBillToLedger(tx, orgId, finalized as any);
          }
        }
      }
      return tx.bill.findFirst({
        where: { id, organizationId: orgId },
        include: { vendor: true, lines: true, charges: true, attachments: true },
      });
    });
    if (!updated) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    // For an edit-after-post, log the full before→after so the journal re-post is
    // attributable (who changed what); a plain draft edit logs the submitted body.
    logAudit({
      orgId, actorId: req.headers.get('x-user-id'), entityType: 'Bill', entityId: id, action: 'UPDATE',
      payload: postedEditBefore ? { reposted: true, before: postedEditBefore, after: body } : body,
    });
    return withCors(NextResponse.json(updated));
  } catch (error) {
    if (error instanceof ApiError) {
      return withCors(NextResponse.json({ error: error.message }, { status: error.status }));
    }
    if (isFakturDuplicate(error)) {
      return withCors(NextResponse.json({ error: 'Supplier invoice # is already recorded for this vendor.' }, { status: 409 }));
    }
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});

export const DELETE = withPermission({ module: 'AP_BILLS', action: 'delete' }, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id')!;
  try {
    const existing = await prisma.bill.findFirst({ where: { id, organizationId: orgId }, select: { id: true, status: true } });
    if (!existing) {
      return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    }
    if (existing.status !== 'DRAFT') {
      return withCors(NextResponse.json({ error: 'Only DRAFT bills can be deleted' }, { status: 403 }));
    }
    await prisma.bill.update({ where: { id, organizationId: orgId }, data: { deletedAt: new Date() } });
    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Bill', entityId: id, action: 'DELETE', payload: null });
    return withCors(NextResponse.json({ deleted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
});

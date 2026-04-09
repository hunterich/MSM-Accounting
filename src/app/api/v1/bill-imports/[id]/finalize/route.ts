import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';
import { billImportReviewDataSchema, finalizeBillImportInputSchema } from '@/types/api';
import { createBillRecord } from '@/lib/bills';
import { normalizeSupplierLabel, summarizeBillImportReview } from '@/lib/bill-imports';

export const runtime = 'nodejs';

const decimalToNumber = (value: unknown) => Number(value ?? 0);

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const orgId = request.headers.get('x-org-id');
    const userId = request.headers.get('x-user-id');
    if (!orgId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const { id } = await params;
    const rawBody = await request.json().catch(() => ({}));
    const parsedBody = finalizeBillImportInputSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return withCors(NextResponse.json({
        error: parsedBody.error.issues[0]?.message || 'Invalid finalize payload',
        issues: parsedBody.error.issues,
      }, { status: 400 }));
    }

    const session = await prisma.billImportSession.findFirst({
      where: { id, organizationId: orgId },
      include: {
        vendor: { select: { id: true, name: true, defaultApAccountId: true } },
      },
    });

    if (!session) {
      return withCors(NextResponse.json({ error: 'Bill import session not found' }, { status: 404 }));
    }

    if (session.createdBillId) {
      return withCors(NextResponse.json({ error: 'This import session has already been finalized' }, { status: 409 }));
    }

    const sessionReviewData = session.normalizedData
      ? billImportReviewDataSchema.safeParse(session.normalizedData)
      : null;

    const reviewDataResult = parsedBody.data.reviewData
      ? billImportReviewDataSchema.safeParse(parsedBody.data.reviewData)
      : sessionReviewData;

    if (!reviewDataResult?.success) {
      return withCors(NextResponse.json({ error: 'Bill import session is missing review data' }, { status: 400 }));
    }

    const reviewData = reviewDataResult.data;
    const summary = summarizeBillImportReview(reviewData);
    if (!summary.readyToImport) {
      return withCors(NextResponse.json({
        error: 'Bill import review is incomplete. Assign a vendor, issue date, and item or account for each line before importing.',
      }, { status: 400 }));
    }

    const vendorId = reviewData.vendorId || null;
    if (!vendorId) {
      return withCors(NextResponse.json({ error: 'Vendor is required before importing' }, { status: 400 }));
    }

    const [vendor, items, accounts] = await Promise.all([
      prisma.vendor.findFirst({
        where: { id: vendorId, organizationId: orgId, status: 'ACTIVE' },
        select: { id: true, name: true, defaultApAccountId: true },
      }),
      prisma.item.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, sku: true, name: true, unit: true, inventoryAccountId: true },
      }),
      prisma.account.findMany({
        where: {
          organizationId: orgId,
          isActive: true,
          isPostable: true,
        },
        select: { id: true, name: true, code: true },
      }),
    ]);

    if (!vendor) {
      return withCors(NextResponse.json({ error: 'Selected vendor was not found in this organization' }, { status: 404 }));
    }

    const itemMap = new Map(items.map((item) => [item.id, item]));
    const accountSet = new Set(accounts.map((account) => account.id));

    const normalizedLines = reviewData.lines.map((line, index) => {
      const item = line.itemId ? itemMap.get(line.itemId) : null;
      const accountId = line.accountId || item?.inventoryAccountId || '';

      if (line.itemId && !item) {
        throw new Error(`Selected item for line ${index + 1} was not found in this organization`);
      }

      if (!accountId || !accountSet.has(accountId)) {
        throw new Error(`Line ${index + 1} requires a valid expense or inventory account before import`);
      }

      const quantity = Number(line.quantity || 0);
      const price = Number(line.price || 0);
      const lineTotal = Number(line.lineTotal || quantity * price);

      return {
        lineNo: line.lineNo ?? index + 1,
        itemId: line.itemId || undefined,
        accountId,
        description: line.description,
        quantity,
        unit: line.unit || item?.unit || 'PCS',
        price,
        lineTotal,
      };
    });

    const subtotal = Number(reviewData.subtotal || normalizedLines.reduce((sum, line) => sum + line.lineTotal, 0));
    const taxAmount = Number(reviewData.taxAmount || 0);
    const totalAmount = Number(reviewData.totalAmount || subtotal + taxAmount);

    const createdBill = await prisma.$transaction(async (tx) => {
      const bill = await createBillRecord(tx, orgId, {
        organizationId: orgId,
        vendorId,
        issueDate: reviewData.issueDate,
        dueDate: reviewData.dueDate || undefined,
        status: 'DRAFT',
        apAccountId: vendor.defaultApAccountId || undefined,
        taxRate: Number(reviewData.taxRate || 0),
        subtotal,
        taxAmount,
        totalAmount,
        notes: reviewData.notes || `Imported from supplier PDF: ${session.sourceFileName}`,
        lines: normalizedLines,
      }, {
        attachment: session.sourceStorageKey ? {
          fileName: session.sourceFileName,
          fileSizeKb: decimalToNumber(session.sourceFileSizeKb),
          mimeType: session.sourceMimeType,
          storageKey: session.sourceStorageKey,
        } : undefined,
      });

      await Promise.all(
        reviewData.lines
          .filter((line) => line.supplierLabel && (line.itemId || line.accountId))
          .map((line) =>
            tx.vendorDocumentMapping.upsert({
              where: {
                organizationId_vendorId_normalizedSupplierLabel: {
                  organizationId: orgId,
                  vendorId,
                  normalizedSupplierLabel: normalizeSupplierLabel(line.supplierLabel || line.description),
                },
              },
              update: {
                supplierLabel: line.supplierLabel || line.description,
                itemId: line.itemId || null,
                accountId: line.accountId || null,
              },
              create: {
                organizationId: orgId,
                vendorId,
                supplierLabel: line.supplierLabel || line.description,
                normalizedSupplierLabel: normalizeSupplierLabel(line.supplierLabel || line.description),
                itemId: line.itemId || null,
                accountId: line.accountId || null,
              },
            }),
          ),
      );

      await tx.billImportSession.update({
        where: { id: session.id },
        data: {
          vendorId,
          extractionStatus: 'FINALIZED',
          reviewStatus: 'IMPORTED',
          normalizedData: {
            ...reviewData,
            needsReviewCount: 0,
            readyToImport: true,
          },
          createdBillId: bill!.id,
        },
      });

      return bill;
    });

    logAudit({
      orgId,
      actorId: userId,
      entityType: 'BillImportSession',
      entityId: session.id,
      action: 'UPDATE',
      payload: {
        createdBillId: createdBill!.id,
        createdBillNumber: createdBill!.number,
      },
    });

    logAudit({
      orgId,
      actorId: userId,
      entityType: 'Bill',
      entityId: createdBill!.id,
      action: 'CREATE',
      payload: {
        number: createdBill!.number,
        importedFromSessionId: session.id,
      },
    });

    return withCors(NextResponse.json({
      bill: createdBill,
      sessionId: session.id,
    }, { status: 201 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to finalize bill import';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

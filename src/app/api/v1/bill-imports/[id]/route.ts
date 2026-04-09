import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';
import { updateBillImportSessionInputSchema } from '@/types/api';
import { summarizeBillImportReview } from '@/lib/bill-imports';

export const runtime = 'nodejs';

const findSession = (id: string, orgId: string) =>
  prisma.billImportSession.findFirst({
    where: { id, organizationId: orgId },
    include: {
      vendor: { select: { id: true, name: true, code: true } },
      createdBill: { select: { id: true, number: true, status: true } },
    },
  });

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const orgId = request.headers.get('x-org-id');
    if (!orgId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const { id } = await params;
    const session = await findSession(id, orgId);
    if (!session) {
      return withCors(NextResponse.json({ error: 'Bill import session not found' }, { status: 404 }));
    }

    return withCors(NextResponse.json(session));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load bill import';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function PUT(
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
    const rawBody = await request.json();
    const parsed = updateBillImportSessionInputSchema.safeParse(rawBody);

    if (!parsed.success) {
      return withCors(NextResponse.json({
        error: parsed.error.issues[0]?.message || 'Invalid bill import payload',
        issues: parsed.error.issues,
      }, { status: 400 }));
    }

    const summary = summarizeBillImportReview(parsed.data.reviewData);
    const reviewData = {
      ...parsed.data.reviewData,
      needsReviewCount: summary.needsReviewCount,
      readyToImport: summary.readyToImport,
    };

    const existing = await prisma.billImportSession.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, createdBillId: true },
    });

    if (!existing) {
      return withCors(NextResponse.json({ error: 'Bill import session not found' }, { status: 404 }));
    }

    if (existing.createdBillId) {
      return withCors(NextResponse.json({ error: 'Imported bill session can no longer be edited' }, { status: 409 }));
    }

    await prisma.billImportSession.update({
      where: { id },
      data: {
        vendorId: reviewData.vendorId || null,
        vendorConfidence: reviewData.vendorSuggestion?.confidence ?? null,
        vendorMatchReason: reviewData.vendorSuggestion?.reason ?? null,
        reviewStatus: reviewData.readyToImport ? 'READY_TO_IMPORT' : 'NEEDS_REVIEW',
        normalizedData: reviewData,
      },
    });

    logAudit({
      orgId,
      actorId: userId,
      entityType: 'BillImportSession',
      entityId: id,
      action: 'UPDATE',
      payload: {
        reviewStatus: reviewData.readyToImport ? 'READY_TO_IMPORT' : 'NEEDS_REVIEW',
        vendorId: reviewData.vendorId,
        lineCount: reviewData.lines.length,
      },
    });

    const session = await findSession(id, orgId);
    return withCors(NextResponse.json(session));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update bill import';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { analyzeBillImportText, extractPdfText, persistBillImportFile } from '@/lib/bill-imports';
import { logAudit } from '@/lib/api-utils';

export const runtime = 'nodejs';

const createSessionResponse = async (id: string, organizationId: string) => {
  return prisma.billImportSession.findFirst({
    where: { id, organizationId },
    include: {
      vendor: { select: { id: true, name: true, code: true } },
      createdBill: { select: { id: true, number: true, status: true } },
    },
  });
};

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function POST(request: NextRequest) {
  try {
    const orgId = request.headers.get('x-org-id');
    const userId = request.headers.get('x-user-id');

    if (!orgId) {
      return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return withCors(NextResponse.json({ error: 'PDF file is required' }, { status: 400 }));
    }

    const fileName = file.name?.trim() || 'supplier-bill.pdf';
    const mimeType = file.type?.trim() || 'application/pdf';
    const looksLikePdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
    if (!looksLikePdf) {
      return withCors(NextResponse.json({ error: 'Only PDF uploads are supported' }, { status: 400 }));
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength === 0) {
      return withCors(NextResponse.json({ error: 'Uploaded PDF is empty' }, { status: 400 }));
    }

    const storage = await persistBillImportFile({
      organizationId: orgId,
      fileName,
      buffer,
    });

    let extractedText = '';
    try {
      extractedText = await extractPdfText(buffer);
    } catch (error) {
      return withCors(NextResponse.json({
        error: error instanceof Error ? `Failed to parse PDF: ${error.message}` : 'Failed to parse PDF',
      }, { status: 422 }));
    }

    if (!extractedText.trim()) {
      return withCors(NextResponse.json({ error: 'No readable text found in the uploaded PDF' }, { status: 422 }));
    }

    const [vendors, items, mappings] = await Promise.all([
      prisma.vendor.findMany({
        where: { organizationId: orgId, status: 'ACTIVE' },
        select: { id: true, name: true, npwp: true, defaultApAccountId: true },
        orderBy: { name: 'asc' },
      }),
      prisma.item.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, sku: true, name: true, unit: true, inventoryAccountId: true },
        orderBy: { name: 'asc' },
      }),
      prisma.vendorDocumentMapping.findMany({
        where: { organizationId: orgId },
        select: {
          vendorId: true,
          supplierLabel: true,
          normalizedSupplierLabel: true,
          itemId: true,
          accountId: true,
        },
      }),
    ]);

    const analysis = analyzeBillImportText({
      text: extractedText,
      fileName,
      vendors,
      items,
      mappings,
    });

    const session = await prisma.billImportSession.create({
      data: {
        organizationId: orgId,
        createdById: userId || null,
        sourceFileName: fileName,
        sourceMimeType: mimeType,
        sourceFileSizeKb: storage.fileSizeKb,
        sourceStorageKey: storage.storageKey,
        sourceText: analysis.text,
        extractionStatus: 'EXTRACTED',
        reviewStatus: analysis.reviewData.readyToImport ? 'READY_TO_IMPORT' : 'NEEDS_REVIEW',
        vendorId: analysis.reviewData.vendorId,
        vendorConfidence: analysis.reviewData.vendorSuggestion?.confidence ?? null,
        vendorMatchReason: analysis.reviewData.vendorSuggestion?.reason ?? null,
        extractedData: analysis.extractedData,
        normalizedData: analysis.reviewData,
      },
    });

    logAudit({
      orgId,
      actorId: userId,
      entityType: 'BillImportSession',
      entityId: session.id,
      action: 'CREATE',
      payload: {
        fileName,
        sourceStorageKey: storage.storageKey,
        vendorId: analysis.reviewData.vendorId,
        readyToImport: analysis.reviewData.readyToImport,
      },
    });

    const response = await createSessionResponse(session.id, orgId);
    return withCors(NextResponse.json(response, { status: 201 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create bill import';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

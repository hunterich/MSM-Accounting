import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { analyzeBillImportText, extractPdfText, persistBillImportFile } from '@/lib/bill-imports';
import { logAudit, requireAuth, ok, err, withHandler } from '@/lib/api-utils';
import {
  extractImageText,
  isSupportedImageType,
  isSupportedImportFile,
  parseFakturPajakFields,
  validateImageUpload,
} from '@/lib/faktur-ocr';

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

export const POST = withHandler(async function POST(request: NextRequest) {
  const { orgId, userId } = requireAuth(request);

  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return err('A file (PDF or image) is required', 400);
  }

  const fileName = file.name?.trim() || 'supplier-bill.pdf';
  const mimeType = file.type?.trim() || 'application/pdf';

  // Validate file type — accept PDFs and images (JPEG, PNG, TIFF, WebP, BMP)
  if (!isSupportedImportFile(mimeType)) {
    return err('Unsupported file type. Upload a PDF or image (JPEG, PNG, TIFF).', 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength === 0) {
    return err('Uploaded file is empty', 400);
  }

  // Image-specific validation
  if (isSupportedImageType(mimeType)) {
    const validationError = validateImageUpload(file);
    if (validationError) return err(validationError, 400);
  }

  const storage = await persistBillImportFile({
    organizationId: orgId,
    fileName,
    buffer,
  });

  // Extract text — PDF uses pdf-parse, images use Tesseract OCR
  let extractedText = '';
  const isImage = isSupportedImageType(mimeType);

  try {
    if (isImage) {
      extractedText = await extractImageText(buffer);
    } else {
      extractedText = await extractPdfText(buffer);
    }
  } catch (parseError) {
    const detail = parseError instanceof Error ? parseError.message : String(parseError);
    return err(`Failed to parse ${isImage ? 'image' : 'PDF'}: ${detail}`, 422);
  }

  if (!extractedText.trim()) {
    return err(
      isImage
        ? 'No readable text found in the uploaded image. Ensure the image is clear and well-lit.'
        : 'No readable text found in the uploaded PDF',
      422,
    );
  }

  // Parse faktur-specific fields from image uploads
  const fakturFields = isImage ? parseFakturPajakFields(extractedText) : null;

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

  // Merge faktur-specific data if available
  if (fakturFields) {
    if (fakturFields.tanggalFaktur && !analysis.reviewData.issueDate) {
      analysis.reviewData.issueDate = fakturFields.tanggalFaktur;
    }
    if (fakturFields.dpp > 0 && analysis.reviewData.subtotal === 0) {
      analysis.reviewData.subtotal = fakturFields.dpp;
    }
    if (fakturFields.ppn > 0 && analysis.reviewData.taxAmount === 0) {
      analysis.reviewData.taxAmount = fakturFields.ppn;
      if (fakturFields.dpp > 0) {
        analysis.reviewData.taxRate = Math.round((fakturFields.ppn / fakturFields.dpp) * 10000) / 100;
      }
    }
    if (fakturFields.dpp > 0 || fakturFields.ppn > 0) {
      analysis.reviewData.totalAmount = analysis.reviewData.totalAmount || (fakturFields.dpp + fakturFields.ppn);
    }
    // Enrich extracted data with faktur fields
    (analysis.extractedData as Record<string, unknown>).nomorFaktur = fakturFields.nomorFaktur;
    (analysis.extractedData as Record<string, unknown>).npwpPenjual = fakturFields.npwpPenjual;
    (analysis.extractedData as Record<string, unknown>).sourceType = 'image_ocr';
  }

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
      sourceType: isImage ? 'image_ocr' : 'pdf',
      sourceStorageKey: storage.storageKey,
      vendorId: analysis.reviewData.vendorId,
      readyToImport: analysis.reviewData.readyToImport,
      nomorFaktur: fakturFields?.nomorFaktur ?? null,
    },
  });

  const response = await createSessionResponse(session.id, orgId);
  return ok(response, 201);
});

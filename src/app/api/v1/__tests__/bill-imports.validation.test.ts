import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => {
  const prisma = {
    billImportSession: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    vendorDocumentMapping: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    vendor: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    item: {
      findMany: vi.fn(),
    },
    account: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
  };

  return { prisma };
});

vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));

vi.mock('@/lib/api-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-utils')>();
  return {
    ...actual,
    logAudit: vi.fn(),
  };
});

vi.mock('@/lib/bills', () => ({
  createBillRecord: vi.fn(),
}));

vi.mock('@/lib/bill-imports', () => ({
  analyzeBillImportText: vi.fn(),
  extractPdfText: vi.fn(),
  persistBillImportFile: vi.fn(async () => ({ storageKey: '.data/bill-imports/org-a/test.pdf', fileSizeKb: 12 })),
  summarizeBillImportReview: vi.fn((reviewData: any) => {
    const invalidLines = (reviewData.lines || []).filter((line: any) => !line.description || (!line.itemId && !line.accountId));
    return {
      needsReviewCount: invalidLines.length + (!reviewData.vendorId || !reviewData.issueDate ? 1 : 0),
      readyToImport: Boolean(reviewData.vendorId && reviewData.issueDate && invalidLines.length === 0 && reviewData.lines?.length),
    };
  }),
  normalizeSupplierLabel: vi.fn((value: string) => value.toLowerCase().trim()),
}));

import { prisma } from '@/lib/prisma';
import { extractPdfText } from '@/lib/bill-imports';
import { POST as createBillImport } from '../bill-imports/route';
import { PUT as updateBillImport } from '../bill-imports/[id]/route';
import { POST as finalizeBillImport } from '../bill-imports/[id]/finalize/route';

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function makeJsonReq(path: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      'x-org-id': 'org-a',
      'x-user-id': 'user-1', 'x-role-type': 'ADMIN',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function makeFormReq(path: string, formData: FormData) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'x-org-id': 'org-a',
      'x-user-id': 'user-1', 'x-role-type': 'ADMIN',
    },
    body: formData,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bill import route validation', () => {
  it('rejects malformed PDFs before creating an import session', async () => {
    vi.mocked(extractPdfText).mockRejectedValue(new Error('Corrupt PDF stream'));

    const formData = new FormData();
    formData.append('file', new File(['invalid'], 'supplier.pdf', { type: 'application/pdf' }));

    const res = await createBillImport(makeFormReq('/api/v1/bill-imports', formData));

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to parse PDF: Corrupt PDF stream' });
    expect(prisma.billImportSession.create).not.toHaveBeenCalled();
  });

  it('rejects invalid review payloads before updating the session', async () => {
    const res = await updateBillImport(
      makeJsonReq('/api/v1/bill-imports/session-1', 'PUT', {
        reviewData: {
          vendorId: 'vendor-1',
          issueDate: '2026-04-09',
          lines: 'not-an-array',
        },
      }),
      params('session-1'),
    );

    expect(res.status).toBe(400);
    expect(prisma.billImportSession.update).not.toHaveBeenCalled();
  });

  it('blocks finalization when review data is still incomplete', async () => {
    vi.mocked(prisma.billImportSession.findFirst).mockResolvedValue({
      id: 'session-1',
      organizationId: 'org-a',
      createdBillId: null,
      sourceFileName: 'supplier.pdf',
      sourceStorageKey: '.data/bill-imports/org-a/test.pdf',
      sourceFileSizeKb: 12,
      sourceMimeType: 'application/pdf',
      normalizedData: {
        vendorId: 'vendor-1',
        issueDate: '2026-04-09',
        dueDate: '',
        taxRate: 0,
        taxAmount: 0,
        subtotal: 100000,
        totalAmount: 100000,
        notes: 'Imported',
        lines: [{
          lineNo: 1,
          description: 'Paper',
          quantity: 1,
          unit: 'PCS',
          price: 100000,
          lineTotal: 100000,
          itemId: '',
          accountId: '',
          rawText: 'Paper 1 100000 100000',
          supplierLabel: 'Paper',
          reviewStatus: 'needs_review',
        }],
        needsReviewCount: 1,
        readyToImport: false,
      },
      vendor: { id: 'vendor-1', name: 'Vendor A', defaultApAccountId: 'ap-1' },
    } as never);

    const res = await finalizeBillImport(
      makeJsonReq('/api/v1/bill-imports/session-1/finalize', 'POST', {}),
      params('session-1'),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Bill import review is incomplete. Assign a vendor, issue date, and item or account for each line before importing.',
    });
  });
});

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, withHandler } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

// All approval document types (mirrors the ApprovalDocumentType enum in schema.prisma).
const DOCUMENT_TYPES = [
  'INVOICE',
  'PURCHASE_ORDER',
  'BILL',
  'SALES_ORDER',
  'PAYROLL_RUN',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'SALES_RETURN',
  'PURCHASE_RETURN',
  'AR_PAYMENT',
  'AP_PAYMENT',
  'STOCK_ADJUSTMENT',
] as const;

type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * Normalized, type-agnostic summary the UI renders for every pending request.
 * `number` is the only must-have; `amount`/`party` may be null when a model
 * lacks a sensible field/relation (e.g. SalesOrder has no stored total).
 */
interface DocumentSummary {
  id: string;
  number: string;
  amount: number | null;
  party: string | null;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Batch-fetch the documents for one type and return a map of
 * documentId → normalized summary. Each branch selects only the
 * fields/relations that actually exist on that Prisma model.
 */
async function fetchSummaries(
  type: DocumentType,
  ids: string[],
): Promise<Record<string, DocumentSummary>> {
  if (ids.length === 0) return {};
  const where = { id: { in: ids } };
  const map: Record<string, DocumentSummary> = {};

  switch (type) {
    case 'INVOICE': {
      const rows = await prisma.salesInvoice.findMany({
        where,
        select: { id: true, number: true, totalAmount: true, customer: { select: { name: true } } },
      });
      for (const r of rows) {
        map[r.id] = {
          id: r.id,
          number: r.number ?? '',
          amount: toNumber(r.totalAmount),
          party: r.customer?.name ?? null,
        };
      }
      break;
    }
    case 'PURCHASE_ORDER': {
      const rows = await prisma.purchaseOrder.findMany({
        where,
        select: { id: true, number: true, totalAmount: true, vendor: { select: { name: true } } },
      });
      for (const r of rows) {
        map[r.id] = {
          id: r.id,
          number: r.number ?? '',
          amount: toNumber(r.totalAmount),
          party: r.vendor?.name ?? null,
        };
      }
      break;
    }
    case 'BILL': {
      const rows = await prisma.bill.findMany({
        where,
        select: { id: true, number: true, totalAmount: true, vendor: { select: { name: true } } },
      });
      for (const r of rows) {
        map[r.id] = {
          id: r.id,
          number: r.number ?? '',
          amount: toNumber(r.totalAmount),
          party: r.vendor?.name ?? null,
        };
      }
      break;
    }
    case 'SALES_ORDER': {
      // SalesOrder has no stored total and no customer relation — only customerName.
      const rows = await prisma.salesOrder.findMany({
        where,
        select: { id: true, number: true, customerName: true },
      });
      for (const r of rows) {
        map[r.id] = {
          id: r.id,
          number: r.number ?? '',
          amount: null,
          party: r.customerName ?? null,
        };
      }
      break;
    }
    case 'PAYROLL_RUN': {
      // No counterparty; use totalNet as the amount and month/year as the label.
      const rows = await prisma.payrollRun.findMany({
        where,
        select: { id: true, number: true, totalNet: true, month: true, year: true },
      });
      for (const r of rows) {
        const period =
          r.month != null && r.year != null
            ? `${String(r.month).padStart(2, '0')}/${r.year}`
            : null;
        map[r.id] = {
          id: r.id,
          number: r.number ?? '',
          amount: toNumber(r.totalNet),
          party: period,
        };
      }
      break;
    }
    case 'CREDIT_NOTE': {
      const rows = await prisma.creditNote.findMany({
        where,
        select: { id: true, number: true, amount: true, customer: { select: { name: true } } },
      });
      for (const r of rows) {
        map[r.id] = {
          id: r.id,
          number: r.number ?? '',
          amount: toNumber(r.amount),
          party: r.customer?.name ?? null,
        };
      }
      break;
    }
    case 'DEBIT_NOTE': {
      const rows = await prisma.debitNote.findMany({
        where,
        select: { id: true, number: true, amount: true, vendor: { select: { name: true } } },
      });
      for (const r of rows) {
        map[r.id] = {
          id: r.id,
          number: r.number ?? '',
          amount: toNumber(r.amount),
          party: r.vendor?.name ?? null,
        };
      }
      break;
    }
    case 'SALES_RETURN': {
      const rows = await prisma.salesReturn.findMany({
        where,
        select: { id: true, number: true, totalAmount: true, customer: { select: { name: true } } },
      });
      for (const r of rows) {
        map[r.id] = {
          id: r.id,
          number: r.number ?? '',
          amount: toNumber(r.totalAmount),
          party: r.customer?.name ?? null,
        };
      }
      break;
    }
    case 'PURCHASE_RETURN': {
      const rows = await prisma.purchaseReturn.findMany({
        where,
        select: { id: true, number: true, totalAmount: true, vendor: { select: { name: true } } },
      });
      for (const r of rows) {
        map[r.id] = {
          id: r.id,
          number: r.number ?? '',
          amount: toNumber(r.totalAmount),
          party: r.vendor?.name ?? null,
        };
      }
      break;
    }
    case 'AR_PAYMENT': {
      const rows = await prisma.aRPayment.findMany({
        where,
        select: { id: true, number: true, totalAmount: true, customer: { select: { name: true } } },
      });
      for (const r of rows) {
        map[r.id] = {
          id: r.id,
          number: r.number ?? '',
          amount: toNumber(r.totalAmount),
          party: r.customer?.name ?? null,
        };
      }
      break;
    }
    case 'AP_PAYMENT': {
      const rows = await prisma.aPPayment.findMany({
        where,
        select: { id: true, number: true, totalAmount: true, vendor: { select: { name: true } } },
      });
      for (const r of rows) {
        map[r.id] = {
          id: r.id,
          number: r.number ?? '',
          amount: toNumber(r.totalAmount),
          party: r.vendor?.name ?? null,
        };
      }
      break;
    }
    case 'STOCK_ADJUSTMENT': {
      // No single monetary total; use reason as the party label.
      const rows = await prisma.stockAdjustment.findMany({
        where,
        select: { id: true, number: true, reason: true },
      });
      for (const r of rows) {
        map[r.id] = {
          id: r.id,
          number: r.number ?? '',
          amount: null,
          party: r.reason ?? null,
        };
      }
      break;
    }
  }

  return map;
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const { searchParams } = new URL(req.url);
  const rawType = searchParams.get('type');
  const typeFilter = DOCUMENT_TYPES.includes(rawType as DocumentType)
    ? (rawType as DocumentType)
    : null;

  const where: Record<string, unknown> = {
    organizationId: orgId,
    status: 'PENDING',
  };
  if (typeFilter) {
    where.documentType = typeFilter;
  }

  const approvalRequests = await prisma.approvalRequest.findMany({
    where,
    orderBy: { requestedAt: 'desc' },
    include: {
      requestedBy: {
        select: { id: true, fullName: true },
      },
      organization: {
        select: { id: true },
      },
    },
  });

  // Group document ids by type, then batch-fetch a normalized summary for each type present.
  const idsByType = new Map<DocumentType, string[]>();
  for (const r of approvalRequests) {
    const type = r.documentType as DocumentType;
    const list = idsByType.get(type) ?? [];
    list.push(r.documentId);
    idsByType.set(type, list);
  }

  const summaryEntries = await Promise.all(
    [...idsByType.entries()].map(async ([type, ids]) => [type, await fetchSummaries(type, ids)] as const),
  );
  const summariesByType = new Map<DocumentType, Record<string, DocumentSummary>>(summaryEntries);

  const result = approvalRequests.map((r) => {
    const summary = summariesByType.get(r.documentType as DocumentType)?.[r.documentId];
    const document: DocumentSummary = summary ?? {
      id: r.documentId,
      number: '',
      amount: null,
      party: null,
    };
    return { ...r, document };
  });

  return ok({ data: result, total: result.length });
});

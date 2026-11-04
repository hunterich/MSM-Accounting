import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withPermission } from '@/lib/authz';
import { requireAuth, ApiError } from '@/lib/api-utils';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { getInvoiceAccessContext } from '@/lib/document-access';
import { invoiceListWhere } from '@/lib/invoice-list-filter';
import { invoiceExportCsv } from '@/lib/invoice-export-csv';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }
// Fail explicitly instead of returning an incomplete file or exhausting the server.
const MAX_EXPORT_ROWS = 50_000;

export const GET = withPermission({ module: 'AR_INVOICES', action: 'view' }, async (req: NextRequest) => {
  const { orgId, userId } = requireAuth(req);
  const access = await getInvoiceAccessContext(orgId, userId);
  const where = invoiceListWhere(new URL(req.url).searchParams, orgId, access);
  const data = await prisma.$transaction(async tx => {
    const count = await tx.salesInvoice.count({ where });
    if (count > MAX_EXPORT_ROWS) throw new ApiError('Too many invoices to export at once. Narrow the filters and try again.', 413);
    return tx.salesInvoice.findMany({
      where, orderBy: [{ issueDate: 'desc' }, { id: 'desc' }],
      select: { number: true, issueDate: true, dueDate: true, status: true,
        currency: true, totalAmount: true, customer: { select: { name: true, code: true } } },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
  return withCors(new NextResponse(invoiceExportCsv(data), { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="invoices-filtered.csv"',
    'Cache-Control': 'no-store',
  } }));
});

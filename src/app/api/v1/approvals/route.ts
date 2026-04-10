import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { err, ok, withHandler } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  const { searchParams } = new URL(req.url);
  const typeFilter = searchParams.get('type') as 'INVOICE' | 'PURCHASE_ORDER' | null;

  const where: Record<string, unknown> = {
    organizationId: orgId,
    status: 'PENDING',
  };
  if (typeFilter === 'INVOICE' || typeFilter === 'PURCHASE_ORDER') {
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

  const invoiceIds = approvalRequests
    .filter((r) => r.documentType === 'INVOICE')
    .map((r) => r.documentId);
  const poIds = approvalRequests
    .filter((r) => r.documentType === 'PURCHASE_ORDER')
    .map((r) => r.documentId);

  const [invoices, pos] = await Promise.all([
    invoiceIds.length > 0
      ? prisma.salesInvoice.findMany({
          where: { id: { in: invoiceIds } },
          select: {
            id: true,
            number: true,
            totalAmount: true,
            customer: { select: { name: true } },
          },
        })
      : [],
    poIds.length > 0
      ? prisma.purchaseOrder.findMany({
          where: { id: { in: poIds } },
          select: {
            id: true,
            number: true,
            totalAmount: true,
            vendor: { select: { name: true } },
          },
        })
      : [],
  ]);

  const invoiceMap = Object.fromEntries(invoices.map((i) => [i.id, i]));
  const poMap = Object.fromEntries(pos.map((p) => [p.id, p]));

  const result = approvalRequests.map((r) => ({
    ...r,
    document:
      r.documentType === 'INVOICE' ? invoiceMap[r.documentId] : poMap[r.documentId],
  }));

  return ok({ data: result, total: result.length });
});

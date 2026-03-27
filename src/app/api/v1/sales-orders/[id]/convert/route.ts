// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse, withCors } from '@/lib/cors';
import { logAudit } from '@/lib/api-utils';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

const INVOICE_PREFIX = 'INV';
const INVOICE_DIGITS = 6;

const hashLockKey = (input: string): number => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
};

const nextInvoiceNumber = async (tx: any, organizationId: string): Promise<string> => {
  const lockKey = hashLockKey(`invoice-seq:${organizationId}`);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
  const rows = await tx.$queryRaw<Array<{ max_seq: number | null }>>`
    SELECT MAX(CAST(SUBSTRING("number" FROM '^INV-(\\d+)$') AS INTEGER)) AS max_seq
    FROM "SalesInvoice"
    WHERE "organizationId" = ${organizationId}
      AND "number" LIKE ${'INV-%'}
  `;
  const nextSeq = Number(rows[0]?.max_seq ?? 0) + 1;
  return `${INVOICE_PREFIX}-${String(nextSeq).padStart(INVOICE_DIGITS, '0')}`;
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const orgId  = req.headers.get('x-org-id');
    const userId = req.headers.get('x-user-id');
    if (!orgId) return withCors(NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }));

    const so = await prisma.salesOrder.findFirst({
      where: { id: params.id, organizationId: orgId },
      include: { items: true },
    });
    if (!so) return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }));
    if (so.status === 'INVOICED')   return withCors(NextResponse.json({ error: 'Sales order already invoiced' }, { status: 400 }));
    if (so.status === 'CANCELLED')  return withCors(NextResponse.json({ error: 'Cannot convert a cancelled sales order' }, { status: 400 }));
    if (!so.customerId) return withCors(NextResponse.json({ error: 'Sales order must have a customer to convert' }, { status: 400 }));

    const result = await prisma.$transaction(async (tx) => {
      const number = await nextInvoiceNumber(tx, orgId);

      const invoice = await tx.salesInvoice.create({
        data: {
          organizationId: orgId,
          createdById:    userId || null,
          number,
          customerId:     so.customerId!,
          invoiceType:    'Sales Invoice',
          issueDate:      new Date(),
          status:         'DRAFT',
          notes:          so.notes || null,
          soId:           so.id,
          currency:       'IDR',
          subtotal:       0,
          discountPct:    0,
          discountAmount: 0,
          taxEnabled:     true,
          taxInclusive:   false,
          taxRate:        11,
          taxAmount:      0,
          totalAmount:    0,
          lines: {
            create: so.items.map((item, idx) => ({
              lineNo:       idx + 1,
              itemId:       item.productId || null,
              code:         item.code      || null,
              description:  item.description,
              quantity:     item.quantity,
              unit:         item.unit || 'PCS',
              price:        item.price,
              discountPct:  item.discount,
              lineSubtotal: Number(item.quantity) * Number(item.price),
            })),
          },
        },
        include: { lines: true },
      });

      await tx.salesOrder.update({
        where: { id: so.id },
        data:  { status: 'INVOICED', invoiceId: invoice.id },
      });

      return invoice;
    });

    logAudit({ orgId, actorId: userId, entityType: 'SalesInvoice', entityId: result.id, action: 'CREATE', payload: { fromSO: so.id } });
    return withCors(NextResponse.json({ invoice: result, salesOrderId: so.id }, { status: 201 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to convert sales order';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

import type { Prisma } from '@prisma/client';
import { ApiError } from '../errors';
import { lockFinancialApprovalPeriod } from './financial-period';

/** Explicit submission is available even when automatic routing is disabled.
 * Invoice row -> period share lock -> request/status, all in one transaction.
 * The row lock also serializes with automatic routing and invoice posting.
 */
export async function submitInvoiceForApproval(tx: Prisma.TransactionClient, orgId: string, userId: string, id: string): Promise<string> {
  await tx.$queryRaw`SELECT "id" FROM "SalesInvoice" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`;
  const invoice = await tx.salesInvoice.findFirst({ where: { id, organizationId: orgId }, select: { status: true } });
  if (!invoice) throw new ApiError('Invoice not found', 404);
  if (invoice.status !== 'DRAFT') {
    throw new ApiError(`Invoice must be in DRAFT status to submit for approval (current: ${invoice.status})`, 400);
  }
  await lockFinancialApprovalPeriod(tx, orgId, 'INVOICE', id);
  const existing = await tx.approvalRequest.findFirst({
    where: { organizationId: orgId, documentType: 'INVOICE', documentId: id, status: 'PENDING' }, select: { id: true },
  });
  const approval = existing ?? await tx.approvalRequest.create({
    data: { organizationId: orgId, documentType: 'INVOICE', documentId: id, requestedById: userId, status: 'PENDING' },
    select: { id: true },
  });
  await tx.salesInvoice.update({ where: { id, organizationId: orgId }, data: { status: 'PENDING_APPROVAL', updatedAt: new Date() } });
  return approval.id;
}

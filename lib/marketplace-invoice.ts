import type { Prisma } from '@prisma/client';

/** Only persisted import provenance is evidence. Historical MANUAL rows need review. */
export async function marketplaceInvoiceStatus(tx: Prisma.TransactionClient, orgId: string, invoiceId: string): Promise<'MARKETPLACE' | 'NONE'> {
  const allocation = await tx.aRPaymentAllocation.findFirst({
    where: { invoiceId, invoice: { organizationId: orgId }, payment: { organizationId: orgId, source: 'MARKETPLACE_IMPORT', status: { not: 'VOID' } } },
    select: { id: true },
  });
  return allocation ? 'MARKETPLACE' : 'NONE';
}

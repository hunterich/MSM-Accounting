import type { Prisma } from '@prisma/client';
import { applyInvoiceAccessScope } from './document-access';

/** Shared by list and export so filters and own-invoice scope cannot drift. */
export function invoiceListWhere(
  params: URLSearchParams, orgId: string, access: { invoiceAccessScope: string; userId: string },
): Prisma.SalesInvoiceWhereInput {
  const where: Prisma.SalesInvoiceWhereInput = applyInvoiceAccessScope({ organizationId: orgId, deletedAt: null }, access);
  const status = params.get('status'), search = params.get('search');
  const dateFrom = params.get('dateFrom'), dateTo = params.get('dateTo'), customerId = params.get('customerId');
  if (status) where.status = status as Prisma.EnumInvoiceStatusFilter['equals'];
  if (search) where.OR = [
    { number: { contains: search, mode: 'insensitive' } },
    { customer: { name: { contains: search, mode: 'insensitive' } } },
    { poNumber: { contains: search, mode: 'insensitive' } },
    { trackingNumber: { contains: search, mode: 'insensitive' } },
    { shippingCarrier: { contains: search, mode: 'insensitive' } },
  ];
  if (dateFrom || dateTo) where.issueDate = {
    ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
    ...(dateTo ? { lt: new Date(new Date(dateTo).getTime() + 86400000) } : {}),
  };
  if (customerId) where.customerId = customerId;
  return where;
}

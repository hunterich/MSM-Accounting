import type { Prisma, PrismaClient } from '@prisma/client';
import { syncBillSettlementStatus, syncInvoiceSettlementStatus } from './settlement-status';

/** One-off, idempotent reconciliation of legacy open documents with linked notes. */
export async function backfillNoteSettlementStatus(
  db: PrismaClient,
  options: { apply?: boolean; organizationId?: string } = {},
) {
  const result = { invoices: { scanned: 0, paid: 0 }, bills: { scanned: 0, paid: 0 } };
  const invoiceWhere: Prisma.SalesInvoiceWhereInput = {
    organizationId: options.organizationId,
    status: { in: ['SENT', 'OVERDUE'] },
    creditNotes: { some: { organizationId: options.organizationId, status: 'APPLIED', settlementType: 'APPLY_TO_INVOICE' } },
  };
  const billWhere: Prisma.BillWhereInput = {
    organizationId: options.organizationId,
    status: { in: ['OPEN', 'PENDING', 'OVERDUE'] },
    debitNotes: { some: { organizationId: options.organizationId, status: 'APPLIED', settlementType: 'APPLY_TO_BILL' } },
  };
  // Keyset pagination remains stable as reconciled records leave the open set.
  for (const kind of ['invoices', 'bills'] as const) {
    let cursor: string | undefined;
    while (true) {
      const rows = kind === 'invoices'
        ? await db.salesInvoice.findMany({ where: { ...invoiceWhere, id: cursor ? { gt: cursor } : undefined }, orderBy: { id: 'asc' }, take: 100, select: { id: true, organizationId: true } })
        : await db.bill.findMany({ where: { ...billWhere, id: cursor ? { gt: cursor } : undefined }, orderBy: { id: 'asc' }, take: 100, select: { id: true, organizationId: true } });
      if (!rows.length) break;
      for (const row of rows) {
        result[kind].scanned++;
        const transition = await db.$transaction(async tx => {
          // Recheck eligibility under the same document lock used by live writes.
          // A concurrent void or settlement must not turn this into a reopening job.
          if (kind === 'invoices') {
            await tx.$queryRaw`SELECT "id" FROM "SalesInvoice" WHERE "id" = ${row.id} AND "organizationId" = ${row.organizationId} FOR UPDATE`;
            if (!await tx.salesInvoice.findFirst({ where: { ...invoiceWhere, id: row.id, organizationId: row.organizationId }, select: { id: true } })) return null;
            return syncInvoiceSettlementStatus(tx, row.organizationId, row.id, { dryRun: !options.apply });
          }
          await tx.$queryRaw`SELECT "id" FROM "Bill" WHERE "id" = ${row.id} AND "organizationId" = ${row.organizationId} FOR UPDATE`;
          if (!await tx.bill.findFirst({ where: { ...billWhere, id: row.id, organizationId: row.organizationId }, select: { id: true } })) return null;
          return syncBillSettlementStatus(tx, row.organizationId, row.id, { dryRun: !options.apply });
        });
        if (transition === 'PAID') result[kind].paid++;
      }
      cursor = rows[rows.length - 1].id;
    }
  }
  return result;
}

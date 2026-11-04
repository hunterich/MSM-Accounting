import type { Prisma } from '@prisma/client';
import { ApiError } from './errors';

/** Lock the return before reading linked notes. A concurrent FK insert/update
 * takes a PostgreSQL key-share lock, so it either commits before this check or
 * fails after deletion rather than being silently detached. */
export async function lockReturnForDeletion(
  tx: Prisma.TransactionClient, kind: 'sales' | 'purchase', orgId: string, id: string,
) {
  if (kind === 'sales') {
    await tx.$queryRaw`SELECT "id" FROM "SalesReturn" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT "id" FROM "PurchaseReturn" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`;
  }
}

export async function assertNoLinkedNotes(
  tx: Prisma.TransactionClient, kind: 'sales' | 'purchase', orgId: string, id: string,
) {
  const notes = kind === 'sales'
    ? await tx.creditNote.findMany({ where: { salesReturnId: id }, select: { number: true, status: true, organizationId: true }, orderBy: { number: 'asc' } })
    : await tx.debitNote.findMany({ where: { purchaseReturnId: id }, select: { number: true, status: true, organizationId: true }, orderBy: { number: 'asc' } });
  if (!notes.length) return;
  const visible = notes.filter(note => note.organizationId === orgId).slice(0, 5)
    .map(note => `${note.number} (${note.status})`).join(', ');
  const label = kind === 'sales' ? 'credit' : 'debit';
  throw new ApiError(
    `Cannot delete this return while linked ${label} notes exist${visible ? ': ' + visible : ''}. Resolve the notes first.`,
    422,
  );
}

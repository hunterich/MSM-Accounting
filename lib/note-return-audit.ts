import { Prisma } from '@prisma/client';
import { linkedReturnValue } from './note-return-value';

/** Read-only inventory of exhausted/overdrawn returns and invalid valuations. */
export async function auditLinkedReturnLimits(tx: Prisma.TransactionClient, organizationId: string) {
  const findings: Array<Record<string, unknown>> = [];
  for (const kind of ['credit', 'debit'] as const) {
    const returns = kind === 'credit'
      ? await tx.salesReturn.findMany({ where: { organizationId }, select: { id: true, number: true, totalAmount: true } })
      : await tx.purchaseReturn.findMany({ where: { organizationId }, select: { id: true, number: true, totalAmount: true } });
    for (const ret of returns) {
      const notes = kind === 'credit'
        ? await tx.creditNote.findMany({ where: { organizationId, salesReturnId: ret.id, status: { in: ['APPLIED', 'PENDING_APPROVAL'] } },
          select: { id: true, number: true, status: true, amount: true, settlementType: true } })
        : await tx.debitNote.findMany({ where: { organizationId, purchaseReturnId: ret.id, status: { in: ['APPLIED', 'PENDING_APPROVAL'] } },
          select: { id: true, number: true, status: true, amount: true, settlementType: true } });
      const applied = notes.filter(n => n.status === 'APPLIED').reduce((sum, n) => sum.plus(n.amount), new Prisma.Decimal(0));
      const reserved = notes.filter(n => n.status === 'PENDING_APPROVAL').reduce((sum, n) => sum.plus(n.amount), new Prisma.Decimal(0));
      let valuationError: string | undefined;
      try { await linkedReturnValue(tx, kind, organizationId, ret.id); }
      catch (error) {
        // Only expected business validation errors become findings. A database
        // failure must abort the report rather than produce a partial success.
        if (!(error instanceof Error) || !('status' in error) || error.status !== 422) throw error;
        valuationError = error.message;
      }
      const used = applied.plus(reserved);
      if (valuationError || used.gte(ret.totalAmount)) findings.push({ kind, returnId: ret.id, number: ret.number,
        returnValue: ret.totalAmount.toFixed(2), applied: applied.toFixed(2), reserved: reserved.toFixed(2),
        excess: Prisma.Decimal.max(0, used.minus(ret.totalAmount)).toFixed(2), valuationError, notes });
    }
  }
  return { organizationId, findings };
}

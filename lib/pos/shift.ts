import type { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/errors';

export interface OpenShiftInput {
  registerId: string;
  cashierId: string;
  openingFloat: number;
  clientShiftId?: string;
}

export interface CloseShiftInput {
  shiftId: string;
  countedCash: number;
}

export interface ZReport {
  totalSales: number;
  saleCount: number;
  cashCollected: number;
}

export interface OpenShiftResult {
  id: string;
  status: 'OPEN';
}

export interface CloseShiftResult {
  status: 'CLOSED';
  expectedCash: number;
  cashVariance: number;
  zReport: ZReport;
}

/** Open a POS shift. One OPEN shift per register at a time. Must run inside a $transaction. */
export async function openShift(tx: Prisma.TransactionClient, orgId: string, input: OpenShiftInput): Promise<OpenShiftResult> {
  if (input.clientShiftId) {
    const existing = await tx.posShift.findFirst({ where: { organizationId: orgId, clientShiftId: input.clientShiftId }, select: { id: true } });
    if (existing) return { id: existing.id, status: 'OPEN' };
  }
  const already = await tx.posShift.findFirst({ where: { organizationId: orgId, registerId: input.registerId, status: 'OPEN' }, select: { id: true } });
  if (already) throw new ApiError('Register already has an open shift', 409);
  const shift = await tx.posShift.create({
    data: { organizationId: orgId, registerId: input.registerId, cashierId: input.cashierId, openingFloat: input.openingFloat, clientShiftId: input.clientShiftId ?? null, status: 'OPEN' },
    select: { id: true },
  });
  return { id: shift.id, status: 'OPEN' };
}

/** Close a POS shift: compute expected cash, variance, and a Z-report. Must run inside a $transaction. */
export async function closeShift(tx: Prisma.TransactionClient, orgId: string, input: CloseShiftInput): Promise<CloseShiftResult> {
  const shift = await tx.posShift.findFirst({ where: { id: input.shiftId, organizationId: orgId }, select: { id: true, status: true, openingFloat: true, expectedCash: true, cashVariance: true } });
  if (!shift) throw new ApiError('Shift not found', 404);

  // Idempotent: closing an already-CLOSED shift recomputes + returns its result
  // (so a queued offline shift-close can be safely replayed on sync).
  if (shift.status === 'CLOSED') {
    const closedSales = await tx.posSale.findMany({
      where: { organizationId: orgId, shiftId: input.shiftId },
      select: { salesInvoice: { select: { totalAmount: true } }, tenders: { select: { method: true, amount: true, changeGiven: true } } },
    });
    let ts = 0, cc = 0;
    for (const s of closedSales) { ts += Number(s.salesInvoice?.totalAmount ?? 0); for (const t of s.tenders) if (t.method === 'CASH') cc += Number(t.amount) - Number(t.changeGiven); }
    return {
      status: 'CLOSED',
      expectedCash: Number(shift.expectedCash ?? 0),
      cashVariance: Number(shift.cashVariance ?? 0),
      zReport: { totalSales: Math.round((ts + Number.EPSILON) * 100) / 100, saleCount: closedSales.length, cashCollected: cc },
    };
  }

  const sales = await tx.posSale.findMany({
    where: { organizationId: orgId, shiftId: input.shiftId },
    select: { salesInvoice: { select: { totalAmount: true } }, tenders: { select: { method: true, amount: true, changeGiven: true } } },
  });

  let totalSales = 0;
  let cashCollected = 0;
  for (const s of sales) {
    totalSales += Number(s.salesInvoice?.totalAmount ?? 0);
    for (const t of s.tenders) {
      if (t.method === 'CASH') cashCollected += Number(t.amount) - Number(t.changeGiven);
    }
  }

  const expectedCash = Math.round((Number(shift.openingFloat) + cashCollected + Number.EPSILON) * 100) / 100;
  const cashVariance = Math.round((input.countedCash - expectedCash + Number.EPSILON) * 100) / 100;

  await tx.posShift.update({
    where: { id: input.shiftId },
    data: { status: 'CLOSED', closedAt: new Date(), closingCountedCash: input.countedCash, expectedCash, cashVariance },
  });

  return {
    status: 'CLOSED',
    expectedCash,
    cashVariance,
    zReport: { totalSales: Math.round((totalSales + Number.EPSILON) * 100) / 100, saleCount: sales.length, cashCollected },
  };
}

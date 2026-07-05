export interface BatchAvailability {
  stockBatchId: string;
  expiryDate: Date;
  qtyOnHand: number;
}

export interface BatchAllocation {
  stockBatchId: string;
  qty: number;
}

export interface FefoResult {
  ok: boolean;
  allocations: BatchAllocation[];
  shortBy: number;
}

/** Allocate `qtyNeeded` across batches, earliest expiry first. Pure. */
export function pickFefo(batches: BatchAvailability[], qtyNeeded: number): FefoResult {
  const sorted = [...batches]
    .filter((b) => b.qtyOnHand > 0)
    .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());

  const allocations: BatchAllocation[] = [];
  let remaining = qtyNeeded;
  for (const b of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(b.qtyOnHand, remaining);
    allocations.push({ stockBatchId: b.stockBatchId, qty: take });
    remaining -= take;
  }

  if (remaining > 0) {
    return { ok: false, allocations: [], shortBy: remaining };
  }
  return { ok: true, allocations, shortBy: 0 };
}

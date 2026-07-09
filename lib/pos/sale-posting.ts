import type { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/errors';
import { nextNumber } from '@/lib/api-utils';
import { postInvoiceSend } from '@/lib/invoice-send-posting';
import { postArPaymentIfNeeded } from '@/lib/payment-posting';
import { resolveAccountDefaultId, loadOrgAccountDefaults } from '@/lib/account-defaults';
import { computeSaleTotals, type SaleLineInput } from './pricing';
import { pickFefo, type BatchAvailability } from './fefo-picker';

export interface PosTenderInput {
  method: 'CASH';
  amount: number;
  reference?: string;
}

export interface PosSaleInput {
  clientSaleId: string;
  registerId: string;
  shiftId: string;
  cashierId: string;
  warehouseId: string | null;
  customerId?: string;
  lines: SaleLineInput[];
  tenders: PosTenderInput[];
  date: Date;
}

export interface PosSaleResult {
  posSaleId: string;
  salesInvoiceId: string;
  totalAmount: number;
  change: number;
}

const TAX_RATE = 11;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Generate the next `POS-####` SalesInvoice number.
 *
 * NOTE: `nextNumber` from `@/lib/api-utils` only whitelists specific tables in
 * `NUMBER_QUERIES` and `SalesInvoice` is NOT one of them (it throws
 * `nextNumber: disallowed target "SalesInvoice"`). We therefore generate the
 * number here in a compatible way: take a Postgres advisory lock (same
 * mechanism `nextNumber` uses) so concurrent POS sales serialise, then derive
 * the next sequence from the org's existing `POS-` invoices. The
 * `@@unique([organizationId, number])` constraint is the final safety net.
 */
async function nextPosInvoiceNumber(tx: Prisma.TransactionClient, orgId: string): Promise<string> {
  // Deterministic advisory lock id derived from the org so different orgs don't
  // block each other but concurrent sales in the same org do.
  const rows = await tx.$queryRaw<Array<{ lock_id: number }>>`
    SELECT ('x' || substr(md5('pos-invoice-number:' || ${orgId}), 1, 8))::bit(32)::int AS lock_id
  `;
  const lockId = rows[0]?.lock_id ?? 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockId})`;

  const maxRows = await tx.$queryRaw<Array<{ max: number | null }>>`
    SELECT MAX(CAST(SUBSTRING("number" FROM '[0-9]+') AS INTEGER)) AS max
    FROM "SalesInvoice"
    WHERE "organizationId" = ${orgId} AND "number" LIKE 'POS-%'
  `;
  const max = maxRows[0]?.max ?? 0;
  return `POS-${String(max + 1).padStart(4, '0')}`;
}

/** Create and post a POS cash sale. Must run inside a $transaction. */
export async function postPosSale(
  tx: Prisma.TransactionClient,
  orgId: string,
  input: PosSaleInput,
): Promise<PosSaleResult> {
  // 1. Idempotency — replaying the same clientSaleId returns the original sale.
  const existing = await tx.posSale.findFirst({
    where: { organizationId: orgId, clientSaleId: input.clientSaleId },
    select: { id: true, salesInvoiceId: true },
  });
  if (existing) {
    const inv = await tx.salesInvoice.findUnique({
      where: { id: existing.salesInvoiceId },
      select: { totalAmount: true },
    });
    return {
      posSaleId: existing.id,
      salesInvoiceId: existing.salesInvoiceId,
      totalAmount: Number(inv?.totalAmount ?? 0),
      change: 0,
    };
  }

  // 2. Validate shift + register.
  const shift = await tx.posShift.findFirst({
    where: { id: input.shiftId, organizationId: orgId },
    select: { id: true, status: true, registerId: true },
  });
  if (!shift || shift.status !== 'OPEN') throw new ApiError('Shift is not open', 400);
  const register = await tx.posRegister.findFirst({
    where: { id: input.registerId, organizationId: orgId },
    select: { id: true, warehouseId: true, cashAccountId: true },
  });
  if (!register) throw new ApiError('Register not found', 404);
  if (shift.registerId !== input.registerId) throw new ApiError('Shift does not belong to this register', 400);
  const warehouseId = input.warehouseId ?? register.warehouseId ?? null;

  // 3. Totals + cash validation.
  const totals = computeSaleTotals(input.lines, TAX_RATE);
  if (totals.totalAmount <= 0) throw new ApiError('Sale total must be greater than zero', 400);
  if (input.tenders.some((t) => t.method !== 'CASH')) throw new ApiError('Only cash tenders are supported', 400);
  const cash = input.tenders.filter((t) => t.method === 'CASH').reduce((s, t) => s + t.amount, 0);
  if (cash < totals.totalAmount) throw new ApiError('Insufficient cash tendered', 400);
  const change = round2(cash - totals.totalAmount);

  // 4. FEFO allocation for batch-tracked lines.
  const allocationsByLine: { itemId: string; allocations: { stockBatchId: string; qty: number }[] }[] = [];
  for (const line of input.lines) {
    const item = await tx.item.findFirst({
      where: { id: line.itemId, organizationId: orgId },
      select: { requiresBatchTracking: true },
    });
    if (!item?.requiresBatchTracking) continue;
    const batches = await tx.stockBatch.findMany({
      where: { organizationId: orgId, itemId: line.itemId, warehouseId, qtyOnHand: { gt: 0 } },
      select: { id: true, expiryDate: true, qtyOnHand: true },
    });
    const availability: BatchAvailability[] = batches.map((b) => ({
      stockBatchId: b.id,
      expiryDate: b.expiryDate,
      qtyOnHand: Number(b.qtyOnHand),
    }));
    const picked = pickFefo(availability, line.quantity);
    if (!picked.ok) {
      throw new ApiError(`Insufficient batch stock for item ${line.itemId} (short by ${picked.shortBy})`, 400);
    }
    allocationsByLine.push({ itemId: line.itemId, allocations: picked.allocations });
  }

  // 5. Resolve customer + accounts.
  const customerId =
    input.customerId ??
    (await tx.customer.findFirst({ where: { organizationId: orgId, code: 'WALK-IN' }, select: { id: true } }))?.id;
  if (!customerId) throw new ApiError('Walk-in customer not configured', 500);
  const accounts = await tx.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(tx, orgId);
  const arAccountId = resolveAccountDefaultId(accounts, settings, 'arControl');
  const cashAccountId = register.cashAccountId ?? resolveAccountDefaultId(accounts, settings, 'bankAsset');
  if (!arAccountId || !cashAccountId) throw new ApiError('AR or cash account not configured', 500);

  // 5b. Resolve the staff member each line is credited to. A line's explicit
  //     performedById wins IF it is one of this org's employees; otherwise credit
  //     the cashier's linked staff record (Employee.userId === cashierId);
  //     otherwise null (Unassigned). Validating the explicit id keeps a caller
  //     from stamping a line with another org's employee.
  const cashierEmployee = await tx.employee.findFirst({
    where: { organizationId: orgId, userId: input.cashierId },
    select: { id: true },
  });
  const defaultPerformerId = cashierEmployee?.id ?? null;

  const explicitPerformerIds = [...new Set(input.lines.map((l) => l.performedById).filter((x): x is string => !!x))];
  const validPerformerIds = new Set<string>();
  if (explicitPerformerIds.length > 0) {
    const emps = await tx.employee.findMany({
      where: { organizationId: orgId, id: { in: explicitPerformerIds } },
      select: { id: true },
    });
    for (const e of emps) validPerformerIds.add(e.id);
  }
  const performerFor = (l: SaleLineInput): string | null =>
    l.performedById && validPerformerIds.has(l.performedById) ? l.performedById : defaultPerformerId;

  // 6. Create SalesInvoice (DRAFT) with tax-inclusive totals.
  //    NOTE: no createdById — it is a nullable FK to User and the POS cashier
  //    id is not guaranteed to be a User row (the cashier lives on
  //    PosSale.cashierId instead).
  const invoiceNumber = await nextPosInvoiceNumber(tx, orgId);
  const invoice = await tx.salesInvoice.create({
    data: {
      organizationId: orgId,
      number: invoiceNumber,
      customerId,
      issueDate: input.date,
      status: 'DRAFT',
      taxEnabled: true,
      taxInclusive: true,
      taxRate: TAX_RATE,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
      lines: {
        create: input.lines.map((l, i) => ({
          lineNo: i + 1,
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity,
          price: l.price,
          discountPct: l.discountPct ?? 0,
          lineSubtotal: round2(l.quantity * l.price * (1 - (l.discountPct ?? 0) / 100)),
          performedById: performerFor(l),
        })),
      },
    },
    select: { id: true },
  });

  // 7. Post revenue/tax/AR + COGS/inventory-out, then mark SENT.
  await postInvoiceSend(tx, orgId, invoice.id);
  await tx.salesInvoice.update({ where: { id: invoice.id }, data: { status: 'SENT' } });

  // 8. Decrement physical batches per the FEFO allocation.
  for (const line of allocationsByLine) {
    for (const alloc of line.allocations) {
      await tx.stockBatch.update({
        where: { id: alloc.stockBatchId },
        data: { qtyOnHand: { decrement: alloc.qty } },
      });
    }
  }

  // 9. Settle a cash ARPayment (DR cash / CR AR) fully allocated to the invoice.
  //    COMPLETED is a postable status (UNPOSTABLE_STATUSES = DRAFT/VOID/PENDING_APPROVAL).
  const paymentNumber = await nextNumber(tx, 'ARPayment', 'number', 'POS-PAY');
  const payment = await tx.aRPayment.create({
    data: {
      organizationId: orgId,
      number: paymentNumber,
      customerId,
      date: input.date,
      method: 'CASH',
      depositAccountId: cashAccountId,
      arAccountId,
      status: 'COMPLETED',
      totalAmount: totals.totalAmount,
      allocations: { create: [{ invoiceId: invoice.id, amountApplied: totals.totalAmount }] },
    },
    select: { id: true },
  });
  await postArPaymentIfNeeded(tx, orgId, payment.id);

  // 10. Record POS sale, tenders, and batch allocations.
  const posSale = await tx.posSale.create({
    data: {
      organizationId: orgId,
      salesInvoiceId: invoice.id,
      registerId: input.registerId,
      shiftId: input.shiftId,
      cashierId: input.cashierId,
      clientSaleId: input.clientSaleId,
      syncStatus: 'SYNCED',
      soldAt: input.date,
      tenders: {
        create: input.tenders.map((t) => ({
          method: t.method,
          amount: t.amount,
          reference: t.reference ?? null,
          changeGiven: t.method === 'CASH' ? change : 0,
        })),
      },
      batchAllocations: {
        create: allocationsByLine.flatMap((line) =>
          line.allocations.map((a) => ({ itemId: line.itemId, stockBatchId: a.stockBatchId, qty: a.qty })),
        ),
      },
    },
    select: { id: true },
  });

  return { posSaleId: posSale.id, salesInvoiceId: invoice.id, totalAmount: totals.totalAmount, change };
}

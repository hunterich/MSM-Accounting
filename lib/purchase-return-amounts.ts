import type { BillLine as SavedBillLine, Prisma } from '@prisma/client';
import { advisoryLockKey } from './advisory-lock';
import { calculateBillAmounts, splitBillLineTax } from './bill-totals';
import { ApiError } from './errors';
import { allocateRoundedAmount, MoneyDecimal, roundMoneyDecimal } from './money-decimal';

type Tx = Prisma.TransactionClient;
type Decimal = Prisma.Decimal;
type DecimalValue = Prisma.Decimal.Value;
type TaxTerms = { applyTax?: boolean; taxIncluded?: boolean; taxRate?: DecimalValue };
type ReturnLine = {
  lineKey?: string | null;
  itemId?: string | null;
  description?: string | null;
  unit?: string;
  qtyPurchased?: DecimalValue;
  qtyReturn?: DecimalValue;
  price?: DecimalValue;
};
type BillLine = Pick<SavedBillLine, 'id' | 'lineNo' | 'itemId' | 'description' | 'unit' | 'quantity' | 'price' | 'taxable' | 'lineTotal' | 'poReceiptTaxAmount'>;

const zero = new MoneyDecimal(0);

export async function lockPurchaseReturns(tx: Tx, orgId: string, billId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(`purchase-returns:${orgId}:${billId}`)})`;
}

function effectiveTax(terms: TaxTerms, source: BillLine | undefined) {
  const rate = terms.applyTax && source?.taxable !== false ? roundMoneyDecimal(terms.taxRate ?? 11).div(100) : zero;
  return { rate, inclusive: !rate.isZero() && Boolean(terms.taxIncluded) };
}

function valuationKey(lineKey: string, price: Decimal, tax: ReturnType<typeof effectiveTax>) {
  return JSON.stringify([lineKey, price.toFixed(2), tax.rate.toString(), tax.inclusive]);
}

export async function preparePurchaseReturnValuation(
  tx: Tx,
  orgId: string,
  input: TaxTerms & { billId: string; vendorId: string; lines?: ReturnLine[] },
  excludeReturnId?: string,
) {
  await lockPurchaseReturns(tx, orgId, input.billId);
  const bill = await tx.bill.findFirst({
    where: { id: input.billId, organizationId: orgId },
    select: {
      id: true, number: true, vendorId: true, taxable: true, taxInclusive: true, taxRate: true,
      lines: { select: { id: true, lineNo: true, itemId: true, description: true, unit: true, quantity: true,
        price: true, taxable: true, lineTotal: true, poReceiptTaxAmount: true } },
    },
  });
  if (!bill) throw new ApiError('Bill not found in organization', 422);
  if (bill.vendorId !== input.vendorId) throw new ApiError('Source bill must belong to the selected vendor', 422);
  const terms = {
    applyTax: input.applyTax ?? bill.taxable,
    taxIncluded: input.taxIncluded ?? bill.taxInclusive,
    taxRate: roundMoneyDecimal(input.taxRate ?? bill.taxRate),
  };
  const byKey = new Map<string, BillLine>();
  for (const line of bill.lines) {
    // The form used bill number + row number before it sent the bill line ID.
    for (const key of [line.id, `${bill.number}-${line.lineNo}`, `${bill.id}-${line.lineNo}`]) byKey.set(key, line);
  }
  const sourceFor = (line: ReturnLine) => {
    const identified = line.lineKey ? byKey.get(line.lineKey) : undefined;
    if (identified) return identified;
    const matches = bill.lines.filter(source =>
      (!line.itemId || line.itemId === source.itemId) &&
      line.description === source.description && (line.unit || 'PCS') === source.unit);
    return matches.length === 1 ? matches[0] : undefined;
  };

  const prior = await tx.purchaseReturn.findMany({
    where: { organizationId: orgId, billId: bill.id, status: { not: 'VOID' },
      ...(excludeReturnId ? { id: { not: excludeReturnId } } : {}) },
    select: { status: true, applyTax: true, taxIncluded: true, taxRate: true, taxAmount: true,
      lines: { orderBy: { lineNo: 'asc' } } },
  });
  const reservedQty = new Map<string, Decimal>();
  const used = new Map<string, { qty: Decimal; net: Decimal; tax: Decimal }>();
  for (const ret of prior) {
    const legacyTaxes = ret.status !== 'DRAFT' && ret.lines.some(line => line.taxAmount == null)
      ? allocateRoundedAmount(ret.applyTax ? ret.taxAmount : zero, ret.lines.map(line => line.lineTotal))
      : [];
    for (const [index, line] of ret.lines.entries()) {
      const source = sourceFor(line);
      if (line.qtyReturn.lte(0)) continue;
      if (source) reservedQty.set(source.id, new MoneyDecimal(reservedQty.get(source.id) ?? 0).plus(line.qtyReturn));
      const lineKey = source?.id ?? line.lineKey;
      if (ret.status === 'DRAFT' || !lineKey) continue;
      const key = valuationKey(lineKey, line.price, effectiveTax(ret, source));
      const before = used.get(key) ?? { qty: zero, net: zero, tax: zero };
      const tax = line.taxAmount ?? legacyTaxes[index];
      used.set(key, {
        qty: before.qty.plus(line.qtyReturn),
        net: before.net.plus(ret.taxIncluded ? line.lineTotal.minus(tax) : line.lineTotal),
        tax: before.tax.plus(tax),
      });
    }
  }

  let subtotal = zero;
  let taxAmount = zero;
  const lines = (input.lines ?? []).map((line, index) => {
    const source = sourceFor(line);
    if (source && line.itemId && line.itemId !== source.itemId) {
      throw new ApiError('Returned item does not match its source bill line', 422);
    }
    const lineKey = source?.id ?? (line.lineKey || null);
    const qtyReturn = new MoneyDecimal(line.qtyReturn ?? 0).toDecimalPlaces(4);
    const qtyPurchased = new MoneyDecimal(source?.quantity ?? line.qtyPurchased ?? 0).toDecimalPlaces(4);
    const price = roundMoneyDecimal(line.price ?? source?.price ?? 0);
    if (source && qtyReturn.gt(0)) {
      const cumulativeQty = qtyReturn.plus(reservedQty.get(source.id) ?? 0);
      if (cumulativeQty.gt(qtyPurchased)) throw new ApiError(`Return quantity exceeds the remaining billed quantity for ${source.description}`, 422);
      reservedQty.set(source.id, cumulativeQty);
    }
    const taxTerms = effectiveTax(terms, source);
    const key = lineKey ? valuationKey(lineKey, price, taxTerms) : null;
    const before = (key ? used.get(key) : undefined) ?? { qty: zero, net: zero, tax: zero };
    if (qtyReturn.gt(0) && (before.net.lt(0) || before.tax.lt(0))) {
      throw new ApiError('Earlier returns contain invalid supplier amounts. Review the recorded returns before continuing.', 422);
    }
    const qty = before.qty.plus(qtyReturn);
    let target = splitBillLineTax(roundMoneyDecimal(qty.mul(price)), taxTerms.rate, taxTerms.inclusive);
    if (source && price.eq(source.price) && qtyPurchased.gt(0)) {
      const billedTax = effectiveTax({ applyTax: bill.taxable, taxIncluded: bill.taxInclusive, taxRate: bill.taxRate }, source);
      const share = qty.div(qtyPurchased);
      if (taxTerms.rate.eq(billedTax.rate) && taxTerms.inclusive === billedTax.inclusive) {
        const [billed] = calculateBillAmounts({ ...bill, lines: [source] }).lines;
        // Carry the booked discount and tax allocation through the last return.
        target = { net: roundMoneyDecimal(billed.net.mul(share)), tax: roundMoneyDecimal(billed.tax.mul(share)) };
      } else {
        target = splitBillLineTax(roundMoneyDecimal(source.lineTotal.mul(share)), taxTerms.rate, taxTerms.inclusive);
      }
    }
    // Earlier finalized returns keep their assigned amounts. If one is voided,
    // its replacement credits only what remains under the same terms.
    const net = qtyReturn.isZero() ? zero : MoneyDecimal.max(0, target.net.minus(before.net));
    const tax = qtyReturn.isZero() ? zero : MoneyDecimal.max(0, target.tax.minus(before.tax));
    if (key) used.set(key, { qty, net: before.net.plus(net), tax: before.tax.plus(tax) });
    const lineTotal = terms.taxIncluded ? net.plus(tax) : net;
    subtotal = subtotal.plus(lineTotal);
    taxAmount = taxAmount.plus(tax);
    return {
      lineNo: index + 1, lineKey, itemId: line.itemId || null, description: line.description || source?.description || '',
      qtyPurchased, qtyReturn, unit: line.unit || source?.unit || 'PCS', price, lineTotal, taxAmount: tax,
    };
  });
  return { ...terms, lines, subtotal, taxAmount, totalAmount: terms.taxIncluded ? subtotal : subtotal.plus(taxAmount) };
}

import type { Decimal } from '@prisma/client/runtime/index-browser.js';
import { calculateInvoiceLineAmounts } from '../invoice-totals';
import { MoneyDecimal, roundMoneyDecimal } from '../money-decimal';
import { flattenSaleLines } from './modifier-lines';
import { computeServiceCharge } from './sales-type-charge';

export interface SelectedModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDelta: number; // tax-inclusive, may be 0
  itemId?: string | null;
}

export interface SaleLineInput {
  itemId: string;
  description: string;
  quantity: number;
  price: number;      // tax-inclusive unit price
  discountPct: number; // 0..100
  /** Staff member (Employee id) credited for this line. Optional: the pharmacy
   *  sends none and the server defaults it to the cashier's staff record. */
  performedById?: string | null;
  modifiers?: SelectedModifier[]; // NEW — selected options for this line
}

const POS_TAX_RATE = 11;

export interface PosSaleBreakdown {
  subtotal: number;
  taxAmount: number;
  serviceChargeNet: number;
}

const ZERO = new MoneyDecimal(0);

/** Price the rows checkout will save. Each cart row includes its priced modifiers. */
export function pricePosSale(cart: readonly SaleLineInput[], salesType?: { taxable: boolean; serviceChargePct: Decimal.Value } | null) {
  const lines = flattenSaleLines(cart.map(line => {
    const modifiers = line.modifiers?.map(mod => ({ ...mod, priceDelta: roundMoneyDecimal(mod.priceDelta).toNumber() }));
    const extras = (modifiers ?? []).reduce((sum, mod) => sum.plus(mod.priceDelta), ZERO);
    return { ...line, modifiers, price: roundMoneyDecimal(line.price).minus(extras).toNumber() };
  })).map(line => ({ ...line, ...calculateInvoiceLineAmounts(line) }));

  const totalsByCartLine = new Map<number, Decimal>();
  let goodsTotal = ZERO;
  for (const line of lines) {
    const parent = line.parentLineNo ?? line.lineNo;
    totalsByCartLine.set(parent, (totalsByCartLine.get(parent) ?? ZERO).plus(line.lineSubtotal));
    goodsTotal = goodsTotal.plus(line.lineSubtotal);
  }
  const cartLineTotals = [...totalsByCartLine.values()];
  const taxRate = salesType?.taxable === false ? 0 : POS_TAX_RATE;
  const subtotal = roundMoneyDecimal(goodsTotal.div(new MoneyDecimal(taxRate).div(100).plus(1)));
  const { chargeAmt, taxAddon } = computeServiceCharge({ goodsTotal, pct: salesType?.serviceChargePct ?? 0, rate: taxRate });
  return {
    lines, cartLineTotals, taxRate, subtotal, taxAmount: goodsTotal.minus(subtotal).plus(taxAddon), chargeAmt,
    serviceChargeNet: chargeAmt.minus(taxAddon),
    totalAmount: goodsTotal.plus(chargeAmt),
  };
}

export function posSaleBreakdown(amounts: Pick<ReturnType<typeof pricePosSale>, 'subtotal' | 'taxAmount' | 'serviceChargeNet'>): PosSaleBreakdown {
  return {
    subtotal: amounts.subtotal.toNumber(),
    taxAmount: amounts.taxAmount.toNumber(),
    serviceChargeNet: amounts.serviceChargeNet.toNumber(),
  };
}

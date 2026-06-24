import type { DocLine, DocCharge, DocTotals } from './types';

const net = (l: DocLine): number => {
    const gross = (Number(l.qty) || 0) * (Number(l.price) || 0);
    return gross - gross * ((Number(l.discount) || 0) / 100);
};

export interface TotalsOptions {
    documentDiscount?: number;
    /** PPN applied at all? Defaults to OFF — a document carries no tax unless turned on. */
    taxOn?: boolean;
    /** PPN rate, e.g. 11. */
    taxRate?: number;
    /**
     * 'exclusive' = prices exclude PPN, tax is ADDED on top of the subtotal.
     * 'inclusive' = prices already include PPN, tax is EXTRACTED from the subtotal.
     */
    taxMode?: 'exclusive' | 'inclusive';
    /** PPh withholding rate on the goods/services subtotal (e.g. 2 for PPh 23). */
    withholdingRate?: number;
}

/**
 * computeTotals — single source of truth for document money math.
 *
 * Tax base = (subtotal − documentDiscount) + taxable charges.
 * - taxOn=false → no PPN.
 * - exclusive   → PPN added on top (grand = base + tax + non-taxable charges).
 * - inclusive   → PPN already inside the subtotal (grand unchanged; tax shown for reference).
 * Withholding (PPh) is deducted from the payable grand total.
 */
export function computeTotals(
    lines: DocLine[],
    charges: DocCharge[] = [],
    opts: TotalsOptions = {},
): DocTotals {
    const rate = Number(opts.taxRate) || 0;
    const taxOn = !!opts.taxOn;
    const mode = opts.taxMode || 'exclusive';

    const subtotal = lines.reduce((s, l) => s + net(l), 0);
    const chargesTotal = charges.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const documentDiscount = Number(opts.documentDiscount) || 0;
    const taxableCharges = charges
        .filter((c) => (Number(c.taxRate) || 0) > 0)
        .reduce((s, c) => s + (Number(c.amount) || 0), 0);

    const taxableBase = subtotal - documentDiscount + taxableCharges;

    let tax = 0;
    let grandTotal: number;
    if (!taxOn || rate === 0) {
        grandTotal = subtotal + chargesTotal - documentDiscount;
    } else if (mode === 'inclusive') {
        tax = Math.round(taxableBase * rate / (100 + rate)); // extracted
        grandTotal = subtotal + chargesTotal - documentDiscount; // unchanged — tax already inside
    } else {
        tax = Math.round(taxableBase * rate / 100); // added on top
        grandTotal = subtotal + chargesTotal - documentDiscount + tax;
    }

    const withholding = opts.withholdingRate
        ? Math.round(subtotal * (Number(opts.withholdingRate) / 100))
        : 0;
    grandTotal -= withholding;

    return {
        subtotal,
        chargesTotal,
        documentDiscount,
        taxableBase,
        tax,
        withholding,
        grandTotal: Math.round(grandTotal),
    };
}

export const lineNet = net;

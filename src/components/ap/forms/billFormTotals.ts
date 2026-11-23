import { calculateBillAmounts, normalizeBillLineAmounts } from '../../../../lib/bill-totals';
import type { TotalsOptions } from '../../documents/computeTotals';
import type { DocLine, DocCharge, DocTotals } from '../../documents/types';

function lineAmounts(line: DocLine) {
    return {
        ...normalizeBillLineAmounts({
            quantity: line.qty, price: line.price, discountPct: line.discount, lineTotal: line.receivedAmounts?.lineTotal,
        }),
        taxable: line.taxable,
        poReceiptTaxAmount: line.receivedAmounts?.tax,
    };
}

export function billFormLineTotal(line: DocLine): number {
    return lineAmounts(line).lineTotal.toNumber();
}

export function computeBillFormTotals(lines: DocLine[], charges: DocCharge[], opts: TotalsOptions): DocTotals {
    const amounts = calculateBillAmounts({
        lines: lines.filter(line => line.description.trim()).map(lineAmounts),
        charges: charges.filter(charge => charge.label.trim()),
        taxable: opts.taxOn,
        taxInclusive: opts.taxMode === 'inclusive',
        taxRate: opts.taxRate,
        withholdingRate: opts.withholdingRate,
    });
    return {
        subtotal: amounts.subtotal.toNumber(),
        chargesTotal: amounts.chargesTotal.toNumber(),
        documentDiscount: 0,
        taxableBase: amounts.taxableBase.toNumber(),
        tax: amounts.taxAmount.toNumber(),
        withholding: amounts.withholdingAmount.toNumber(),
        grandTotal: amounts.totalAmount.toNumber(),
    };
}

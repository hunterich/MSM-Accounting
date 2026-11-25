import { calculateInvoiceLineAmounts, calculateInvoiceTotals, sameInvoiceLinePricing } from '../../../lib/invoice-totals';
import type { InvoiceLine } from '../../types';

type FormLine = { id?: string | number; productId?: string; code?: string; description: string; quantity: number; unit?: string; price: number; discount?: number; taxable?: boolean | null };
type FormCharge = { label: string; accountId?: string; amount: number; taxRate?: number };
type FormTax = { enabled: boolean; inclusive: boolean; rate: number };

export function invoiceFormLineInput(line: FormLine) {
    return {
        itemId: line.productId || undefined, code: line.code || undefined,
        description: line.description, unit: line.unit || 'PCS',
        quantity: line.quantity || 0, price: line.price || 0, discountPct: line.discount || 0,
        taxable: line.taxable ?? undefined,
    };
}

function invoiceFormValuation(line: FormLine, saved?: InvoiceLine) {
    const input = invoiceFormLineInput(line);
    return { ...input, lineSubtotal: saved && sameInvoiceLinePricing(input, saved) ? saved.lineSubtotal : undefined };
}

export function invoiceFormLineTotal(line: FormLine, saved?: InvoiceLine) {
    return calculateInvoiceLineAmounts(invoiceFormValuation(line, saved)).lineSubtotal.toNumber();
}

export function computeInvoiceFormTotals(
    items: FormLine[], charges: FormCharge[], discountPct: number, tax: FormTax,
    savedLines?: ReadonlyMap<string, InvoiceLine>,
) {
    return calculateInvoiceTotals({
        lines: items.filter(line => line.description.trim()).map(line => invoiceFormValuation(line, savedLines?.get(String(line.id)))),
        charges,
        discountPct,
        tax,
    }, { taxEnabled: tax.enabled, taxInclusiveByDefault: tax.inclusive, taxDefaultRate: tax.rate });
}

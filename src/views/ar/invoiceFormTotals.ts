import { calculateInvoiceLineAmounts, calculateInvoiceTotals } from '../../../lib/invoice-totals';

type FormLine = { productId?: string; code?: string; description: string; quantity: number; unit?: string; price: number; discount?: number; taxable?: boolean | null };
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

export function invoiceFormLineTotal(line: FormLine) {
    return calculateInvoiceLineAmounts(invoiceFormLineInput(line)).lineSubtotal.toNumber();
}

export function computeInvoiceFormTotals(items: FormLine[], charges: FormCharge[], discountPct: number, tax: FormTax) {
    return calculateInvoiceTotals({
        lines: items.filter(line => line.description.trim()).map(invoiceFormLineInput),
        charges,
        discountPct,
        tax,
    }, { taxEnabled: tax.enabled, taxInclusiveByDefault: tax.inclusive, taxDefaultRate: tax.rate });
}

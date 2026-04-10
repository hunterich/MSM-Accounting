/**
 * Tax calculation utilities extracted from InvoiceForm.
 * Used across invoice, bill, return, and credit/debit note forms.
 */

export interface LineItem {
    quantity?: number;
    price?: number;
    discount?: number;
    [key: string]: unknown;
}

export interface TaxSettings {
    enabled: boolean;
    rate?: number;
    inclusive?: boolean;
}

export const calculateItemTotal = (item: LineItem): number => {
    const sub = (item.quantity || 0) * (item.price || 0);
    const disc = sub * ((item.discount || 0) / 100);
    return sub - disc;
};

export const calculateSubtotal = (items: LineItem[]): number => {
    if (!Array.isArray(items)) return 0;
    return items.reduce((acc, item) => acc + calculateItemTotal(item), 0);
};

export const calculateDiscountAmount = (
    subtotal: number,
    discountPercent: number | undefined | null,
): number => {
    return subtotal * ((discountPercent || 0) / 100);
};

export const calculateTaxAmount = (
    netAmount: number,
    taxSettings: TaxSettings | null | undefined,
): number => {
    if (!taxSettings || !taxSettings.enabled) return 0;
    const rate = (taxSettings.rate || 0) / 100;
    if (taxSettings.inclusive) {
        return netAmount - (netAmount / (1 + rate));
    }
    return netAmount * rate;
};

export const calculateTotal = (
    items: LineItem[],
    discountPercent: number | undefined | null,
    taxSettings: TaxSettings | null | undefined,
): number => {
    const subtotal = calculateSubtotal(items);
    const discount = calculateDiscountAmount(subtotal, discountPercent);
    const net = subtotal - discount;
    const tax = calculateTaxAmount(net, taxSettings);
    return taxSettings && taxSettings.enabled && !taxSettings.inclusive ? net + tax : net;
};

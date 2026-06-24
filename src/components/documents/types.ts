/**
 * Shared types for the document-form system.
 *
 * Two families compose from these:
 *  - Line-item documents  (Sales Order, Invoice, Purchase Order, Bill, Credit/Debit Note, Returns)
 *  - Allocation documents  (AR/AP Payment)
 *
 * These types are intentionally framework-agnostic and store-agnostic so the
 * presentational components stay testable. Host forms map their store data into
 * these shapes.
 */

export type Party = 'customer' | 'vendor';

/** A single editable product/service line. */
export interface DocLine {
    id: string;
    productId?: string;
    code: string;
    description: string;
    qty: number;
    unit: string;
    price: number;
    /** percentage discount 0..100 */
    discount: number;
    /** percentage tax rate, e.g. 11 for PPN 11% */
    taxRate?: number;
    /** optional stock-on-hand for the low-stock badge */
    stock?: number;
}

/** A non-product cost: delivery, insurance, entertainment, handling, etc. */
export interface DocCharge {
    id: string;
    label: string;
    /** GL account this charge posts to, e.g. "6310 · Freight Out" */
    accountId: string;
    accountLabel: string;
    amount: number;
    /** percentage tax rate applied to this charge (0 = none) */
    taxRate?: number;
}

/** Computed monetary breakdown for a line-item document. */
export interface DocTotals {
    subtotal: number;
    chargesTotal: number;
    documentDiscount: number;
    taxableBase: number;
    tax: number;
    withholding: number;
    grandTotal: number;
}

/** Header field descriptor — drives the config-driven header grid. */
export interface HeaderField {
    key: string;
    label: string;
    /** 12-col grid span */
    span: number;
    required?: boolean;
    type?: 'text' | 'date' | 'select' | 'searchable' | 'number';
    mono?: boolean;
    placeholder?: string;
    options?: { value: string; label: string }[];
    /** for the document number field: show an auto/manual toggle */
    numbering?: boolean;
}

/** One open document in an allocation form (an open invoice/bill). */
export interface OpenDoc {
    id: string;
    due: string;
    overdueLabel?: string;
    openBalance: number;
    discount?: number;
    penalty?: number;
}

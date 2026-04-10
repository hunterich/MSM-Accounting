// Type declarations for src/data/mockData.js
// mockData.js is kept as JS; this file provides TypeScript types for consumers.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export interface MockCustomer extends AnyRecord {
    id: string;
    name: string;
    email: string;
    balance: number;
    status: string;
    category: string;
    defaultDiscount: number;
    paymentTerms: number;
    billingAddress?: string;
    shippingAddress?: string;
}

export interface MockCustomerCategory extends AnyRecord {
    id: string;
    name: string;
    prefix: string;
    defaultCreditLimit: number;
    defaultPaymentTerms: number;
    defaultDiscount: number;
    description: string;
}

export interface MockProduct extends AnyRecord {
    id: string;
    name: string;
    price: number;
    type: string;
}

export interface MockInvoice extends AnyRecord {
    id: string;
    customerId: string;
    customerName: string;
    date: string;
    dueDate: string;
    amount: number;
    status: string;
}

export interface MockARPayment extends AnyRecord {
    id: string;
    invoiceId: string;
    customerId: string;
    customerName: string;
    date: string;
    method: string;
    bankId: string;
    amount: number;
    status: string;
    arAccountId: string;
    depositAccountId: string;
    discountAccountId: string;
    penaltyAccountId: string;
}

export interface MockInvoiceItemTemplate extends AnyRecord {
    id: string;
    itemName: string;
    qty: number;
    unit: string;
    price: number;
}

export interface MockBill extends AnyRecord {
    id: string;
    vendorId: string;
    vendor: string;
    date: string;
    due: string;
    amount: number;
    status: string;
    poNumber: string;
    notes: string;
    apAccountId: string;
}

export interface MockVendor extends AnyRecord {
    id: string;
    name: string;
    category: string;
    email: string;
    phone: string;
    paymentTerms: string;
    npwp: string;
    defaultApAccountId: string;
    status: string;
    balance: number;
}

export interface MockAPPayment extends AnyRecord {
    id: string;
    billId: string;
    vendorId: string;
    vendorName: string;
    date: string;
    method: string;
    bankId: string;
    amount: number;
    status: string;
    apAccountId: string;
    depositAccountId: string;
    discountAccountId: string;
    penaltyAccountId: string;
}

export interface MockPurchaseReturnLine {
    lineKey: string;
    description: string;
    qtyPurchased: number;
    qtyReturn: number;
    unit: string;
    price: number;
}

export interface MockPurchaseReturn extends AnyRecord {
    id: string;
    vendorId: string;
    vendorName: string;
    billId: string;
    returnDate: string;
    warehouseId: string;
    apAccountId: string;
    returnAccountId: string;
    taxAccountId: string;
    applyTax: boolean;
    taxIncluded: boolean;
    taxRate: number;
    lines: MockPurchaseReturnLine[];
    reason: string;
    status: string;
}

export interface MockDebitNote extends AnyRecord {
    id: string;
    returnId: string;
    vendorId: string;
    vendorName: string;
    sourceBillId: string;
    date: string;
    amount: number;
    apAccountId: string;
    returnAccountId: string;
    taxAccountId: string;
    settlementType: string;
    settlementRef: string;
    settlementAccountId: string;
    applyTax: boolean;
    status: string;
}

export interface MockBillItemTemplate {
    description: string;
    accountId: string;
    qty: number;
    unit: string;
    price: number;
}

export interface MockBankAccount extends AnyRecord {
    id: string;
    code: string;
    name: string;
    balance: number;
}

export interface MockWarehouse extends AnyRecord {
    id: string;
    code: string;
    name: string;
}

export interface MockSalesReturnLine {
    lineKey?: string;
    itemId?: string;
    itemName?: string;
    qtySold?: number;
    qtyReturn?: number;
    unit?: string;
    price?: number;
}

export interface MockSalesReturn extends AnyRecord {
    id: string;
    customerId: string;
    customerName: string;
    invoiceId: string;
    returnDate: string;
    warehouseId?: string;
    arAccountId?: string;
    returnAccountId?: string;
    taxAccountId?: string;
    applyTax?: boolean;
    taxIncluded?: boolean;
    taxRate?: number;
    lines?: MockSalesReturnLine[];
    reason?: string;
    status: string;
}

export interface MockCreditNote extends AnyRecord {
    id: string;
    customerId: string;
    customerName: string;
    salesReturnId?: string;
    sourceInvoiceId?: string;
    date: string;
    amount: number;
    arAccountId?: string;
    returnAccountId?: string;
    taxAccountId?: string;
    settlementType?: string;
    settlementRef?: string;
    settlementAccountId?: string;
    applyTax?: boolean;
    status: string;
}

export interface MockAccount extends AnyRecord {
    id: string;
    code: string;
    name: string;
    type: string;
    normalSide?: string;
    isPostable?: boolean;
    parentId?: string | null;
    level?: number;
}

export interface MockJournalEntry extends AnyRecord {
    id: string;
    date: string;
    memo: string;
    status: string;
    lines?: Array<{ accountId: string; debit?: number; credit?: number; description?: string }>;
}

export interface MockSaleLine extends AnyRecord {
    month: string;
    revenue: number;
    cogs: number;
    grossProfit: number;
}

export interface MockAgingInvoice extends AnyRecord {
    customerId: string;
    customerName: string;
    current?: number;
    days1_30?: number;
    days31_60?: number;
    days61_90?: number;
    over90?: number;
    total?: number;
}

export declare const customers: MockCustomer[];
export declare const initialCustomerCategories: MockCustomerCategory[];
export declare const products: MockProduct[];
export declare const invoices: MockInvoice[];
export declare const arPayments: MockARPayment[];
export declare const invoiceItemTemplates: Record<string, MockInvoiceItemTemplate[]>;
export declare const bills: MockBill[];
export declare const vendors: MockVendor[];
export declare const apPayments: MockAPPayment[];
export declare const purchaseReturns: MockPurchaseReturn[];
export declare const debitNotes: MockDebitNote[];
export declare const billItemTemplates: Record<string, MockBillItemTemplate[]>;
export declare const bankAccounts: MockBankAccount[];
export declare const warehouses: MockWarehouse[];
export declare const salesReturns: MockSalesReturn[];
export declare const creditNotes: MockCreditNote[];
export declare const chartOfAccounts: MockAccount[];
export declare const accountBalancesById: Record<string, number>;
export declare const journalEntries: MockJournalEntry[];
export declare const salesLines: MockSaleLine[];
export declare const agingInvoices: MockAgingInvoice[];

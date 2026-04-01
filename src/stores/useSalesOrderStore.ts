import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useInvoiceStore } from './useInvoiceStore';

interface SOItem {
    id:          string;
    description: string;
    qty:         number;
    unit:        string;
    price:       number;
    discount:    number;
    quantity?:   number;
    discountPct?: number;
    [key: string]: unknown;
}

interface SO {
    id:                 string;
    customerId:         string;
    customerName:       string;
    date:               string;
    expectedDate:       string;
    status:             string;
    currency:           string;
    amount:             number;
    notes:              string;
    shippingAddress?:   string;
    deliveryNotes?:     string;
    convertedInvoiceId: string | null;
}

interface SalesOrderStore {
    salesOrders:      SO[];
    soItemTemplates:  Record<string, SOItem[]>;
    isLoading:        boolean;
    error:            string | null;
    addSalesOrder:    (order: Partial<SO>) => Promise<SO>;
    updateSalesOrder: (id: string, updates: Partial<SO>) => Promise<void>;
    deleteSalesOrder: (id: string) => Promise<void>;
    setSoItemTemplates:(soId: string, items: SOItem[]) => Promise<void>;
    getSalesOrderById: (id: string) => SO | undefined;
    convertToInvoice:  (soId: string) => Promise<string | null>;
}

const seed: SO[] = [
    { id: 'SO-1001', customerId: 'CUST-001', customerName: 'Acme Corp',  date: '2026-01-10', expectedDate: '2026-01-25', status: 'Confirmed', currency: 'IDR', amount: 5000000, notes: '', convertedInvoiceId: null },
    { id: 'SO-1002', customerId: 'CUST-002', customerName: 'Globex Inc', date: '2026-01-15', expectedDate: '2026-02-01', status: 'Draft',     currency: 'IDR', amount: 2200000, notes: '', convertedInvoiceId: null },
    { id: 'SO-1003', customerId: 'CUST-001', customerName: 'Acme Corp',  date: '2026-01-20', expectedDate: '2026-02-10', status: 'Delivered', currency: 'IDR', amount: 8750000, notes: 'Priority delivery', convertedInvoiceId: null },
];

const templatesSeed: Record<string, SOItem[]> = {
    'SO-1001': [
        { id: 'li-1', description: 'Widget A', qty: 10, unit: 'PCS', price: 500000, discount: 0 },
    ],
    'SO-1002': [
        { id: 'li-1', description: 'Spare Part B', qty: 4, unit: 'PCS', price: 550000, discount: 0 },
    ],
    'SO-1003': [
        { id: 'li-1', description: 'Industrial Pump', qty: 2, unit: 'PCS', price: 4500000, discount: 5 },
        { id: 'li-2', description: 'Installation Service', qty: 1, unit: 'JOB', price: 200000, discount: 0 },
    ],
};

const toNumber = (value: unknown) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

const calculateAmountFromItems = (items: Array<Partial<SOItem>> = []) => {
    return items.reduce((sum, line) => {
        const qty = toNumber(line.qty ?? line.quantity);
        const price = toNumber(line.price);
        const discount = toNumber(line.discount ?? line.discountPct);
        const gross = qty * price;
        const net = gross - (gross * (discount / 100));
        return sum + net;
    }, 0);
};

const nextId = (prefix: string, records: Array<{ id?: string | null }>) => {
    const maxNum = records.reduce((max, row) => {
        const value = String(row.id || '').replace(`${prefix}-`, '');
        const num = Number(value);
        if (!Number.isFinite(num)) return max;
        return Math.max(max, num);
    }, 1000);

    return `${prefix}-${String(maxNum + 1).padStart(4, '0')}`;
};

export const useSalesOrderStore = create<SalesOrderStore>()(
    persist(
        (set, get) => ({
            salesOrders: seed,
            soItemTemplates: templatesSeed,
            isLoading: false,
            error: null,

            addSalesOrder: async (order) => {
                const id = nextId('SO', get().salesOrders);
                const created = {
                    id,
                    customerId: order.customerId || '',
                    customerName: order.customerName || 'Unknown Customer',
                    date: order.date || new Date().toISOString().slice(0, 10),
                    expectedDate: order.expectedDate || '',
                    status: order.status || 'Draft',
                    currency: order.currency || 'IDR',
                    amount: toNumber(order.amount),
                    notes: order.notes || '',
                    shippingAddress: order.shippingAddress || '',
                    deliveryNotes: order.deliveryNotes || '',
                    convertedInvoiceId: order.convertedInvoiceId || null,
                };

                set((state) => ({
                    salesOrders: [...state.salesOrders, created],
                }));

                return created;
            },

            updateSalesOrder: async (id, updates) => {
                set((state) => ({
                    salesOrders: state.salesOrders.map((so) =>
                        so.id === id ? { ...so, ...updates } : so
                    ),
                }));
            },

            deleteSalesOrder: async (id) => {
                set((state) => {
                    const nextTemplates = { ...state.soItemTemplates };
                    delete nextTemplates[id];

                    return {
                        salesOrders: state.salesOrders.filter((so) => so.id !== id),
                        soItemTemplates: nextTemplates,
                    };
                });
            },

            setSoItemTemplates: async (soId, items) => {
                set((state) => ({
                    soItemTemplates: {
                        ...state.soItemTemplates,
                        [soId]: items,
                    },
                }));

                const amount = calculateAmountFromItems(items);
                set((state) => ({
                    salesOrders: state.salesOrders.map((so) =>
                        so.id === soId ? { ...so, amount } : so
                    ),
                }));
            },

            getSalesOrderById: (id) => get().salesOrders.find((so) => so.id === id),

            convertToInvoice: async (soId) => {
                const state = get();
                const salesOrder = state.salesOrders.find((so) => so.id === soId);
                if (!salesOrder) return null;

                if (salesOrder.convertedInvoiceId) {
                    return salesOrder.convertedInvoiceId;
                }

                const lineItems = state.soItemTemplates[soId] || [];
                const invoiceStore = useInvoiceStore.getState();
                const invoiceId = nextId('INV', invoiceStore.invoices || []);
                const amount = calculateAmountFromItems(lineItems) || toNumber(salesOrder.amount);

                const invoicePayload = {
                    id: invoiceId,
                    number: invoiceId,
                    customerId: salesOrder.customerId,
                    customerName: salesOrder.customerName,
                    date: salesOrder.date,
                    issueDate: salesOrder.date,
                    dueDate: salesOrder.expectedDate,
                    currency: salesOrder.currency || 'IDR',
                    amount,
                    status: 'Sent',
                    notes: `Converted from Sales Order ${salesOrder.id}${salesOrder.notes ? ` | ${salesOrder.notes}` : ''}`,
                };

                await invoiceStore.addInvoice(invoicePayload);
                await invoiceStore.setInvoiceItemTemplates(invoiceId, lineItems);

                set((current) => ({
                    salesOrders: current.salesOrders.map((so) =>
                        so.id === soId
                            ? { ...so, status: 'Invoiced', convertedInvoiceId: invoiceId }
                            : so
                    ),
                }));

                return invoiceId;
            },
        }),
        {
            name: 'msm-sales-orders',
            version: 1,
        }
    )
);

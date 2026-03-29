import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoiceWorkbenchData as seed } from '../data/invoiceWorkbenchData';

type E = { id: string } & Record<string, unknown>;

interface InvoiceWorkbenchStore {
    invoices:       E[];
    isLoading:      boolean;
    error:          string | null;
    addInvoice:     (invoice: E) => Promise<void>;
    updateInvoice:  (id: string, updates: Partial<E>) => Promise<void>;
    deleteInvoice:  (id: string) => Promise<void>;
    getInvoiceById: (id: string) => E | undefined;
}

export const useInvoiceWorkbenchStore = create<InvoiceWorkbenchStore>()(
    persist(
        (set, get) => ({
            invoices: seed,
            isLoading: false,
            error: null,

            addInvoice: async (invoice) => {
                set((state) => ({ invoices: [...state.invoices, invoice] }));
            },
            updateInvoice: async (id, updates) => {
                set((state) => ({
                    invoices: state.invoices.map((inv) =>
                        inv.id === id ? { ...inv, ...updates } : inv
                    ),
                }));
            },
            deleteInvoice: async (id) => {
                set((state) => ({
                    invoices: state.invoices.filter((inv) => inv.id !== id),
                }));
            },

            getInvoiceById: (id) => get().invoices.find((inv) => inv.id === id),
        }),
        {
            name: 'msm-invoice-workbench',
            version: 1,
        }
    )
);

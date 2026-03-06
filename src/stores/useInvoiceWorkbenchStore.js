import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoiceWorkbenchData as seed } from '../data/invoiceWorkbenchData';

export const useInvoiceWorkbenchStore = create(
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

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoices as seed, invoiceItemTemplates as templatesSeed } from '../data/mockData';

export const useInvoiceStore = create(
    persist(
        (set, get) => ({
            invoices: seed,
            invoiceItemTemplates: templatesSeed,
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

            setInvoiceItemTemplates: async (invoiceId, items) => {
                set((state) => ({
                    invoiceItemTemplates: {
                        ...state.invoiceItemTemplates,
                        [invoiceId]: items,
                    },
                }));
            },

            addInvoicesBatch: (arr) => {
                set((state) => ({ invoices: [...state.invoices, ...arr] }));
            },
            updateInvoicesBatch: (arr) => {
                set((state) => ({
                    invoices: state.invoices.map((inv) => {
                        const update = arr.find((u) => u.id === inv.id);
                        return update ? { ...inv, ...update } : inv;
                    }),
                }));
            },
            setInvoiceItemTemplatesBatch: (map) => {
                set((state) => ({
                    invoiceItemTemplates: { ...state.invoiceItemTemplates, ...map },
                }));
            },

            getInvoiceById: (id) => get().invoices.find((inv) => inv.id === id),
        }),
        {
            name: 'msm-invoices',
            version: 1,
        }
    )
);

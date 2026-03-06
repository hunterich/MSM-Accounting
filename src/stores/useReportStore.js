import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { salesLines as salesLinesSeed, agingInvoices as agingSeed } from '../data/mockData';

export const useReportStore = create(
    persist(
        (set, get) => ({
            salesLines: salesLinesSeed,
            agingInvoices: agingSeed,
            isLoading: false,
            error: null,

            addSalesLine: async (line) => {
                set((state) => ({ salesLines: [...state.salesLines, line] }));
            },

            updateAgingInvoice: async (invoiceId, updates) => {
                set((state) => ({
                    agingInvoices: state.agingInvoices.map((inv) =>
                        inv.invoiceId === invoiceId ? { ...inv, ...updates } : inv
                    ),
                }));
            },

            addAgingInvoice: async (invoice) => {
                set((state) => ({ agingInvoices: [...state.agingInvoices, invoice] }));
            },
        }),
        {
            name: 'msm-reports',
            version: 1,
        }
    )
);

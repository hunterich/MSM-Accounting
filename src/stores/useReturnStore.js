import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
    salesReturns as salesReturnsSeed,
    purchaseReturns as purchaseReturnsSeed,
    creditNotes as creditNotesSeed,
    debitNotes as debitNotesSeed,
} from '../data/mockData';

export const useReturnStore = create(
    persist(
        (set, get) => ({
            salesReturns: salesReturnsSeed,
            purchaseReturns: purchaseReturnsSeed,
            creditNotes: creditNotesSeed,
            debitNotes: debitNotesSeed,
            isLoading: false,
            error: null,

            // Sales Returns
            addSalesReturn: async (ret) => {
                set((state) => ({ salesReturns: [...state.salesReturns, ret] }));
            },
            updateSalesReturn: async (id, updates) => {
                set((state) => ({
                    salesReturns: state.salesReturns.map((r) =>
                        r.id === id ? { ...r, ...updates } : r
                    ),
                }));
            },

            // Purchase Returns
            addPurchaseReturn: async (ret) => {
                set((state) => ({ purchaseReturns: [...state.purchaseReturns, ret] }));
            },
            updatePurchaseReturn: async (id, updates) => {
                set((state) => ({
                    purchaseReturns: state.purchaseReturns.map((r) =>
                        r.id === id ? { ...r, ...updates } : r
                    ),
                }));
            },

            // Credit Notes
            addCreditNote: async (note) => {
                set((state) => ({ creditNotes: [...state.creditNotes, note] }));
            },
            updateCreditNote: async (id, updates) => {
                set((state) => ({
                    creditNotes: state.creditNotes.map((n) =>
                        n.id === id ? { ...n, ...updates } : n
                    ),
                }));
            },

            // Debit Notes
            addDebitNote: async (note) => {
                set((state) => ({ debitNotes: [...state.debitNotes, note] }));
            },
            updateDebitNote: async (id, updates) => {
                set((state) => ({
                    debitNotes: state.debitNotes.map((n) =>
                        n.id === id ? { ...n, ...updates } : n
                    ),
                }));
            },

            getSalesReturnById: (id) => get().salesReturns.find((r) => r.id === id),
            getPurchaseReturnById: (id) => get().purchaseReturns.find((r) => r.id === id),
        }),
        {
            name: 'msm-returns',
            version: 1,
        }
    )
);

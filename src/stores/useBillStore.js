import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { bills as seed, billItemTemplates as templatesSeed } from '../data/mockData';

export const useBillStore = create(
    persist(
        (set, get) => ({
            bills: seed,
            billItemTemplates: templatesSeed,
            isLoading: false,
            error: null,

            addBill: async (bill) => {
                set((state) => ({ bills: [...state.bills, bill] }));
            },
            updateBill: async (id, updates) => {
                set((state) => ({
                    bills: state.bills.map((b) =>
                        b.id === id ? { ...b, ...updates } : b
                    ),
                }));
            },
            deleteBill: async (id) => {
                set((state) => ({
                    bills: state.bills.filter((b) => b.id !== id),
                }));
            },

            setBillItemTemplates: async (billId, items) => {
                set((state) => ({
                    billItemTemplates: {
                        ...state.billItemTemplates,
                        [billId]: items,
                    },
                }));
            },

            getBillById: (id) => get().bills.find((b) => b.id === id),
        }),
        {
            name: 'msm-bills',
            version: 1,
        }
    )
);

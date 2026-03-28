import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { bills as seed, billItemTemplates as templatesSeed } from '../data/mockData';

type E = { id: string } & Record<string, unknown>;

interface BillStore {
    bills:               E[];
    billItemTemplates:   Record<string, E[]>;
    isLoading:           boolean;
    error:               string | null;
    addBill:             (bill: E) => Promise<void>;
    updateBill:          (id: string, updates: Partial<E>) => Promise<void>;
    deleteBill:          (id: string) => Promise<void>;
    setBillItemTemplates:(billId: string, items: E[]) => Promise<void>;
    getBillById:         (id: string) => E | undefined;
}

export const useBillStore = create<BillStore>()(
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

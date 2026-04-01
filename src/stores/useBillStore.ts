import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { bills as seed, billItemTemplates as templatesSeed } from '../data/mockData';

type BillRecord = { id: string } & Record<string, unknown>;
type BillLineTemplate = Record<string, unknown>;

interface BillStore {
    bills:               BillRecord[];
    billItemTemplates:   Record<string, BillLineTemplate[]>;
    isLoading:           boolean;
    error:               string | null;
    addBill:             (bill: BillRecord) => Promise<void>;
    updateBill:          (id: string, updates: Partial<BillRecord>) => Promise<void>;
    deleteBill:          (id: string) => Promise<void>;
    setBillItemTemplates:(billId: string, items: BillLineTemplate[]) => Promise<void>;
    getBillById:         (id: string) => BillRecord | undefined;
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

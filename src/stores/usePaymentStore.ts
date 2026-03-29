import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { arPayments as seed } from '../data/mockData';

type E = { id: string } & Record<string, unknown>;

interface ARPaymentStore {
    payments:           E[];
    isLoading:          boolean;
    error:              string | null;
    addPayment:         (payment: E) => Promise<void>;
    updatePayment:      (id: string, updates: Partial<E>) => Promise<void>;
    deletePayment:      (id: string) => Promise<void>;
    addPaymentsBatch:   (arr: E[]) => void;
    updatePaymentsBatch:(arr: E[]) => void;
    getPaymentById:     (id: string) => E | undefined;
}

export const usePaymentStore = create<ARPaymentStore>()(
    persist(
        (set, get) => ({
            payments: seed,
            isLoading: false,
            error: null,

            addPayment: async (payment) => {
                set((state) => ({ payments: [...state.payments, payment] }));
            },
            updatePayment: async (id, updates) => {
                set((state) => ({
                    payments: state.payments.map((p) =>
                        p.id === id ? { ...p, ...updates } : p
                    ),
                }));
            },
            deletePayment: async (id) => {
                set((state) => ({
                    payments: state.payments.filter((p) => p.id !== id),
                }));
            },

            addPaymentsBatch: (arr) => {
                set((state) => ({ payments: [...state.payments, ...arr] }));
            },
            updatePaymentsBatch: (arr) => {
                set((state) => ({
                    payments: state.payments.map((p) => {
                        const update = arr.find((u) => u.id === p.id);
                        return update ? { ...p, ...update } : p;
                    }),
                }));
            },

            getPaymentById: (id) => get().payments.find((p) => p.id === id),
        }),
        {
            name: 'msm-ar-payments',
            version: 2,
        }
    )
);

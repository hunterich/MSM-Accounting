import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apPayments as seed } from '../data/mockData';

type E = { id: string } & Record<string, unknown>;

interface APPaymentStore {
    apPayments:     E[];
    isLoading:      boolean;
    error:          string | null;
    addPayment:     (payment: E) => Promise<void>;
    updatePayment:  (id: string, updates: Partial<E>) => Promise<void>;
    deletePayment:  (id: string) => Promise<void>;
    getPaymentById: (id: string) => E | undefined;
}

export const useAPPaymentStore = create<APPaymentStore>()(
    persist(
        (set, get) => ({
            apPayments: seed,
            isLoading: false,
            error: null,

            addPayment: async (payment) => {
                set((state) => ({ apPayments: [...state.apPayments, payment] }));
            },
            updatePayment: async (id, updates) => {
                set((state) => ({
                    apPayments: state.apPayments.map((p) =>
                        p.id === id ? { ...p, ...updates } : p
                    ),
                }));
            },
            deletePayment: async (id) => {
                set((state) => ({
                    apPayments: state.apPayments.filter((p) => p.id !== id),
                }));
            },

            getPaymentById: (id) => get().apPayments.find((p) => p.id === id),
        }),
        {
            name: 'msm-ap-payments',
            version: 1,
        }
    )
);

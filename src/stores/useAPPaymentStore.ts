import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apPayments as seed } from '../data/mockData';
import type { APPayment } from '../types';

type APPaymentRecord = Omit<APPayment, '_id' | 'number' | 'totalAmount' | 'status'> & {
    _id?: string;
    number?: string;
    totalAmount?: number;
    status: APPayment['status'] | string;
    depositAccountId?: string;
    apAccountId?: string;
    discountAccountId?: string;
    penaltyAccountId?: string;
};

interface APPaymentStore {
    apPayments:     APPaymentRecord[];
    isLoading:      boolean;
    error:          string | null;
    addPayment:     (payment: APPaymentRecord) => Promise<void>;
    updatePayment:  (id: string, updates: Partial<APPaymentRecord>) => Promise<void>;
    deletePayment:  (id: string) => Promise<void>;
    getPaymentById: (id: string) => APPaymentRecord | undefined;
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

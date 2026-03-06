import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apPayments as seed } from '../data/mockData';

export const useAPPaymentStore = create(
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

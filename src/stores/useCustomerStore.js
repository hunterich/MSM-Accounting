import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { customers as seed, initialCustomerCategories as categoriesSeed } from '../data/mockData';

export const useCustomerStore = create(
    persist(
        (set, get) => ({
            customers: seed,
            customerCategories: categoriesSeed,
            isLoading: false,
            error: null,

            addCustomer: async (customer) => {
                set((state) => ({ customers: [...state.customers, customer] }));
            },
            updateCustomer: async (id, updates) => {
                set((state) => ({
                    customers: state.customers.map((c) =>
                        c.id === id ? { ...c, ...updates } : c
                    ),
                }));
            },
            deleteCustomer: async (id) => {
                set((state) => ({
                    customers: state.customers.filter((c) => c.id !== id),
                }));
            },

            addCategory: async (category) => {
                set((state) => ({
                    customerCategories: [...state.customerCategories, category],
                }));
            },
            updateCategory: async (id, updates) => {
                set((state) => ({
                    customerCategories: state.customerCategories.map((c) =>
                        c.id === id ? { ...c, ...updates } : c
                    ),
                }));
            },
            deleteCategory: async (id) => {
                set((state) => ({
                    customerCategories: state.customerCategories.filter((c) => c.id !== id),
                }));
            },

            getCustomerById: (id) => get().customers.find((c) => c.id === id),
            getCategoryById: (id) => get().customerCategories.find((c) => c.id === id),
        }),
        {
            name: 'msm-customers',
            version: 1,
        }
    )
);

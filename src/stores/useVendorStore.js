import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { vendors as seed } from '../data/mockData';

export const useVendorStore = create(
    persist(
        (set, get) => ({
            vendors: seed,
            isLoading: false,
            error: null,

            addVendor: async (vendor) => {
                set((state) => ({ vendors: [...state.vendors, vendor] }));
            },
            updateVendor: async (id, updates) => {
                set((state) => ({
                    vendors: state.vendors.map((v) =>
                        v.id === id ? { ...v, ...updates } : v
                    ),
                }));
            },
            deleteVendor: async (id) => {
                set((state) => ({
                    vendors: state.vendors.filter((v) => v.id !== id),
                }));
            },

            getVendorById: (id) => get().vendors.find((v) => v.id === id),
        }),
        {
            name: 'msm-vendors',
            version: 1,
        }
    )
);

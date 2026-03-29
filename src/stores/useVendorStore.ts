import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { vendors as seed } from '../data/mockData';

type E = { id: string } & Record<string, unknown>;

interface VendorStore {
    vendors:       E[];
    isLoading:     boolean;
    error:         string | null;
    addVendor:     (vendor: E) => Promise<void>;
    updateVendor:  (id: string, updates: Partial<E>) => Promise<void>;
    deleteVendor:  (id: string) => Promise<void>;
    getVendorById: (id: string) => E | undefined;
}

export const useVendorStore = create<VendorStore>()(
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

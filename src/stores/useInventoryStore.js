import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { products as productsSeed, warehouses as warehousesSeed } from '../data/mockData';

export const useInventoryStore = create(
    persist(
        (set, get) => ({
            products: productsSeed,
            warehouses: warehousesSeed,
            isLoading: false,
            error: null,

            adjustments: [
                {
                    id: 'ADJ-001',
                    date: new Date().toISOString().split('T')[0],
                    type: 'Quantity',
                    reason: 'Damage/Shrinkage',
                    status: 'Approved',
                    notes: 'Found damaged items during routine check',
                    items: [
                        { itemId: 'prod-001', itemName: 'Product Alpha', accountId: '5-101', oldQty: 45, newQty: 40, qtyDiff: -5, unitCost: 150000 }
                    ]
                }
            ],

            addAdjustment: (adj) => set((state) => ({ adjustments: [...state.adjustments, adj] })),
            updateAdjustment: (id, updates) => set((state) => ({
                adjustments: state.adjustments.map((a) =>
                    a.id === id ? { ...a, ...updates } : a
                ),
            })),

            addProduct: async (product) => {
                set((state) => ({ products: [...state.products, product] }));
            },
            updateProduct: async (id, updates) => {
                set((state) => ({
                    products: state.products.map((p) =>
                        p.id === id ? { ...p, ...updates } : p
                    ),
                }));
            },
            deleteProduct: async (id) => {
                set((state) => ({
                    products: state.products.filter((p) => p.id !== id),
                }));
            },

            addWarehouse: async (warehouse) => {
                set((state) => ({ warehouses: [...state.warehouses, warehouse] }));
            },
            updateWarehouse: async (id, updates) => {
                set((state) => ({
                    warehouses: state.warehouses.map((w) =>
                        w.id === id ? { ...w, ...updates } : w
                    ),
                }));
            },

            getProductById: (id) => get().products.find((p) => p.id === id),
        }),
        {
            name: 'msm-inventory',
            version: 1,
        }
    )
);

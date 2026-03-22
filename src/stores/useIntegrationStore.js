import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const initialShops = [
    {
        id: 'SHOP-001',
        platform: 'Shopee',
        name: 'My Beauty Store (ID)',
        customer: 'CUST-001',
        holdingAccount: 'BANK-005',
        status: 'Active',
        importStatusFilter: 'Selesai',
        itemMappings: {}
    },
    {
        id: 'SHOP-002',
        platform: 'TikTok',
        name: 'Viral Gadgets',
        customer: 'CUST-002',
        holdingAccount: 'BANK-006',
        status: 'Syncing',
        importStatusFilter: 'Selesai',
        itemMappings: {}
    }
];

export const useIntegrationStore = create(
    persist(
        (set, get) => ({
            shops: initialShops,

            addShop: (shop) => {
                set((state) => ({
                    shops: [...state.shops, {
                        ...shop,
                        importStatusFilter: shop.importStatusFilter || 'Selesai',
                        itemMappings: shop.itemMappings || {}
                    }]
                }));
            },

            updateShop: (id, updates) => {
                set((state) => ({
                    shops: state.shops.map((s) =>
                        s.id === id ? { ...s, ...updates } : s
                    ),
                }));
            },

            deleteShop: (id) => {
                set((state) => ({
                    shops: state.shops.filter((s) => s.id !== id),
                }));
            },

            updateItemMappings: (shopId, mappings) => {
                set((state) => ({
                    shops: state.shops.map((s) =>
                        s.id === shopId
                            ? { ...s, itemMappings: { ...s.itemMappings, ...mappings } }
                            : s
                    ),
                }));
            },

            getShopById: (id) => get().shops.find((s) => s.id === id),
        }),
        {
            name: 'msm-integrations',
            version: 1,
        }
    )
);

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface POItem {
    id:          string;
    accountId:   string;
    description: string;
    qty:         number;
    unit:        string;
    price:       number;
}

interface PO {
    id:           string;
    vendorId:     string;
    date:         string;
    expectedDate: string;
    amount:       number;
    status:       string;
    notes:        string;
}

interface PurchaseOrderStore {
    purchaseOrders:    PO[];
    poItemTemplates:   Record<string, POItem[]>;
    addPurchaseOrder:  (po: PO) => void;
    updatePurchaseOrder:(id: string, updatedData: Partial<PO>) => void;
    deletePurchaseOrder:(id: string) => void;
    setPoItemTemplates: (poId: string, items: POItem[]) => void;
}

export const usePurchaseOrderStore = create<PurchaseOrderStore>()(
    persist(
        (set, get) => ({
            purchaseOrders: [
                {
                    id: 'PO-2023-001',
                    vendorId: 'VEND-001',
                    date: '2023-11-01',
                    expectedDate: '2023-11-15',
                    amount: 5000000,
                    status: 'Approved',
                    notes: 'Initial stock order'
                },
                {
                    id: 'PO-2023-002',
                    vendorId: 'VEND-002',
                    date: '2023-11-05',
                    expectedDate: '2023-11-20',
                    amount: 2500000,
                    status: 'Draft',
                    notes: 'Office supplies replenishment'
                }
            ],
            poItemTemplates: {
                'PO-2023-001': [
                    { id: '1', accountId: '1-103', description: 'Inventory: Keyboards', qty: 50, unit: 'pcs', price: 100000 }
                ],
                'PO-2023-002': [
                    { id: '1', accountId: '6-101', description: 'Printer paper', qty: 10, unit: 'box', price: 250000 }
                ]
            },

            addPurchaseOrder: (po) => set((state) => ({ purchaseOrders: [...state.purchaseOrders, po] })),

            updatePurchaseOrder: (id, updatedData) => set((state) => ({
                purchaseOrders: state.purchaseOrders.map((po) => po.id === id ? { ...po, ...updatedData } : po)
            })),

            deletePurchaseOrder: (id) => set((state) => ({
                purchaseOrders: state.purchaseOrders.filter((po) => po.id !== id),
                poItemTemplates: Object.fromEntries(
                    Object.entries(state.poItemTemplates).filter(([key]) => key !== id)
                )
            })),

            setPoItemTemplates: (poId, items) => set((state) => ({
                poItemTemplates: {
                    ...state.poItemTemplates,
                    [poId]: items
                }
            }))
        }),
        {
            name: 'msm-po-storage',
            version: 1,
        }
    )
);

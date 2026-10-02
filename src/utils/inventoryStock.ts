/** Zero disables the low-stock threshold; exhausted/negative stock is out. */
export function stockStatusOf(qty: number, minimum: number): 'in' | 'low' | 'out' {
    if (qty <= 0) return 'out';
    return qty < minimum ? 'low' : 'in';
}

interface ReorderItem {
    id: string;
    name: string;
    sku: string;
    unit: string;
    type: string;
    isActive: boolean;
    currentStock: number;
    reorderPoint: number;
}

export function productsToReorder<T extends ReorderItem>(items: T[]) {
    return items
        .filter((item) => item.isActive && item.type !== 'SERVICE' && item.reorderPoint > 0 && item.currentStock < item.reorderPoint)
        .map((item) => ({
            ...item,
            stockPercent: Math.max(0, item.currentStock / item.reorderPoint * 100),
            shortage: item.reorderPoint - item.currentStock,
        }))
        .sort((a, b) => a.stockPercent - b.stockPercent || a.name.localeCompare(b.name));
}

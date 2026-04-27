import * as XLSX from 'xlsx';

// ── Raw XLSX row (after sheet_to_json) ────────────────────────────────────────

/** The raw row shape produced by `XLSX.utils.sheet_to_json` for a Shopee
 *  payment-report spreadsheet.  Keys are the Indonesian column headers. */
export interface ShopeeRawRow {
    'No. Pesanan'?: unknown;
    'Status Pesanan'?: unknown;
    'Waktu Pesanan Dibuat'?: unknown;
    'Waktu Pembayaran Dilakukan'?: unknown;
    'Waktu Pesanan Selesai'?: unknown;
    'SKU Induk'?: unknown;
    'Nama Produk'?: unknown;
    'Nomor Referensi SKU'?: unknown;
    'Nama Variasi'?: unknown;
    'Harga Awal'?: unknown;
    'Harga Setelah Diskon'?: unknown;
    'Jumlah'?: unknown;
    'Total Harga Produk'?: unknown;
    'Total Diskon'?: unknown;
    'Diskon Dari Penjual'?: unknown;
    'Diskon Dari Shopee'?: unknown;
    'Ongkos Kirim Dibayar oleh Pembeli'?: unknown;
    'Username (Pembeli)'?: unknown;
    'Nama Penerima'?: unknown;
    'No. Telepon'?: unknown;
    'Alamat Pengiriman'?: unknown;
    'Kota/Kabupaten'?: unknown;
    'Provinsi'?: unknown;
    'Metode Pembayaran'?: unknown;
    'Total Pembayaran'?: unknown;
    'No. Resi'?: unknown;
    [key: string]: unknown;
}

// ── Mapped (normalised) row ───────────────────────────────────────────────────

/** Row after applying COLUMN_MAP — values are still raw (string | number | Date). */
interface MappedRow {
    orderNumber: unknown;
    orderStatus: unknown;
    orderCreatedTime: unknown;
    paymentTime: unknown;
    orderCompletedTime: unknown;
    parentSKU: unknown;
    productName: unknown;
    skuReference: unknown;
    variationName: unknown;
    originalPrice: unknown;
    priceAfterDiscount: unknown;
    quantity: unknown;
    productTotal: unknown;
    totalDiscount: unknown;
    sellerDiscount: unknown;
    shopeeDiscount: unknown;
    buyerShippingCost: unknown;
    buyerUsername: unknown;
    recipientName: unknown;
    phone: unknown;
    shippingAddress: unknown;
    city: unknown;
    province: unknown;
    paymentMethod: unknown;
    totalPayment: unknown;
    trackingNumber: unknown;
    /** 1-based Excel row index (header = 1, first data row = 2). */
    _rowIndex: number;
    /** Allow dynamic key access via COLUMN_MAP entries. */
    [key: string]: unknown;
}

// ── Domain types ──────────────────────────────────────────────────────────────

/** A single line item extracted from a Shopee order row. */
export interface ShopeeLineItem {
    productName: string;
    variationName: string;
    priceAfterDiscount: number;
    quantity: number;
    productTotal: number;
    parentSKU: string;
    skuReference: string;
    sellerDiscount: number;
    shopeeDiscount: number;
}

/** A fully parsed Shopee order (one order may have multiple line items). */
export interface ParsedShopeeOrder {
    orderNumber: string;
    orderDate: string | null;
    paymentDate: string | null;
    completionDate: string | null;
    buyerUsername: string;
    recipientName: string;
    phone: string;
    shippingAddress: string;
    city: string;
    province: string;
    paymentMethod: string;
    trackingNumber: string;
    totalPayment: number;
    totalProductAmount: number;
    items: ShopeeLineItem[];
}

/** Unique product entry collected during parsing for the item-mapping step. */
export interface UniqueProduct {
    key: string;
    productName: string;
    variationName: string;
    parentSKU: string;
    skuReference: string;
}

/** Parse statistics returned alongside parsed orders. */
export interface ParseStats {
    totalRows: number;
    totalOrders: number;
    skippedRows: number;
    totalAmount: number;
    uniqueProductCount?: number;
}

/** Return value of `parseShopeeExcel`. */
export interface ShopeeParseResult {
    parsedOrders: ParsedShopeeOrder[];
    uniqueProducts: UniqueProduct[];
    warnings: string[];
    stats: ParseStats;
}

// ── Invoice / payment output types ───────────────────────────────────────────

/** A single invoice line item produced by `transformOrdersToInvoices`. */
export interface ShopeeInvoiceLineItem {
    id: string;
    description: string;
    quantity: number;
    unit: string;
    price: number;
    discount: number;
    inventoryItemId: string | null;
}

/** An invoice record ready to be pushed into the invoice store. */
export interface ShopeeInvoice {
    id: string;
    number: string;
    customerId: string;
    customerName: string;
    issueDate: string;
    date: string;
    dueDate: string;
    currency: string;
    amount: number;
    status: string;
    poNumber: string;
    billingAddress: string;
    shippingAddress: string;
    shippingDate: string;
    notes: string;
    shopId: string;
    attachments: unknown[];
    items: ShopeeInvoiceLineItem[];
    audit: AuditEntry[];
    journal: unknown[];
}

interface AuditEntry {
    id: string;
    date: string;
    action: string;
    user: string;
}

/** Legacy item-template entry (for `setInvoiceItemTemplatesBatch`). */
export interface ShopeeItemTemplate {
    id: string;
    itemName: string;
    qty: number;
    unit: string;
    price: number;
}

/** A payment record ready to be pushed into the payment store. */
export interface ShopeePayment {
    id: string;
    invoiceId: string;
    customerId: string;
    customerName: string;
    date: string;
    method: string;
    bankId: string;
    amount: number;
    status: string;
}

/** Transform configuration for `transformOrdersToInvoices`. */
export interface TransformConfig {
    customerId: string;
    customerName: string;
    shopId: string;
    invoiceStatus?: string;
    /** Which date field on a ParsedShopeeOrder to use as the invoice date. */
    dateField?: keyof Pick<ParsedShopeeOrder, 'completionDate' | 'paymentDate' | 'orderDate'>;
    holdingAccount?: string;
    itemMappings?: Record<string, string>;
    inventoryProducts?: Array<{ id: string; name: string; [key: string]: unknown }>;
}

/** Return value of `transformOrdersToInvoices`. */
export interface TransformResult {
    newInvoices: ShopeeInvoice[];
    updatedInvoices: ShopeeInvoice[];
    invoiceItemsMap: Record<string, ShopeeItemTemplate[]>;
    payments: ShopeePayment[];
    updatedPayments: ShopeePayment[];
    stats: {
        newCount: number;
        updateCount: number;
        totalAmount: number;
        paymentCount: number;
    };
}

// ── Column mapping: Shopee Indonesian headers → internal keys ─────────────────

const COLUMN_MAP: Record<string, keyof Omit<MappedRow, '_rowIndex'>> = {
    'No. Pesanan':                           'orderNumber',
    'Status Pesanan':                        'orderStatus',
    'Waktu Pesanan Dibuat':                  'orderCreatedTime',
    'Waktu Pembayaran Dilakukan':            'paymentTime',
    'Waktu Pesanan Selesai':                 'orderCompletedTime',
    'SKU Induk':                             'parentSKU',
    'Nama Produk':                           'productName',
    'Nomor Referensi SKU':                   'skuReference',
    'Nama Variasi':                          'variationName',
    'Harga Awal':                            'originalPrice',
    'Harga Setelah Diskon':                  'priceAfterDiscount',
    'Jumlah':                                'quantity',
    'Total Harga Produk':                    'productTotal',
    'Total Diskon':                          'totalDiscount',
    'Diskon Dari Penjual':                   'sellerDiscount',
    'Diskon Dari Shopee':                    'shopeeDiscount',
    'Ongkos Kirim Dibayar oleh Pembeli':     'buyerShippingCost',
    'Username (Pembeli)':                    'buyerUsername',
    'Nama Penerima':                         'recipientName',
    'No. Telepon':                           'phone',
    'Alamat Pengiriman':                     'shippingAddress',
    'Kota/Kabupaten':                        'city',
    'Provinsi':                              'province',
    'Metode Pembayaran':                     'paymentMethod',
    'Total Pembayaran':                      'totalPayment',
    'No. Resi':                              'trackingNumber',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a date cell from Shopee Excel.  Handles:
 * - JS Date objects (XLSX auto-converted)
 * - Strings like "2026-02-20 14:30" or "20/02/2026 14:30"
 * - Excel serial date numbers
 */
function parseDateCell(val: unknown): string | null {
    if (!val) return null;
    if (val instanceof Date) return val.toISOString().split('T')[0];
    if (typeof val === 'number') {
        // Excel serial date
        const d = XLSX.SSF.parse_date_code(val);
        if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
        return null;
    }
    const str = String(val).trim();
    // Try YYYY-MM-DD
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    // Try DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = str.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
    if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
    return null;
}

/** Parse numeric value, handling Indonesian format (1.500.000) */
function parseNum(val: unknown): number {
    if (val == null) return 0;
    if (typeof val === 'number') return val;
    const cleaned = String(val).replace(/\./g, '').replace(',', '.').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
}

/** Build a product key for item mapping (SKU-based if available, else product name) */
export function buildProductKey(item: Pick<ShopeeLineItem, 'parentSKU' | 'skuReference' | 'productName' | 'variationName'>): string {
    const sku = item.parentSKU || item.skuReference || '';
    const name = item.productName || '';
    const variation = item.variationName || '';
    if (sku) return `[${sku}] ${name}${variation ? ` - ${variation}` : ''}`;
    return `${name}${variation ? ` - ${variation}` : ''}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a Shopee Excel file and return grouped orders.
 * @param file - The .xlsx/.xls file
 * @param importStatusFilter - 'Selesai' or 'All'
 */
export async function parseShopeeExcel(
    file: File,
    importStatusFilter = 'Selesai',
): Promise<ShopeeParseResult> {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<ShopeeRawRow>(worksheet, { defval: '' });

    if (rawRows.length === 0) {
        return {
            parsedOrders: [],
            uniqueProducts: [],
            warnings: ['File is empty or has no data rows.'],
            stats: { totalRows: 0, totalOrders: 0, skippedRows: 0, totalAmount: 0 },
        };
    }

    // Validate expected columns
    const headers = Object.keys(rawRows[0]);
    const requiredCols = ['No. Pesanan', 'Nama Produk', 'Total Harga Produk'];
    const missingCols = requiredCols.filter((c) => !headers.includes(c));
    if (missingCols.length > 0) {
        return {
            parsedOrders: [],
            uniqueProducts: [],
            warnings: [`Missing required columns: ${missingCols.join(', ')}. This may not be a Shopee payment report.`],
            stats: { totalRows: rawRows.length, totalOrders: 0, skippedRows: rawRows.length, totalAmount: 0 },
        };
    }

    const warnings: string[] = [];
    let skippedRows = 0;

    // Map rows through COLUMN_MAP
    const mappedRows: MappedRow[] = rawRows.map((raw, idx) => {
        const row = {} as MappedRow;
        for (const [shopeeKey, internalKey] of Object.entries(COLUMN_MAP)) {
            row[internalKey] = raw[shopeeKey] ?? '';
        }
        row._rowIndex = idx + 2; // 1-based, +1 for header
        return row;
    });

    // Filter by status
    const filteredRows = mappedRows.filter((row) => {
        if (importStatusFilter === 'All') return true;
        const status = String(row.orderStatus).trim();
        if (status === importStatusFilter || status === 'Selesai') return true;
        skippedRows++;
        return false;
    });

    // Group by order number
    const orderMap = new Map<string, MappedRow[]>();
    for (const row of filteredRows) {
        const orderNum = String(row.orderNumber).trim();
        if (!orderNum) {
            warnings.push(`Row ${row._rowIndex}: Missing order number, skipped.`);
            continue;
        }
        if (!orderMap.has(orderNum)) {
            orderMap.set(orderNum, []);
        }
        orderMap.get(orderNum)!.push(row);
    }

    // Build parsed orders
    const parsedOrders: ParsedShopeeOrder[] = [];
    const productKeySet = new Map<string, UniqueProduct>();

    for (const [orderNumber, rows] of orderMap) {
        const first = rows[0];
        const items: ShopeeLineItem[] = rows.map((row) => {
            const item: ShopeeLineItem = {
                productName: String(row.productName).trim(),
                variationName: String(row.variationName).trim(),
                priceAfterDiscount: parseNum(row.priceAfterDiscount),
                quantity: parseNum(row.quantity) || 1,
                productTotal: parseNum(row.productTotal),
                parentSKU: String(row.parentSKU).trim(),
                skuReference: String(row.skuReference).trim(),
                sellerDiscount: parseNum(row.sellerDiscount),
                shopeeDiscount: parseNum(row.shopeeDiscount),
            };

            // Track unique products
            const key = buildProductKey(item);
            if (!productKeySet.has(key)) {
                productKeySet.set(key, {
                    key,
                    productName: item.productName,
                    variationName: item.variationName,
                    parentSKU: item.parentSKU,
                    skuReference: item.skuReference,
                });
            }

            return item;
        });

        const totalProductAmount = items.reduce((sum, it) => sum + it.productTotal, 0);

        parsedOrders.push({
            orderNumber,
            orderDate: parseDateCell(first.orderCreatedTime),
            paymentDate: parseDateCell(first.paymentTime),
            completionDate: parseDateCell(first.orderCompletedTime),
            buyerUsername: String(first.buyerUsername).trim(),
            recipientName: String(first.recipientName).trim(),
            phone: String(first.phone).trim(),
            shippingAddress: String(first.shippingAddress).trim(),
            city: String(first.city).trim(),
            province: String(first.province).trim(),
            paymentMethod: String(first.paymentMethod).trim(),
            trackingNumber: String(first.trackingNumber).trim(),
            totalPayment: parseNum(first.totalPayment),
            totalProductAmount,
            items,
        });
    }

    const totalAmount = parsedOrders.reduce((sum, o) => sum + o.totalProductAmount, 0);
    const uniqueProducts = Array.from(productKeySet.values());

    return {
        parsedOrders,
        uniqueProducts,
        warnings,
        stats: {
            totalRows: rawRows.length,
            totalOrders: parsedOrders.length,
            skippedRows,
            totalAmount,
            uniqueProductCount: uniqueProducts.length,
        },
    };
}

/**
 * Transform parsed orders into store-ready invoices.
 */
export function transformOrdersToInvoices(
    parsedOrders: ParsedShopeeOrder[],
    config: TransformConfig,
    existingInvoices: Array<{ id: string; number?: string; poNumber?: string; [key: string]: unknown }>,
): TransformResult {
    const {
        customerId,
        customerName,
        shopId,
        invoiceStatus = 'Paid',
        dateField = 'completionDate',
        holdingAccount = '',
        itemMappings = {},
        inventoryProducts = [],
    } = config;

    // Build existing order number → invoice id lookup for upsert
    const existingByPO = new Map<string, typeof existingInvoices[number]>();
    for (const inv of existingInvoices) {
        if (inv.poNumber) existingByPO.set(inv.poNumber, inv);
    }

    // Determine starting sequence number
    const getMaxSequence = (): number => {
        const nums = existingInvoices
            .map((inv) => (inv.number as string) || '')
            .map((n) => { const match = n.match(/(\d{3,})$/); return match ? parseInt(match[1], 10) : 0; });
        return Math.max(0, ...nums);
    };

    let seq = getMaxSequence() + 1;
    const formatSeq = (n: number): string => String(n).padStart(6, '0');

    const newInvoices: ShopeeInvoice[] = [];
    const updatedInvoices: ShopeeInvoice[] = [];
    const invoiceItemsMap: Record<string, ShopeeItemTemplate[]> = {};
    const payments: ShopeePayment[] = [];
    const updatedPayments: ShopeePayment[] = [];

    for (const order of parsedOrders) {
        const invoiceDate =
            (order[dateField as keyof ParsedShopeeOrder] as string | null) ||
            order.completionDate ||
            order.paymentDate ||
            order.orderDate ||
            new Date().toISOString().split('T')[0];
        const d = new Date(invoiceDate!);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');

        // Build line items with item mapping applied
        const lineItems: ShopeeInvoiceLineItem[] = order.items.map((item, idx) => {
            const productKey = buildProductKey(item);
            const mappedItemId = itemMappings[productKey];
            const mappedProduct = mappedItemId ? inventoryProducts.find((p) => p.id === mappedItemId) : null;

            return {
                id: `L${idx + 1}`,
                description: mappedProduct
                    ? mappedProduct.name
                    : (item.variationName ? `${item.productName} - ${item.variationName}` : item.productName),
                quantity: item.quantity,
                unit: 'PCS',
                price: item.priceAfterDiscount,
                discount: 0,
                inventoryItemId: mappedItemId || null,
            };
        });

        const existing = existingByPO.get(order.orderNumber);
        const invoiceId = existing ? existing.id : `INV-IMP-${Date.now()}-${seq}`;
        const invoiceNumber = existing ? ((existing.number as string) || '') : `INV/${yyyy}/${mm}/${formatSeq(seq)}`;

        if (!existing) seq++;

        const address = [order.shippingAddress, order.city, order.province].filter(Boolean).join(', ');
        const notes = `Shopee | Buyer: ${order.buyerUsername || order.recipientName} | Tracking: ${order.trackingNumber} | Method: ${order.paymentMethod}`;

        const invoiceData: ShopeeInvoice = {
            id: invoiceId,
            number: invoiceNumber,
            customerId,
            customerName,
            issueDate: invoiceDate!,
            date: invoiceDate!,
            dueDate: invoiceDate!,
            currency: 'IDR',
            amount: order.totalProductAmount,
            status: invoiceStatus === 'Paid' ? 'Paid' : 'Unpaid',
            poNumber: order.orderNumber,
            billingAddress: address,
            shippingAddress: address,
            shippingDate: order.completionDate || '',
            notes,
            shopId,
            attachments: [],
            items: lineItems,
            audit: [{
                id: 'A1',
                date: new Date().toISOString().replace('T', ' ').slice(0, 16),
                action: existing ? 'Updated (Shopee Import)' : 'Created (Shopee Import)',
                user: 'Admin',
            }],
            journal: [],
        };

        // Item templates for legacy store format
        invoiceItemsMap[invoiceId] = lineItems.map((li, idx) => ({
            id: li.inventoryItemId || `SHOPEE-${idx}`,
            itemName: li.description,
            qty: li.quantity,
            unit: li.unit,
            price: li.price,
        }));

        if (existing) {
            updatedInvoices.push(invoiceData);
        } else {
            newInvoices.push(invoiceData);
        }

        // Payment records (if Paid)
        if (invoiceStatus === 'Paid') {
            const paymentId = existing
                ? `PAY-IMP-${existing.id}`
                : `PAY-IMP-${invoiceId}`;

            const paymentData: ShopeePayment = {
                id: paymentId,
                invoiceId: invoiceId,
                customerId,
                customerName,
                date: invoiceDate!,
                method: mapPaymentMethod(order.paymentMethod),
                bankId: holdingAccount,
                amount: order.totalProductAmount,
                status: 'Completed',
            };

            if (existing) {
                updatedPayments.push(paymentData);
            } else {
                payments.push(paymentData);
            }
        }
    }

    return {
        newInvoices,
        updatedInvoices,
        invoiceItemsMap,
        payments,
        updatedPayments,
        stats: {
            newCount: newInvoices.length,
            updateCount: updatedInvoices.length,
            totalAmount: parsedOrders.reduce((s, o) => s + o.totalProductAmount, 0),
            paymentCount: payments.length + updatedPayments.length,
        },
    };
}

// ── Stock deficit check ───────────────────────────────────────────────────────

export interface StockDeficit {
    itemId: string;
    itemName: string;
    totalRequired: number;
    currentStock: number;
    deficit: number;
}

/**
 * Given parsed orders + item mappings, returns items whose total required qty
 * exceeds currentStock.  Call after mappings are finalised (Step 3).
 */
export function computeStockDeficits(
    orders: ParsedShopeeOrder[],
    itemMappings: Record<string, string>,
    inventoryItems: Array<{ id: string; name: string; currentStock: number }>,
): StockDeficit[] {
    const required = new Map<string, number>();
    for (const order of orders) {
        for (const item of order.items) {
            const itemId = itemMappings[buildProductKey(item)];
            if (!itemId) continue;
            required.set(itemId, (required.get(itemId) ?? 0) + item.quantity);
        }
    }
    const deficits: StockDeficit[] = [];
    for (const [itemId, totalRequired] of required) {
        const inv = inventoryItems.find((i) => i.id === itemId);
        if (!inv) continue;
        if (totalRequired > inv.currentStock) {
            deficits.push({
                itemId,
                itemName: inv.name,
                totalRequired,
                currentStock: inv.currentStock,
                deficit: totalRequired - inv.currentStock,
            });
        }
    }
    return deficits;
}

/** Map Shopee payment methods to app's method names */
function mapPaymentMethod(shopeeMethod: string): string {
    const m = String(shopeeMethod).toLowerCase();
    if (m.includes('cod')) return 'COD';
    if (m.includes('transfer')) return 'Bank Transfer';
    if (m.includes('kartu kredit') || m.includes('credit')) return 'Credit Card';
    if (m.includes('spaylater') || m.includes('shopee')) return 'SPayLater';
    return 'Other';
}

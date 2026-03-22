import * as XLSX from 'xlsx';

// Column mapping: Shopee Indonesian headers → internal keys
const COLUMN_MAP = {
    'No. Pesanan': 'orderNumber',
    'Status Pesanan': 'orderStatus',
    'Waktu Pesanan Dibuat': 'orderCreatedTime',
    'Waktu Pembayaran Dilakukan': 'paymentTime',
    'Waktu Pesanan Selesai': 'orderCompletedTime',
    'SKU Induk': 'parentSKU',
    'Nama Produk': 'productName',
    'Nomor Referensi SKU': 'skuReference',
    'Nama Variasi': 'variationName',
    'Harga Awal': 'originalPrice',
    'Harga Setelah Diskon': 'priceAfterDiscount',
    'Jumlah': 'quantity',
    'Total Harga Produk': 'productTotal',
    'Total Diskon': 'totalDiscount',
    'Diskon Dari Penjual': 'sellerDiscount',
    'Diskon Dari Shopee': 'shopeeDiscount',
    'Ongkos Kirim Dibayar oleh Pembeli': 'buyerShippingCost',
    'Username (Pembeli)': 'buyerUsername',
    'Nama Penerima': 'recipientName',
    'No. Telepon': 'phone',
    'Alamat Pengiriman': 'shippingAddress',
    'Kota/Kabupaten': 'city',
    'Provinsi': 'province',
    'Metode Pembayaran': 'paymentMethod',
    'Total Pembayaran': 'totalPayment',
    'No. Resi': 'trackingNumber',
};

/**
 * Parse a date cell from Shopee Excel. Handles:
 * - JS Date objects (XLSX auto-converted)
 * - Strings like "2026-02-20 14:30" or "20/02/2026 14:30"
 * - Excel serial date numbers
 */
function parseDateCell(val) {
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
function parseNum(val) {
    if (val == null) return 0;
    if (typeof val === 'number') return val;
    const cleaned = String(val).replace(/\./g, '').replace(',', '.').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
}

/** Build a product key for item mapping (SKU-based if available, else product name) */
export function buildProductKey(item) {
    const sku = item.parentSKU || item.skuReference || '';
    const name = item.productName || '';
    const variation = item.variationName || '';
    if (sku) return `[${sku}] ${name}${variation ? ` - ${variation}` : ''}`;
    return `${name}${variation ? ` - ${variation}` : ''}`;
}

/**
 * Parse a Shopee Excel file and return grouped orders.
 * @param {File} file - The .xlsx/.xls file
 * @param {string} importStatusFilter - 'Selesai' or 'All'
 * @returns {Promise<{parsedOrders: Array, uniqueProducts: Array, warnings: Array, stats: Object}>}
 */
export async function parseShopeeExcel(file, importStatusFilter = 'Selesai') {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (rawRows.length === 0) {
        return { parsedOrders: [], uniqueProducts: [], warnings: ['File is empty or has no data rows.'], stats: { totalRows: 0, totalOrders: 0, skippedRows: 0, totalAmount: 0 } };
    }

    // Validate expected columns
    const headers = Object.keys(rawRows[0]);
    const requiredCols = ['No. Pesanan', 'Nama Produk', 'Total Harga Produk'];
    const missingCols = requiredCols.filter(c => !headers.includes(c));
    if (missingCols.length > 0) {
        return {
            parsedOrders: [], uniqueProducts: [],
            warnings: [`Missing required columns: ${missingCols.join(', ')}. This may not be a Shopee payment report.`],
            stats: { totalRows: rawRows.length, totalOrders: 0, skippedRows: rawRows.length, totalAmount: 0 }
        };
    }

    const warnings = [];
    let skippedRows = 0;

    // Map rows through COLUMN_MAP
    const mappedRows = rawRows.map((raw, idx) => {
        const row = {};
        for (const [shopeeKey, internalKey] of Object.entries(COLUMN_MAP)) {
            row[internalKey] = raw[shopeeKey] ?? '';
        }
        row._rowIndex = idx + 2; // 1-based, +1 for header
        return row;
    });

    // Filter by status
    const filteredRows = mappedRows.filter(row => {
        if (importStatusFilter === 'All') return true;
        const status = String(row.orderStatus).trim();
        if (status === importStatusFilter || status === 'Selesai') return true;
        skippedRows++;
        return false;
    });

    // Group by order number
    const orderMap = new Map();
    for (const row of filteredRows) {
        const orderNum = String(row.orderNumber).trim();
        if (!orderNum) {
            warnings.push(`Row ${row._rowIndex}: Missing order number, skipped.`);
            continue;
        }
        if (!orderMap.has(orderNum)) {
            orderMap.set(orderNum, []);
        }
        orderMap.get(orderNum).push(row);
    }

    // Build parsed orders
    const parsedOrders = [];
    const productKeySet = new Map(); // key → { productName, variationName, parentSKU, skuReference }

    for (const [orderNumber, rows] of orderMap) {
        const first = rows[0];
        const items = rows.map((row) => {
            const item = {
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
export function transformOrdersToInvoices(parsedOrders, config, existingInvoices) {
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
    const existingByPO = new Map();
    for (const inv of existingInvoices) {
        if (inv.poNumber) existingByPO.set(inv.poNumber, inv);
    }

    // Determine starting sequence number
    const getMaxSequence = () => {
        const nums = existingInvoices
            .map(inv => inv.number || '')
            .map(n => { const match = n.match(/(\d{3,})$/); return match ? parseInt(match[1], 10) : 0; });
        return Math.max(0, ...nums);
    };

    let seq = getMaxSequence() + 1;
    const formatSeq = (n) => String(n).padStart(6, '0');

    const newInvoices = [];
    const updatedInvoices = [];
    const invoiceItemsMap = {};
    const payments = [];
    const updatedPayments = [];

    for (const order of parsedOrders) {
        const invoiceDate = order[dateField] || order.completionDate || order.paymentDate || order.orderDate || new Date().toISOString().split('T')[0];
        const d = new Date(invoiceDate);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');

        // Build line items with item mapping applied
        const lineItems = order.items.map((item, idx) => {
            const productKey = buildProductKey(item);
            const mappedItemId = itemMappings[productKey];
            const mappedProduct = mappedItemId ? inventoryProducts.find(p => p.id === mappedItemId) : null;

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
        const invoiceNumber = existing ? existing.number : `INV/${yyyy}/${mm}/${formatSeq(seq)}`;

        if (!existing) seq++;

        const address = [order.shippingAddress, order.city, order.province].filter(Boolean).join(', ');
        const notes = `Shopee | Buyer: ${order.buyerUsername || order.recipientName} | Tracking: ${order.trackingNumber} | Method: ${order.paymentMethod}`;

        const invoiceData = {
            id: invoiceId,
            number: invoiceNumber,
            customerId,
            customerName,
            issueDate: invoiceDate,
            date: invoiceDate,
            dueDate: invoiceDate,
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
                user: 'Admin'
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

            const paymentData = {
                id: paymentId,
                invoiceId: invoiceId,
                customerId,
                customerName,
                date: invoiceDate,
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

/** Map Shopee payment methods to app's method names */
function mapPaymentMethod(shopeeMethod) {
    const m = String(shopeeMethod).toLowerCase();
    if (m.includes('cod')) return 'COD';
    if (m.includes('transfer')) return 'Bank Transfer';
    if (m.includes('kartu kredit') || m.includes('credit')) return 'Credit Card';
    if (m.includes('spaylater') || m.includes('shopee')) return 'SPayLater';
    return 'Other';
}

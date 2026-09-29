import { prisma } from './prisma';
import { asMoney } from './money';
import { calculateMarketplaceOrderTotals, type ImportOrder } from './marketplace-import';

export interface PreviewOrder extends ImportOrder {
  sourceTotal: number;
  missingDate: boolean;
}

export interface PreviewOrderResult {
  orderNo: string;
  status: 'create' | 'logistics_update' | 'already_imported' | 'blocked';
  reason?: string;
  sourceTotal: number;
  invoiceTotal: number | null;
  taxAmount: number | null;
  difference: number | null;
}

export interface MarketplaceImportPreview {
  create: number;
  logisticsUpdates: number;
  alreadyImported: number;
  blocked: number;
  amountDifferences: number;
  sourceTotal: number;
  invoiceTotal: number;
  taxAmount: number;
  paymentAccountMissing: boolean;
  setupErrors: string[];
  orders: PreviewOrderResult[];
}

/** Read-only review using the same totals calculation and duplicate rule as import. */
export async function previewMarketplaceOrders(
  orgId: string,
  connectionId: string,
  orders: PreviewOrder[],
  options: { customerId?: string; recordPayment: boolean },
): Promise<MarketplaceImportPreview> {
  const [conn, org] = await Promise.all([
    prisma.ecommerceConnection.findFirst({
      where: { id: connectionId, organizationId: orgId },
      select: { customerId: true, holdingAccountId: true, mappings: true },
    }),
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { taxEnabled: true, taxDefaultRate: true, taxInclusiveByDefault: true },
    }),
  ]);
  if (!conn) throw new Error(`Ecommerce connection not found: ${connectionId}`);
  if (!org) throw new Error(`Organization not found: ${orgId}`);

  const orderNos = [...new Set(orders.map((order) => order.orderNo))];
  const itemIds = [...new Set(orders.flatMap((order) => order.lines.map((line) => line.itemId)).filter(Boolean))];
  const [existingInvoices, items] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: { organizationId: orgId, poNumber: { in: orderNos }, status: { not: 'VOID' } },
      select: { poNumber: true, shippingAddress: true, shippingCarrier: true, trackingNumber: true },
    }),
    prisma.item.findMany({
      where: { organizationId: orgId, id: { in: itemIds } },
      select: { id: true, name: true, isActive: true },
    }),
  ]);
  const existingByOrderNo = new Map(existingInvoices.map((invoice) => [invoice.poNumber, invoice]));
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const seenOrderNos = new Set<string>();
  const taxInclusive = Boolean(
    conn.mappings && typeof conn.mappings === 'object' && !Array.isArray(conn.mappings)
      ? (conn.mappings as Record<string, unknown>).vatInclusive
      : false,
  );
  const paymentAccountMissing = options.recordPayment && !conn.holdingAccountId;
  const setupErrors: string[] = [];
  if (!options.customerId && !conn.customerId) setupErrors.push('Select a default customer for this shop.');
  if (paymentAccountMissing) setupErrors.push('Choose a settlement/holding account for this shop, or import as Unpaid.');

  const result: MarketplaceImportPreview = {
    create: 0,
    logisticsUpdates: 0,
    alreadyImported: 0,
    blocked: 0,
    amountDifferences: 0,
    sourceTotal: 0,
    invoiceTotal: 0,
    taxAmount: 0,
    paymentAccountMissing,
    setupErrors,
    orders: [],
  };

  for (const order of orders) {
    const row: PreviewOrderResult = {
      orderNo: order.orderNo,
      status: 'create',
      sourceTotal: order.sourceTotal,
      invoiceTotal: null,
      taxAmount: null,
      difference: null,
    };
    const existing = existingByOrderNo.get(order.orderNo);
    if (seenOrderNos.has(order.orderNo)) {
      row.status = 'blocked';
      row.reason = 'Order number occurs more than once in this file';
      result.blocked++;
    } else if (existing) {
      if ((!existing.trackingNumber && order.trackingNumber) ||
          (!existing.shippingCarrier && order.shippingCarrier) ||
          (!existing.shippingAddress && order.shippingAddress)) {
        row.status = 'logistics_update';
        row.reason = 'Fill missing logistics details on the existing invoice';
        result.logisticsUpdates++;
      } else {
        row.status = 'already_imported';
        result.alreadyImported++;
      }
    } else if (order.missingDate) {
      row.status = 'blocked';
      row.reason = 'No usable order date; enter a date for orders missing one';
      result.blocked++;
    } else if (order.sourceTotal < 0 || order.lines.some((line) =>
      line.quantity < 0 || line.unitPrice < 0 || !line.description.trim())) {
      row.status = 'blocked';
      row.reason = 'Invalid product amount, quantity, price, or description in the export';
      result.blocked++;
    } else {
      const invalidLine = order.lines.find((line) => {
        const item = itemsById.get(line.itemId);
        return !item || !item.isActive;
      });
      if (invalidLine) {
        const item = itemsById.get(invalidLine.itemId);
        row.status = 'blocked';
        row.reason = item ? `Inactive product: ${item.name}` : 'Unknown or unmapped inventory product';
        result.blocked++;
      } else {
        const totals = calculateMarketplaceOrderTotals(order, org, taxInclusive);
        row.invoiceTotal = totals.totalAmount;
        row.taxAmount = totals.taxAmount;
        row.difference = asMoney(totals.totalAmount - order.sourceTotal);
        result.create++;
        result.sourceTotal = asMoney(result.sourceTotal + order.sourceTotal);
        result.invoiceTotal = asMoney(result.invoiceTotal + totals.totalAmount);
        result.taxAmount = asMoney(result.taxAmount + totals.taxAmount);
        if (row.difference !== 0) result.amountDifferences++;
      }
    }
    result.orders.push(row);
    seenOrderNos.add(order.orderNo);
  }

  return result;
}

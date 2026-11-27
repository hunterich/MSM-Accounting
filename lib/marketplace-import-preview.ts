import { prisma } from './prisma';
import { MoneyDecimal, roundMoneyDecimal } from './money-decimal';
import { calculateMarketplaceOrderTotals, marketplaceReturnReviewReason, type ImportOrder } from './marketplace-import';
import { isMarketplaceReversalStatus, isMarketplaceShippedStatus } from '@/src/utils/marketplaceLifecycle';

export interface PreviewOrder extends ImportOrder {
  sourceTotal: string | number;
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

  let sourceTotal = new MoneyDecimal(0);
  let invoiceTotal = new MoneyDecimal(0);
  let taxAmount = new MoneyDecimal(0);
  for (const order of orders) {
    const sourceAmount = roundMoneyDecimal(order.sourceTotal);
    const row: PreviewOrderResult = {
      orderNo: order.orderNo,
      status: 'create',
      sourceTotal: sourceAmount.toNumber(),
      invoiceTotal: null,
      taxAmount: null,
      difference: null,
    };
    const existing = existingByOrderNo.get(order.orderNo);
    if (seenOrderNos.has(order.orderNo)) {
      row.status = 'blocked';
      row.reason = 'Order number occurs more than once in this file';
      result.blocked++;
    } else if (order.requiresReturnReview) {
      row.status = 'blocked';
      row.reason = marketplaceReturnReviewReason(Boolean(existing));
      result.blocked++;
    } else if (order.orderStatus && isMarketplaceReversalStatus(order.orderStatus)) {
      row.status = 'blocked';
      row.reason = existing
        ? 'Imported order: create a linked sales return and credit note, then reconcile the settlement refund. Restock only goods actually received.'
        : 'Cancelled/returned order: no new sale will be posted. If it was dispatched, record the verified original shipment first, then its linked return.';
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
    } else if (order.orderStatus && !isMarketplaceShippedStatus(order.orderStatus) && !order.shipmentDate) {
      row.status = 'blocked';
      row.reason = 'No confirmed shipment; supply the verified dispatch date before importing.';
      result.blocked++;
    } else if (order.missingDate) {
      row.status = 'blocked';
      row.reason = 'No usable order date; enter a date for orders missing one';
      result.blocked++;
    } else if (new MoneyDecimal(order.sourceTotal).lt(0) || order.lines.some((line) =>
      new MoneyDecimal(line.quantity).lt(0) || new MoneyDecimal(line.unitPrice).lt(0) ||
      new MoneyDecimal(line.sourceLineAmount ?? 0).lt(0) || !line.description.trim())) {
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
        row.invoiceTotal = totals.totalAmount.toNumber();
        row.taxAmount = totals.taxAmount.toNumber();
        const difference = totals.totalAmount.minus(sourceAmount);
        row.difference = difference.toNumber();
        result.create++;
        sourceTotal = sourceTotal.plus(sourceAmount);
        invoiceTotal = invoiceTotal.plus(totals.totalAmount);
        taxAmount = taxAmount.plus(totals.taxAmount);
        if (!difference.isZero()) result.amountDifferences++;
      }
    }
    result.orders.push(row);
    seenOrderNos.add(order.orderNo);
  }

  return { ...result, sourceTotal: sourceTotal.toNumber(), invoiceTotal: invoiceTotal.toNumber(), taxAmount: taxAmount.toNumber() };
}

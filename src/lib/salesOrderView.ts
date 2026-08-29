import type { SalesOrder, SalesOrderItem } from '../types';

/**
 * Adapts an API sales order to what the SO list and detail panes render.
 *
 * Those panes used to read a browser-local zustand store seeded with three
 * fixtures ("Acme Corp", "Globex Inc"), while `SOFormV2` saved to
 * `/api/v1/sales-orders`. So a saved order never appeared in its own list. The
 * panes now read the API, and this maps its field names onto the ones they
 * already use rather than rewriting the presentation.
 *
 * `amount` is derived, because `SalesOrder` has no total column: the sum of
 * qty x price less the per-line discount, which is exactly `computeTotals`'
 * subtotal. It carries no tax — the SO schema stores no tax rate, so there is
 * nothing to apply and nothing to disagree with.
 */

export interface SalesOrderLineView {
    id: string;
    description: string;
    /** The panes and print templates read `qty`; the API sends `quantity`. */
    qty: number;
    unit: string;
    price: number;
    discount: number;
}

export interface SalesOrderView {
    /** The cuid. Navigation and every lookup key off this, not the number. */
    id: string;
    /** What a person calls this order — the document number, or the id if unnumbered. */
    no: string;
    customerId: string;
    customerName: string;
    date: string;
    expectedDate: string;
    /** Title case, which is what the panes' status maps and gates expect. */
    status: string;
    currency: string;
    amount: number;
    notes: string;
    convertedInvoiceId: string | null;
    items: SalesOrderLineView[];
}

/** Net of one line: gross less the line's discount percentage. */
function lineNet(item: SalesOrderItem): number {
    const gross = (Number(item.quantity) || 0) * (Number(item.price) || 0);
    return gross - gross * ((Number(item.discount) || 0) / 100);
}

export function salesOrderAmount(items: readonly SalesOrderItem[] = []): number {
    return items.reduce((sum, item) => sum + lineNet(item), 0);
}

/** `DRAFT` / `draft` -> `Draft`. The API sends lowercase; the panes compare Title case. */
export function titleCaseStatus(status: string | null | undefined): string {
    const s = String(status ?? '').trim();
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function toSalesOrderLines(so: Pick<SalesOrder, 'items'> | null | undefined): SalesOrderLineView[] {
    return (so?.items ?? []).map((item, index) => ({
        id: item.id || `${so?.items?.[index]?.code || 'line'}-${index + 1}`,
        description: item.description || '',
        qty: Number(item.quantity) || 0,
        unit: item.unit || 'PCS',
        price: Number(item.price) || 0,
        discount: Number(item.discount) || 0,
    }));
}

export function toSalesOrderView(so: SalesOrder): SalesOrderView {
    return {
        id: so.id,
        no: so.number || so.id,
        customerId: so.customerId || '',
        customerName: so.customerName || '',
        date: so.issueDate || '',
        expectedDate: so.expiryDate || '',
        status: titleCaseStatus(so.status),
        // The SO schema has no currency column; every document is IDR today.
        currency: 'IDR',
        amount: salesOrderAmount(so.items),
        notes: so.notes || '',
        convertedInvoiceId: so.invoiceId ?? null,
        items: toSalesOrderLines(so),
    };
}

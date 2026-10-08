import React from 'react';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-dom/server is available at runtime; this project does not ship @types/react-dom.
import { renderToStaticMarkup } from 'react-dom/server';
import InvoiceCatalogPanel from '../InvoiceCatalogPanel';
import { invoiceListQuery } from '../invoiceListQuery';

const emptyFilters = { searchTerm: '', status: '', dateFrom: '', dateTo: '' };
const callbacks = {
    onSearchChange: vi.fn(), onFilterChange: vi.fn(), onDateRangeChange: vi.fn(),
    onSelectInvoice: vi.fn(), onViewInvoice: vi.fn(), onEditInvoice: vi.fn(), onPrintInvoice: vi.fn(),
};
function panel(page: number, total: number, busy = false) {
    return renderToStaticMarkup(<InvoiceCatalogPanel data={[]} filters={emptyFilters} {...callbacks}
        pagination={{ page, limit: 20, total, busy, onPageChange: vi.fn(), onLimitChange: vi.fn() }} />);
}

describe('invoice list pagination', () => {
    it('requests filters and later pages from the API instead of filtering one page locally', () => {
        expect(invoiceListQuery({ searchTerm: ' Shopee ', status: 'Paid', dateFrom: '2026-09-01', dateTo: '2026-09-30' }, 3, 50))
            .toEqual({ page: 3, limit: 50, search: 'Shopee', status: 'PAID', dateFrom: '2026-09-01', dateTo: '2026-09-30' });
        expect(invoiceListQuery(emptyFilters, 1, 20)).toEqual({ page: 1, limit: 20 });
    });

    it('shows total records and page controls for a large catalog', () => {
        const html = panel(1, 350000);
        expect(html).toContain('Showing 1–20 of 350,000 invoices');
        expect(html).toContain('Page 1 of 17,500');
        expect(html).toMatch(/aria-label="Previous invoice page" disabled/);
        expect(html).not.toMatch(/aria-label="Next invoice page" disabled/);
        expect(html).toContain('aria-label="Go to invoice page"');
        expect(html).toContain('aria-label="Invoices per page"');
    });

    it('disables Next on the final page and handles an empty result', () => {
        expect(panel(3, 45)).toContain('Showing 41–45 of 45 invoices');
        expect(panel(3, 45)).toMatch(/aria-label="Next invoice page" disabled/);
        expect(panel(1, 0)).toContain('Showing 0–0 of 0 invoices');
        expect(panel(1, 0)).toMatch(/aria-label="Next invoice page" disabled/);
    });

    it('prevents page changes while a request is in progress', () => {
        const html = panel(2, 45, true);
        expect(html).toContain('Loading invoices…');
        expect(html).toMatch(/aria-label="Previous invoice page" disabled/);
        expect(html).toMatch(/aria-label="Next invoice page" disabled/);
    });
});

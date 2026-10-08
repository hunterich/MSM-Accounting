import React from 'react';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error This project does not ship @types/react-dom.
import { renderToStaticMarkup } from 'react-dom/server';
import Table from '../Table';
import ListPagination from '../ListPagination';

const callbacks = { onPageChange: vi.fn(), onLimitChange: vi.fn() };
describe('shared catalog pagination', () => {
    it('uses the server total instead of the current page length', () => {
        const html = renderToStaticMarkup(<Table columns={[{ key: 'id', label: 'Number' }]} data={[{ id: 'BILL-021' }]}
            countLabel="bills" pagination={{ ...callbacks, page: 2, limit: 20, total: 350000 }} />);
        expect(html).toContain('Showing 21–40 of 350,000 bills');
        expect(html).toContain('Page 2 of 17,500');
        expect(html).toContain('overflow-auto');
    });
    it('keeps controls available for an empty page and distinguishes failures from no matches', () => {
        const html = renderToStaticMarkup(<Table columns={[]} data={[]} error={new Error('Connection lost')}
            countLabel="payments" pagination={{ ...callbacks, page: 1, limit: 20, busy: true }} />);
        expect(html).toContain('role="alert"');
        expect(html).toContain('Connection lost');
        expect(html).not.toContain('No data available');
        expect(html).toContain('payments pagination');
        expect(html).toMatch(/disabled="">Next/);
    });
    it('disables forward navigation on the final page without inflating the visible range', () => {
        const html = renderToStaticMarkup(<ListPagination {...callbacks} page={4} limit={20} total={65} label="customers" />);
        expect(html).toContain('Showing 61–65 of 65 customers');
        expect(html).toMatch(/disabled="">Next/);
        expect(html).toMatch(/disabled="">Last/);
    });
});

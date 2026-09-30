import React from 'react';
// @ts-expect-error react-dom/server is present at runtime but this project does not ship @types/react-dom.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import InvoicePrintTemplate from '../InvoicePrintTemplate';
import InvoiceItemsTab from '../../ar/invoices/InvoiceItemsTab';
import InvoiceSummaryTab from '../../ar/invoices/InvoiceSummaryTab';

// The summary now also includes an API-backed payment panel. This test checks
// the saved invoice amounts, so keep the panel out of its static render.
vi.mock('../../documents/DocumentSettlementPanel', () => ({ default: () => null }));

describe('saved invoice printing', () => {
    it('shows the saved 11% tax and total rather than recalculating from defaults', () => {
        const html = renderToStaticMarkup(
            <InvoicePrintTemplate
                invoice={{
                    number: 'INV/2026/09/004536', customerName: 'Shopee Cultusia',
                    issueDate: '2026-09-18', subtotal: 99_000, taxEnabled: true,
                    taxInclusive: false, taxRate: 11, taxAmount: 10_890,
                    totalAmount: 109_890, status: 'Paid',
                }}
                lineItems={[{ description: 'Hair tonic', quantity: 1, price: 46_000 },
                    { description: 'Hair care', quantity: 1, price: 53_000 }]}
                taxRate={12}
            />,
        );

        expect(html).toContain('PPN 11%');
        expect(html).toContain('10.890');
        expect(html).toContain('109.890');
        expect(html).not.toContain('PPN 12%');
    });

    it('labels inclusive tax without adding it to the stored total again', () => {
        const html = renderToStaticMarkup(
            <InvoicePrintTemplate invoice={{
                number: 'INCLUSIVE', subtotal: 111_000, taxEnabled: true,
                taxInclusive: true, taxRate: 11, taxAmount: 11_000, totalAmount: 111_000,
            }} />,
        );
        expect(html).toContain('PPN 11% (included)');
        expect(html).toContain('111.000');
        expect(html).not.toContain('122.000');
    });

    it('explains the product subtotal-to-total difference on the invoice screen', () => {
        const invoice = {
            id: 'invoice-1', items: [{ description: 'Hair tonic', quantity: 1, price: 99_000 }],
            subtotal: 99_000, taxEnabled: true, taxInclusive: false, taxRate: 11,
            taxAmount: 10_890, amount: 109_890,
        };
        const items = renderToStaticMarkup(<InvoiceItemsTab invoice={invoice} />);
        const summary = renderToStaticMarkup(<InvoiceSummaryTab invoice={invoice} />);

        for (const html of [items, summary]) {
            expect(html).toContain('PPN 11%');
            expect(html).toContain('10.890');
            expect(html).toContain('109.890');
        }
    });
});

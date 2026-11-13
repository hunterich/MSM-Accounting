import React from 'react';
import { describe, expect, it } from 'vitest';
// @ts-expect-error react-dom/server is available at runtime without its declaration package.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ReportResult from '../ReportResult';
import { ALL_REPORTS, findReportById } from '../reportDefinitions';
import { buildInventoryCsv, buildSalesCsv } from '../reportCsv';
import type { OpenReportEntry, ReportType } from '../reportTypes';

function entry(id: ReportType, data: unknown): OpenReportEntry {
  return {
    report: findReportById(id)!, data, params: { type: id },
    dateFrom: null, dateTo: null, asOfDate: null,
  };
}

const categories = new Map([['category-1', 'Medical supplies']]);
function render(activeReport: OpenReportEntry) {
  return renderToStaticMarkup(<MemoryRouter><ReportResult activeReport={activeReport}
    isLoading={false} error={null} categoryNameById={categories} /></MemoryRouter>);
}

describe('report output after splitting renderers', () => {
  it.each(ALL_REPORTS)('renders the $id report for an empty result', (report) => {
    const html = render(entry(report.id, {
      rows: [], sections: [], items: [], banks: [], accounts: [], grandTotal: 0,
      asOf: '2026-10-16', kind: report.category === 'ap' ? 'ap' : 'ar',
      totals: { glBalance: 0, subledgerBalance: 0, difference: 0 },
      summary: { aging: { current: 0, d1To30: 0, d31To60: 0, d61To90: 0, d90Plus: 0 } },
      party: { id: 'party', code: 'P001', name: 'Statement party' },
      period: { dateFrom: '2026-10-01', dateTo: '2026-10-16' }, openingBalance: 0,
    }));
    expect(html).not.toContain('No renderer');
    expect(html.length).toBeGreaterThan(0);
  });

  it('keeps customer sales and quoted names in the table and CSV', () => {
    const data = { rows: [{ customerId: 'c1', customerName: 'Customer, "West"', invoiceCount: 2, total: 125000 }], grandTotal: 125000 };
    const report = entry('by-customer', data);
    expect(render(report)).toContain('Customer, &quot;West&quot;');
    expect(render(report)).toContain('125.000');
    const csv = buildSalesCsv(report.report, data);
    expect(csv).toContain('"Customer, ""West"""');
    expect(csv).toContain('125000');
  });

  it('resolves inventory category names in both output formats', () => {
    const data = {
      items: [{ itemId: 'i1', sku: 'SKU001', name: 'Bandage', categoryId: 'category-1', unit: 'PCS', totalQty: 4, avgCost: 2500, totalValue: 10000 }],
      summary: { totalItems: 1, totalValue: 10000 },
    };
    const report = entry('stock-valuation', data);
    expect(render(report)).toContain('Medical supplies');
    expect(render(report)).toContain('10.000');
    expect(buildInventoryCsv(report.report, data, categories)).toContain('"Medical supplies",4,2500,10000');
  });
});

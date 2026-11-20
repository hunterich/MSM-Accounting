import React from 'react';
import { describe, expect, it } from 'vitest';
// @ts-expect-error react-dom/server is available at runtime without its declaration package.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ReportResult from '../ReportResult';
import { ALL_REPORTS, findReportById } from '../reportDefinitions';
import { buildApCsv, buildBankingCsv, buildInventoryCsv, buildSalesCsv } from '../reportCsv';
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

  it('shows and exports AP aging bill numbers, buckets, and totals returned by the API', () => {
    const data = {
      rows: [{ billId: 'internal-id', billNumber: 'BILL-123', vendorName: 'Vendor A', billDate: '2026-01-01', dueDate: '2026-01-31', daysOverdue: 45, current: 0, d1To30: 0, d31To60: 125000, d61To90: 0, d90Plus: 0, balance: 125000 }],
      summary: { current: 0, d1To30: 0, d31To60: 125000, d61To90: 0, d90Plus: 0, totalOutstanding: 125000 },
    };
    const report = entry('ap-aging', data);
    const html = render(report);
    expect(html).toContain('BILL-123');
    expect(html).toContain('31-60: Rp');
    expect(html).toContain('125.000');
    expect(html).toMatch(/Total Outstanding:[\s\S]*125\.000/);
    const csv = buildApCsv(report.report, data);
    expect(csv).toContain('"BILL-123","Vendor A"');
    expect(csv).toContain(',0,0,125000,0,0,125000');
    expect(csv).toContain('Total,,,,,0,0,125000,0,0,125000');
  });

  it('shows and exports bank cash flow amounts with transfer disclosure', () => {
    const data = { rows: [{ bankAccountId: 'A', bankAccountName: 'BCA', date: '2026-06-15', inflow: 120000, outflow: 0, net: 120000 }], summary: { totalInflow: 120000, totalOutflow: 0, totalNet: 120000 } };
    const report = entry('cash-flow', data);
    const html = render(report);
    expect(html).toContain('BCA');
    expect(html).toContain('120.000');
    expect(html).toContain('internal transfers appear on both sides');
    const csv = buildBankingCsv(report.report, data);
    expect(csv).toContain('"BCA","2026-06-15",120000,0,120000');
    expect(csv).toContain('Total,,120000,0,120000');
  });

  it('warns when the trial balance or balance sheet is out of balance (#228)', () => {
    const tbRow = { accountId: 'a', accountCode: '1', accountName: 'Cash', accountType: 'ASSET', totalDebit: 10, totalCredit: 0, endingDebit: 10, endingCredit: 0 };
    const tb = (totalCredit: number) => render(entry('trial-balance', {
      rows: [tbRow], summary: { totalDebit: 4342000, totalCredit, endingDebit: 10, endingCredit: 10 },
    }));
    expect(tb(4352000)).toContain('Trial Balance is out of balance');
    expect(tb(4342000)).not.toContain('out of balance');

    const bsRow = { accountId: 'a', accountCode: '1', accountName: 'Cash', amount: 1876000 };
    const bs = (totalLiabilitiesAndEquity: number) => render(entry('balance-sheet', {
      sections: [{ id: 'ASSET', label: 'Assets', rows: [bsRow], total: 1876000 }],
      summary: { totalAssets: 1876000, totalLiabilities: 0, totalEquity: totalLiabilitiesAndEquity, totalLiabilitiesAndEquity },
    }));
    expect(bs(1886000)).toContain('Balance Sheet does not balance');
    expect(bs(1876000)).not.toContain('does not balance');
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

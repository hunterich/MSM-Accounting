import { describe, expect, it } from 'vitest';
import { reportParamsKey, reportTabId, reportTabTarget, reportTabTitle } from '../reportTabs';
import type { ReportDefinition, ReportParams } from '../../../views/reports/Reports';

const report = { id: 'by-customer', name: 'Sales by Customer' } as ReportDefinition;
const october = { type: 'by-customer', dateFrom: '2026-10-01', dateTo: '2026-10-08' } as ReportParams;

describe('report workspace tabs', () => {
    it('maps equal filters to one tab regardless of key order or empty values', () => {
        const reordered = { dateTo: '2026-10-08', customerSearch: '', type: 'by-customer', dateFrom: '2026-10-01' } as ReportParams;
        expect(reportParamsKey(reordered)).toBe(reportParamsKey(october));
        expect(reportTabId(report, reordered)).toBe(reportTabId(report, october));
    });

    it('opens a separate tab for different filters of the same report', () => {
        const september = { ...october, dateFrom: '2026-09-01', dateTo: '2026-09-30' };
        expect(reportTabId(report, september)).not.toBe(reportTabId(report, october));
        expect(reportTabTarget(report, october)).toMatchObject({ module: 'reports', entity: 'by-customer', mode: 'view' });
    });

    it('labels tabs with their period so side-by-side tabs are distinguishable', () => {
        expect(reportTabTitle(report, october)).toBe('Sales by Customer · 01/10/2026–08/10/2026');
        expect(reportTabTitle(report, { type: 'by-customer', asOfDate: '2026-10-08' } as ReportParams)).toBe('Sales by Customer · 08/10/2026');
        expect(reportTabTitle(report, undefined)).toBe('Sales by Customer');
    });
});

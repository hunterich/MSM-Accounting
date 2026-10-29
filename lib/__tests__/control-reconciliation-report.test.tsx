import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ControlReconciliation } from '../../lib/control-reconciliation';
import {
  controlReconciliationKind,
  controlReviewSummary,
  controlReconciliationCsv,
} from '../../src/views/reports/controlReconciliation';
import ControlReconciliationReport from '../../src/views/reports/ControlReconciliationReport';
import { buildPdfTableFromCsv } from '../../src/utils/exportPdf';
const fixture = (): ControlReconciliation => ({
  kind: 'ar',
  asOf: '2026-09-30T16:59:59.999Z',
  totals: { glBalance: 1170, subledgerBalance: 1170, difference: 0 },
  accounts: [
    {
      accountId: 'primary',
      accountCode: '1200',
      accountName: 'AR trade',
      isDefault: true,
      glBalance: 645,
      subledgerBalance: 570,
      difference: 75,
      subledger: { documents: 1110, settlements: -540, notes: 0, opening: 0 },
      opening: { subledger: 0, gl: 0 },
      items: [
        {
          category: 'UNLINKED_JOURNAL',
          reference: 'Historical reclass',
          date: '2026-09-25',
          entryNo: 'JE-001',
          source: 'MANUAL',
          amount: 75,
          message: 'Manual journal JE-001 (Historical reclass)',
        },
      ],
    },
    {
      accountId: 'alternate',
      accountCode: '1215',
      accountName: 'AR related',
      isDefault: false,
      glBalance: 525,
      subledgerBalance: 600,
      difference: -75,
      subledger: { documents: 900, settlements: -200, notes: -100, opening: 0 },
      opening: { subledger: 0, gl: 0 },
      items: [
        {
          category: 'UNLINKED_JOURNAL',
          reference: 'Historical reclass',
          date: '2026-09-25',
          source: 'MANUAL',
          amount: -75,
          message: 'Opposing historical reclass',
        },
      ],
    },
  ],
});
describe('control reconciliation report output', () => {
  it('maps each report to its own control kind', () => {
    expect(controlReconciliationKind('ar-control-reconciliation')).toBe('ar');
    expect(controlReconciliationKind('ap-control-reconciliation')).toBe('ap');
    expect(controlReconciliationKind('aging')).toBeUndefined();
  });
  it('never clears offsetting account differences just because company totals agree', () => {
    const data = fixture(),
      html = renderToStaticMarkup(<ControlReconciliationReport data={data} />);
    expect(controlReviewSummary(data)).toContain(
      'Review required: 2 control accounts',
    );
    expect(html).toContain('Company totals can hide offsetting differences');
    expect(html).toContain('1200 — AR trade');
    expect(html).toContain('1215 — AR related');
    expect(html).toContain('Manual journal JE-001');
    expect(html).toContain('Opposing historical reclass');
    expect(html).toContain('Settlements');
    expect(html).toContain('Default control');
  });
  it('requires review of named issues even when one account itself nets to zero', () => {
    const data = fixture();
    data.accounts = [data.accounts[0]];
    data.accounts[0].difference = 0;
    expect(controlReviewSummary(data)).toContain(
      'Review required: 1 control account.',
    );
  });
  it('does not show a clean result for an empty account scope', () => {
    const data = fixture();
    data.accounts = [];
    expect(controlReviewSummary(data)).toContain('No control accounts found');
  });
  it('shows matched balances only without differences or named issues', () => {
    const data = fixture();
    for (const row of data.accounts) {
      row.difference = 0;
      row.items = [];
    }
    expect(controlReviewSummary(data)).toBe(
      'No differences identified in the selected control accounts.',
    );
    data.kind = 'ap';
    expect(
      renderToStaticMarkup(<ControlReconciliationReport data={data} />),
    ).toContain('credit minus debit');
  });
  it('exports every account/component/item and warning in a rectangular PDF-compatible CSV', () => {
    const csv = controlReconciliationCsv(fixture()),
      table = buildPdfTableFromCsv(csv)!;
    expect(table.head[0]).toHaveLength(8);
    expect(table.body.every((row) => row.length === 8)).toBe(true);
    expect(csv).toContain(
      'AR,SUMMARY,Company totals,2026-09-30,1170,1170,0,Review required: 2',
    );
    expect(csv).toContain(
      '1200 AR trade,ACCOUNT,Default control,2026-09-30,645,570,75,Review required',
    );
    expect(csv).toContain(
      '1215 AR related,ACCOUNT,Other control,2026-09-30,525,600,-75,Review required',
    );
    expect(csv).toContain('Settlements,2026-09-30,,-540');
    expect(csv).toContain('Notes,2026-09-30,,-100');
    expect(csv).toContain('JE-001 | MANUAL | Manual journal');
  });
  it('escapes quoted/newline text and neutralizes spreadsheet formulas without changing numeric signs', () => {
    const data = fixture();
    data.accounts[0].items[0].reference = '=HYPERLINK("url")';
    data.accounts[0].items[0].message = 'Comma, quote " and\nnew line';
    const csv = controlReconciliationCsv(data),
      table = buildPdfTableFromCsv(csv)!;
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('quote ""');
    expect(csv).toContain(',,-75,');
    expect(
      table.body.some((row) => row[7].includes('Comma, quote " and\nnew line')),
    ).toBe(true);
  });
});

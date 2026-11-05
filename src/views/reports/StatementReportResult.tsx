import React from 'react';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { type ReportResultProps } from './reportResultHelpers';
import type { StatementData } from './reportTypes';

export default function StatementReportResult({ activeReport }: ReportResultProps): React.ReactNode {
  const { report, data } = activeReport;
  if (report.id === 'statement' || report.id === 'ap-statement') {
    const stmt = data as StatementData;
    const ag = stmt.summary.aging;
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
          <div className="text-sm font-semibold text-neutral-900">
            {stmt.party.code ? `${stmt.party.code} · ` : ''}{stmt.party.name}
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            {formatDateID(stmt.period.dateFrom)} s/d {formatDateID(stmt.period.dateTo)}
          </div>
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-blue-50">
              <th className="p-3 text-left font-semibold border border-neutral-300 w-[110px]">Tanggal</th>
              <th className="p-3 text-left font-semibold border border-neutral-300 w-[130px]">Tipe</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">No.</th>
              <th className="p-3 text-right font-semibold border border-neutral-300 w-[140px]">Debit</th>
              <th className="p-3 text-right font-semibold border border-neutral-300 w-[140px]">Kredit</th>
              <th className="p-3 text-right font-semibold border border-neutral-300 w-[160px]">Saldo</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-neutral-50">
              <td className="p-3 border border-neutral-200 text-neutral-500 italic" colSpan={5}>Saldo Awal</td>
              <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(stmt.openingBalance)}</td>
            </tr>
            {stmt.rows.map((row, i) => (
              <tr key={i} className="hover:bg-neutral-50">
                <td className="p-3 border border-neutral-200">{formatDateID(row.date)}</td>
                <td className="p-3 border border-neutral-200">{row.type}</td>
                <td className="p-3 border border-neutral-200 font-mono text-xs">{row.number}</td>
                <td className="p-3 border border-neutral-200 text-right">{row.debit ? formatIDR(row.debit) : '—'}</td>
                <td className="p-3 border border-neutral-200 text-right">{row.credit ? formatIDR(row.credit) : '—'}</td>
                <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.runningBalance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-neutral-50 font-semibold">
              <td className="p-3 border border-neutral-300 text-right" colSpan={3}>Total</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(stmt.summary.totalDebits)}</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(stmt.summary.totalCredits)}</td>
              <td className="p-3 border border-neutral-300 text-right text-primary-700">{formatIDR(stmt.summary.closingBalance)}</td>
            </tr>
          </tfoot>
        </table>

        <div>
          <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Aging Saldo Akhir</div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-blue-50">
                <th className="p-2 text-right font-semibold border border-neutral-300">Current</th>
                <th className="p-2 text-right font-semibold border border-neutral-300">1-30</th>
                <th className="p-2 text-right font-semibold border border-neutral-300">31-60</th>
                <th className="p-2 text-right font-semibold border border-neutral-300">61-90</th>
                <th className="p-2 text-right font-semibold border border-neutral-300">90+</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-2 border border-neutral-200 text-right">{formatIDR(ag.current)}</td>
                <td className="p-2 border border-neutral-200 text-right">{formatIDR(ag.d1To30)}</td>
                <td className="p-2 border border-neutral-200 text-right">{formatIDR(ag.d31To60)}</td>
                <td className="p-2 border border-neutral-200 text-right">{formatIDR(ag.d61To90)}</td>
                <td className="p-2 border border-neutral-200 text-right">{formatIDR(ag.d90Plus)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  return null;
}

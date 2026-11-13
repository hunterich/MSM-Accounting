import React from 'react';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { getStatusPillClass, renderEmptyReport, type ReportResultProps } from './reportResultHelpers';
import type {
  APAgingRow,
  APAgingSummary,
  APOverdueRow,
  APOverdueSummary,
  APVendorBalanceRow,
  APVendorBalanceSummary,
} from './reportTypes';

export default function ApReportResult({ activeReport }: ReportResultProps): React.ReactNode {
  const { report, data } = activeReport;
  if (report.id === 'ap-aging') {
    const apData = data as { rows: APAgingRow[]; summary: APAgingSummary };
    const apRows = apData.rows || [];
    const apSummary = apData.summary || {} as APAgingSummary;
    if (!apRows.length) return renderEmptyReport('No open bills found for the selected date.');
    return (
      <div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-blue-50">
              <th className="p-3 text-left font-semibold border border-neutral-300">Bill No.</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Vendor</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Bill Date</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Due Date</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Days</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Current</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">1–30</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">31–60</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">61–90</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">90+</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Balance</th>
            </tr>
          </thead>
          <tbody>
            {apRows.map((row) => (
              <tr key={row.id} className="hover:bg-neutral-50">
                <td className="p-3 border border-neutral-200 font-mono text-xs">{row.id}</td>
                <td className="p-3 border border-neutral-200">{row.vendorName}</td>
                <td className="p-3 border border-neutral-200">{formatDateID(row.billDate)}</td>
                <td className="p-3 border border-neutral-200">{formatDateID(row.dueDate)}</td>
                <td className="p-3 border border-neutral-200 text-right">
                  {row.daysOverdue > 0 ? <span className="text-danger-600 font-medium">{row.daysOverdue}</span> : 'Current'}
                </td>
                <td className="p-3 border border-neutral-200 text-right">{row.current ? formatIDR(row.current) : '—'}</td>
                <td className="p-3 border border-neutral-200 text-right">{row.d1_30 ? formatIDR(row.d1_30) : '—'}</td>
                <td className="p-3 border border-neutral-200 text-right">{row.d31_60 ? formatIDR(row.d31_60) : '—'}</td>
                <td className="p-3 border border-neutral-200 text-right">{row.d61_90 ? formatIDR(row.d61_90) : '—'}</td>
                <td className="p-3 border border-neutral-200 text-right">{row.d90plus ? formatIDR(row.d90plus) : '—'}</td>
                <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 pt-4 border-t border-neutral-200 flex flex-wrap gap-4 text-sm font-semibold text-neutral-700">
          <span>Current: {formatIDR(apSummary.current || 0)}</span>
          <span>1-30: {formatIDR(apSummary.d1_30 || 0)}</span>
          <span>31-60: {formatIDR(apSummary.d31_60 || 0)}</span>
          <span>61-90: {formatIDR(apSummary.d61_90 || 0)}</span>
          <span>90+: {formatIDR(apSummary.d90plus || 0)}</span>
          <span className="ml-auto text-primary-700">Total Outstanding: {formatIDR(apSummary.balance || 0)}</span>
        </div>
      </div>
    );
  }

  if (report.id === 'ap-vendor-balance') {
    const vbData = data as { rows: APVendorBalanceRow[]; summary: APVendorBalanceSummary };
    const vbRows = vbData.rows || [];
    const vbSummary = vbData.summary || {} as APVendorBalanceSummary;
    if (!vbRows.length) return renderEmptyReport('Tidak ada saldo utang vendor pada tanggal yang dipilih.');

    return (
      <div>
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-center">
            <div className="text-xs text-neutral-500">Jumlah Vendor</div>
            <div className="text-lg font-bold text-neutral-900">{vbSummary.vendorCount || 0}</div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-center">
            <div className="text-xs text-neutral-500">Total Ditagih</div>
            <div className="text-lg font-bold text-neutral-900">{formatIDR(vbSummary.totalBilled || 0)}</div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-center">
            <div className="text-xs text-neutral-500">Total Dibayar</div>
            <div className="text-lg font-bold text-success-700">{formatIDR(vbSummary.totalPaid || 0)}</div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-center">
            <div className="text-xs text-neutral-500">Total Saldo Utang</div>
            <div className="text-lg font-bold text-danger-600">{formatIDR(vbSummary.totalOutstanding || 0)}</div>
          </div>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-blue-50">
              <th className="p-3 text-left font-semibold border border-neutral-300 w-[140px]">Kode Vendor</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Vendor</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Total Ditagih</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Total Dibayar</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Saldo Utang</th>
            </tr>
          </thead>
          <tbody>
            {vbRows.map((row, i) => (
              <tr key={i} className="hover:bg-neutral-50">
                <td className="p-3 border border-neutral-200 font-mono text-xs">{row.vendorCode}</td>
                <td className="p-3 border border-neutral-200">{row.vendorName}</td>
                <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.billedAmount)}</td>
                <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.paidAmount)}</td>
                <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.outstandingAmount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-blue-50 font-bold">
              <td colSpan={2} className="p-3 border border-neutral-300">Total ({vbSummary.vendorCount || 0} vendor)</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(vbSummary.totalBilled || 0)}</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(vbSummary.totalPaid || 0)}</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(vbSummary.totalOutstanding || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  if (report.id === 'ap-overdue-list') {
    const aoData = data as { rows: APOverdueRow[]; summary: APOverdueSummary };
    const aoRows = aoData.rows || [];
    const aoSummary = aoData.summary || {} as APOverdueSummary;
    if (!aoRows.length) return renderEmptyReport('Tidak ada tagihan utang jatuh tempo pada tanggal yang dipilih.');

    const overdueColor = (days: number) =>
      days > 90 ? 'text-danger-600 font-bold' :
        days > 60 ? 'text-orange-600 font-semibold' :
          days > 30 ? 'text-warning-600 font-medium' :
            'text-neutral-700';

    return (
      <div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-blue-50">
              <th className="p-3 text-left font-semibold border border-neutral-300">No Tagihan</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Jatuh Tempo</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Vendor</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Hari Lewat</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Status</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {aoRows.map((row) => (
              <tr key={row.billId} className="hover:bg-neutral-50">
                <td className="p-3 border border-neutral-200 font-mono text-xs">{row.billNumber}</td>
                <td className="p-3 border border-neutral-200">{formatDateID(row.dueDate)}</td>
                <td className="p-3 border border-neutral-200">{row.vendorName}</td>
                <td className={`p-3 border border-neutral-200 text-right ${overdueColor(row.daysOverdue)}`}>{row.daysOverdue}</td>
                <td className="p-3 border border-neutral-200">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusPillClass(row.status)}`}>
                    {row.status}
                  </span>
                </td>
                <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-blue-50 font-bold">
              <td colSpan={5} className="p-3 border border-neutral-300">Total Tagihan Overdue ({aoSummary.overdueBillCount || 0})</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(aoSummary.overdueAmount || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }
  return null;
}

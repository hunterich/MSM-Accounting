import React from 'react';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { getStatusPillClass, renderEmptyReport, type ReportResultProps } from './reportResultHelpers';
import type {
  AgingRow,
  AgingSummary,
  CustomerBalanceRow,
  CustomerBalanceSummary,
  OverdueRow,
  OverdueSummary,
} from './reportTypes';

export default function ArReportResult({ activeReport }: ReportResultProps): React.ReactNode {
  const { report, data } = activeReport;
  if (report.id === 'aging') {
    const agingData = data as { rows: AgingRow[]; summary: AgingSummary };
    if (!agingData.rows.length) return renderEmptyReport('Tidak ada piutang terbuka pada tanggal yang dipilih.');

    return (
      <div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-blue-50">
              <th className="p-3 text-left font-semibold border border-neutral-300">No Faktur</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Tanggal</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Jatuh Tempo</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Pelanggan</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Hari</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Faktur</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Terlunasi</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Saldo</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Current</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">1-30</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">31-60</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">61-90</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">90+</th>
            </tr>
          </thead>
          <tbody>
            {agingData.rows.map((row) => (
              <tr key={row.invoiceId} className="hover:bg-neutral-50">
                <td className="p-3 border border-neutral-200 font-mono text-xs">{row.invoiceNumber}</td>
                <td className="p-3 border border-neutral-200">{formatDateID(row.invoiceDate)}</td>
                <td className="p-3 border border-neutral-200">{row.dueDate ? formatDateID(row.dueDate) : '—'}</td>
                <td className="p-3 border border-neutral-200">{row.customerName}</td>
                <td className="p-3 border border-neutral-200 text-right">
                  {row.daysOverdue > 0 ? <span className="text-danger-600 font-medium">{row.daysOverdue}</span> : 'Current'}
                </td>
                <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.originalAmount)}</td>
                <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.clearedAmount)}</td>
                <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.balance)}</td>
                <td className="p-3 border border-neutral-200 text-right">{row.current ? formatIDR(row.current) : '—'}</td>
                <td className="p-3 border border-neutral-200 text-right">{row.d1To30 ? formatIDR(row.d1To30) : '—'}</td>
                <td className="p-3 border border-neutral-200 text-right">{row.d31To60 ? formatIDR(row.d31To60) : '—'}</td>
                <td className="p-3 border border-neutral-200 text-right">{row.d61To90 ? formatIDR(row.d61To90) : '—'}</td>
                <td className="p-3 border border-neutral-200 text-right">{row.d90Plus ? formatIDR(row.d90Plus) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 pt-4 border-t border-neutral-200 flex flex-wrap gap-4 text-sm font-semibold text-neutral-700">
          <span>Current: {formatIDR(agingData.summary.current || 0)}</span>
          <span>1-30: {formatIDR(agingData.summary.d1To30 || 0)}</span>
          <span>31-60: {formatIDR(agingData.summary.d31To60 || 0)}</span>
          <span>61-90: {formatIDR(agingData.summary.d61To90 || 0)}</span>
          <span>90+: {formatIDR(agingData.summary.d90Plus || 0)}</span>
          <span className="ml-auto text-primary-700">Total Outstanding: {formatIDR(agingData.summary.totalOutstanding || 0)}</span>
        </div>
      </div>
    );
  }

  if (report.id === 'customer-balance') {
    const cbData = data as { rows: CustomerBalanceRow[]; summary: CustomerBalanceSummary };
    if (!cbData.rows.length) return renderEmptyReport('Tidak ada saldo piutang pelanggan pada tanggal yang dipilih.');

    return (
      <div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-blue-50">
              <th className="p-3 text-left font-semibold border border-neutral-300 w-[140px]">Kode</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Pelanggan</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Total Ditagih</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Total Dibayar</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Saldo Piutang</th>
            </tr>
          </thead>
          <tbody>
            {cbData.rows.map((row) => (
              <tr key={row.customerId} className="hover:bg-neutral-50">
                <td className="p-3 border border-neutral-200">{row.customerCode || '—'}</td>
                <td className="p-3 border border-neutral-200">{row.customerName}</td>
                <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.invoicedAmount)}</td>
                <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.paidAmount)}</td>
                <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.outstandingAmount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-blue-50 font-bold">
              <td colSpan={2} className="p-3 border border-neutral-300">Total ({cbData.summary.customerCount || 0} pelanggan)</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(cbData.summary.totalInvoiced || 0)}</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(cbData.summary.totalPaid || 0)}</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(cbData.summary.totalOutstanding || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  if (report.id === 'overdue-list') {
    const ovData = data as { rows: OverdueRow[]; summary: OverdueSummary };
    if (!ovData.rows.length) return renderEmptyReport('Tidak ada tagihan jatuh tempo pada tanggal yang dipilih.');

    return (
      <div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-blue-50">
              <th className="p-3 text-left font-semibold border border-neutral-300">No Faktur</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Jatuh Tempo</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Pelanggan</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Hari</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Status</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {ovData.rows.map((row) => (
              <tr key={row.invoiceId} className="hover:bg-neutral-50">
                <td className="p-3 border border-neutral-200 font-mono text-xs">{row.invoiceNumber}</td>
                <td className="p-3 border border-neutral-200">{row.dueDate ? formatDateID(row.dueDate) : '—'}</td>
                <td className="p-3 border border-neutral-200">{row.customerName}</td>
                <td className="p-3 border border-neutral-200 text-right text-danger-600 font-medium">{row.daysOverdue}</td>
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
              <td colSpan={5} className="p-3 border border-neutral-300">Total Invoice Overdue ({ovData.summary.overdueInvoiceCount || 0})</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(ovData.summary.overdueAmount || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }
  return null;
}

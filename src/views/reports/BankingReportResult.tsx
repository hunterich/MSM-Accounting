import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { renderEmptyReport, type ReportResultProps } from './reportResultHelpers';
import type {
  BankHistoryData,
  BankPaymentData,
  BankReceivedData,
  BankReconciliationRow,
  BankReconciliationSummary,
  CashFlowRow,
  CashFlowSummary,
} from './reportTypes';

export default function BankingReportResult({ activeReport }: ReportResultProps): React.ReactNode {
  const navigate = useNavigate();
  const journalLink = (row: { journalEntryNo: string | null; txnNumber: string | null; bankTransactionId: string }) => (
    <button
      type="button"
      onClick={() => navigate(`/banking?txnId=${row.bankTransactionId}`)}
      className="text-primary-600 underline hover:text-primary-800"
    >
      {row.journalEntryNo ?? row.txnNumber ?? '—'}
    </button>
  );
  const { report, data } = activeReport;
  if (report.id === 'cash-flow') {
    const cfData = data as { rows: CashFlowRow[]; summary: CashFlowSummary };
    const cfRows = cfData.rows || [];
    const cfSummary = cfData.summary || {} as CashFlowSummary;
    if (!cfRows.length) return renderEmptyReport('No cash flow data found for the selected period.');
    return (
      <div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-blue-50">
              <th className="p-3 text-left font-semibold border border-neutral-300">Bank Account</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Date</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Inflow</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Outflow</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Net</th>
            </tr>
          </thead>
          <tbody>
            {cfRows.map((row, i) => (
              <tr key={i} className="hover:bg-neutral-50">
                <td className="p-3 border border-neutral-200">{row.bankAccountName}</td>
                <td className="p-3 border border-neutral-200">{formatDateID(row.date)}</td>
                <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.inflow)}</td>
                <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.outflow)}</td>
                <td className={`p-3 border border-neutral-200 text-right font-medium ${row.net >= 0 ? 'text-success-700' : 'text-danger-600'}`}>
                  {formatIDR(row.net)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-blue-50 font-bold">
              <td colSpan={2} className="p-3 border border-neutral-300">Total</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(cfSummary.totalInflow || 0)}</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(cfSummary.totalOutflow || 0)}</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(cfSummary.totalNet || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  if (report.id === 'bank-history') {
    const hist = data as BankHistoryData;
    const banks = hist.banks || [];
    if (!banks.length) return renderEmptyReport('Tidak ada transaksi bank pada periode yang dipilih.');
    return (
      <div className="space-y-6">
        {banks.map((bank) => (
          <div key={bank.bankAccountId}>
            <div className="text-sm font-semibold text-neutral-800 mb-2">
              {bank.bankAccountName}{bank.bankName ? ` — ${bank.bankName}` : ''}
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-blue-50">
                  <th className="p-2 text-left font-semibold border border-neutral-300">Tanggal</th>
                  <th className="p-2 text-left font-semibold border border-neutral-300">No. Jurnal</th>
                  <th className="p-2 text-left font-semibold border border-neutral-300">Keterangan</th>
                  <th className="p-2 text-right font-semibold border border-neutral-300">Masuk</th>
                  <th className="p-2 text-right font-semibold border border-neutral-300">Keluar</th>
                  <th className="p-2 text-right font-semibold border border-neutral-300">Saldo</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-neutral-50">
                  <td colSpan={5} className="p-2 border border-neutral-200 text-neutral-500">Saldo Awal</td>
                  <td className="p-2 border border-neutral-200 text-right text-neutral-600">{formatIDR(bank.openingBalance)}</td>
                </tr>
                {bank.rows.map((row) => (
                  <tr key={row.bankTransactionId} className="hover:bg-neutral-50">
                    <td className="p-2 border border-neutral-200">{formatDateID(row.date)}</td>
                    <td className="p-2 border border-neutral-200">{journalLink(row)}</td>
                    <td className="p-2 border border-neutral-200">
                      {row.description}{row.counterparty ? <span className="text-neutral-500"> — {row.counterparty}</span> : null}
                    </td>
                    <td className="p-2 border border-neutral-200 text-right text-success-700">{row.moneyIn ? formatIDR(row.moneyIn) : ''}</td>
                    <td className="p-2 border border-neutral-200 text-right text-danger-600">{row.moneyOut ? formatIDR(row.moneyOut) : ''}</td>
                    <td className="p-2 border border-neutral-200 text-right">{formatIDR(row.runningBalance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-blue-50 font-bold">
                  <td colSpan={3} className="p-2 border border-neutral-300">Saldo Akhir &amp; Total</td>
                  <td className="p-2 border border-neutral-300 text-right text-success-700">{formatIDR(bank.totalIn)}</td>
                  <td className="p-2 border border-neutral-300 text-right text-danger-600">{formatIDR(bank.totalOut)}</td>
                  <td className="p-2 border border-neutral-300 text-right">{formatIDR(bank.closingBalance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}
      </div>
    );
  }

  if (report.id === 'bank-received' || report.id === 'bank-payment') {
    const isReceived = report.id === 'bank-received';
    const detail = data as BankReceivedData | BankPaymentData;
    const rows = detail.rows || [];
    if (!rows.length) return renderEmptyReport('Tidak ada transaksi pada periode yang dipilih.');
    const total = isReceived
      ? (detail as BankReceivedData).summary.totalReceived
      : (detail as BankPaymentData).summary.totalPaid;
    return (
      <div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-blue-50">
              <th className="p-2 text-left font-semibold border border-neutral-300">Tanggal</th>
              <th className="p-2 text-left font-semibold border border-neutral-300">No. Jurnal</th>
              <th className="p-2 text-left font-semibold border border-neutral-300">{isReceived ? 'Dari' : 'Kepada'}</th>
              <th className="p-2 text-left font-semibold border border-neutral-300">Keterangan</th>
              <th className="p-2 text-right font-semibold border border-neutral-300">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.bankTransactionId} className="hover:bg-neutral-50">
                <td className="p-2 border border-neutral-200">{formatDateID(row.date)}</td>
                <td className="p-2 border border-neutral-200">{journalLink(row)}</td>
                <td className="p-2 border border-neutral-200">{isReceived ? row.from : row.payee}</td>
                <td className="p-2 border border-neutral-200">{row.description}</td>
                <td className="p-2 border border-neutral-200 text-right">{formatIDR(row.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-blue-50 font-bold">
              <td colSpan={4} className="p-2 border border-neutral-300">Total ({rows.length} transaksi)</td>
              <td className="p-2 border border-neutral-300 text-right">{formatIDR(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  if (report.id === 'bank-reconciliation') {
    const reconData = data as { rows: BankReconciliationRow[]; summary: BankReconciliationSummary };
    const reconRows = reconData.rows || [];
    const reconSummary = reconData.summary || {} as BankReconciliationSummary;
    if (!reconRows.length) return renderEmptyReport('No bank accounts with statements found. Import a bank statement in Banking to get started.');
    return (
      <div>
        <div className="flex gap-4 mb-4 text-sm">
          <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2">
            <span className="text-neutral-500">Accounts: </span>
            <span className="font-semibold">{reconSummary.totalAccounts ?? reconRows.length}</span>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2">
            <span className="text-neutral-500">Unmatched Lines: </span>
            <span className="font-semibold text-amber-700">{reconSummary.totalUnmatched ?? 0}</span>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2">
            <span className="text-neutral-500">Unmatched Amount: </span>
            <span className="font-semibold text-amber-700">{formatIDR(reconSummary.totalUnmatchedAmount ?? 0)}</span>
          </div>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-blue-50">
              <th className="p-3 text-left font-semibold border border-neutral-300">Account</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Bank</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Book Balance</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Statement Balance</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Variance</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Matched</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Unmatched</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Last Statement</th>
            </tr>
          </thead>
          <tbody>
            {reconRows.map((row) => {
              const hasVariance = row.variance != null && Math.abs(row.variance) > 0.01;
              return (
                <tr key={row.accountId} className="hover:bg-neutral-50">
                  <td className="p-3 border border-neutral-200">
                    <div className="font-medium">{row.accountName}</div>
                    {row.accountCode && <div className="text-xs text-neutral-400">{row.accountCode}</div>}
                  </td>
                  <td className="p-3 border border-neutral-200 text-neutral-500">{row.bankName ?? '—'}</td>
                  <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.bookBalance)}</td>
                  <td className="p-3 border border-neutral-200 text-right">
                    {row.statementEndBalance != null ? formatIDR(row.statementEndBalance) : <span className="text-neutral-400 text-xs">No statement</span>}
                  </td>
                  <td className={`p-3 border border-neutral-200 text-right font-medium ${hasVariance ? 'text-danger-600' : 'text-success-700'}`}>
                    {row.variance != null ? formatIDR(row.variance) : '—'}
                  </td>
                  <td className="p-3 border border-neutral-200 text-right text-success-700">{row.matchedCount}</td>
                  <td className={`p-3 border border-neutral-200 text-right ${row.unmatchedCount > 0 ? 'text-amber-600 font-semibold' : ''}`}>
                    {row.unmatchedCount > 0 ? `${row.unmatchedCount} (${formatIDR(row.unmatchedAmount)})` : row.unmatchedCount}
                  </td>
                  <td className="p-3 border border-neutral-200 text-sm text-neutral-500">
                    {row.lastStatementDate ? formatDateID(row.lastStatementDate) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  return null;
}

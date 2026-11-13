import React from 'react';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { renderEmptyReport, type ReportResultProps } from './reportResultHelpers';
import type {
  AccountLedgerRow,
  BalanceSheetMultiSection,
  BalanceSheetMultiSummary,
  BalanceSheetSection,
  BalanceSheetSummary,
  CashFlowStatementSection,
  CashFlowStatementSummary,
  PLComparativeSection,
  PLComparativeSummary,
  PLSection,
  PLSummary,
  TrialBalanceRow,
  TrialBalanceSummary,
} from './reportTypes';

export default function GlReportResult({ activeReport }: ReportResultProps): React.ReactNode {
  const { report, data } = activeReport;
  if (report.id === 'trial-balance') {
    const tbData = data as { rows: TrialBalanceRow[]; summary: TrialBalanceSummary };
    if (!tbData.rows.length) return renderEmptyReport('No general ledger balances found for the selected date.');

    return (
      <div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-blue-50">
              <th className="p-3 text-left font-semibold border border-neutral-300 w-[140px]">Code</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Account Name</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Total Debit</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Total Credit</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Ending Debit</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Ending Credit</th>
            </tr>
          </thead>
          <tbody>
            {tbData.rows.map((row) => (
              <tr key={row.accountId} className="hover:bg-neutral-50">
                <td className="p-3 border border-neutral-200 font-mono text-xs">{row.accountCode}</td>
                <td className="p-3 border border-neutral-200">{row.accountName}</td>
                <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.totalDebit)}</td>
                <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.totalCredit)}</td>
                <td className="p-3 border border-neutral-200 text-right font-medium">{row.endingDebit ? formatIDR(row.endingDebit) : '—'}</td>
                <td className="p-3 border border-neutral-200 text-right font-medium">{row.endingCredit ? formatIDR(row.endingCredit) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-blue-50 font-bold">
              <td colSpan={2} className="p-3 border border-neutral-300">Total</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(tbData.summary.totalDebit || 0)}</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(tbData.summary.totalCredit || 0)}</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(tbData.summary.endingDebit || 0)}</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(tbData.summary.endingCredit || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  if (report.id === 'profit-loss') {
    const plData = data as { sections: PLSection[]; summary: PLSummary };
    const sections = plData.sections || [];
    const hasRows = sections.some((section) => section.rows.length > 0);
    if (!hasRows) return renderEmptyReport('No revenue or expense activity found for the selected period.');

    return (
      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.id}>
            <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{section.label}</div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-blue-50">
                  <th className="p-3 text-left font-semibold border border-neutral-300 w-[140px]">Code</th>
                  <th className="p-3 text-left font-semibold border border-neutral-300">Account Name</th>
                  <th className="p-3 text-right font-semibold border border-neutral-300 w-[220px]">Amount</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row.accountId} className="hover:bg-neutral-50">
                    <td className="p-3 border border-neutral-200 font-mono text-xs">{row.accountCode}</td>
                    <td className="p-3 border border-neutral-200">{row.accountName}</td>
                    <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-blue-50 font-bold">
                  <td colSpan={2} className="p-3 border border-neutral-300">Subtotal {section.label}</td>
                  <td className="p-3 border border-neutral-300 text-right">{formatIDR(section.total || 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}

        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-600">Total Revenue</span>
            <span className="font-semibold">{formatIDR(plData.summary.totalRevenue || 0)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-neutral-600">Total Expenses</span>
            <span className="font-semibold">{formatIDR(plData.summary.totalExpense || 0)}</span>
          </div>
          <div className="mt-3 border-t border-neutral-200 pt-3 flex items-center justify-between">
            <span className="font-semibold text-neutral-900">Net Income</span>
            <span className="font-bold text-primary-700">{formatIDR(plData.summary.netIncome || 0)}</span>
          </div>
        </div>
      </div>
    );
  }

  if (report.id === 'balance-sheet') {
    const bsData = data as { sections: BalanceSheetSection[]; summary: BalanceSheetSummary };
    const sections = bsData.sections || [];
    const hasRows = sections.some((section) => section.rows.length > 0);
    if (!hasRows) return renderEmptyReport('No balance sheet balances found for the selected date.');

    return (
      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.id}>
            <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{section.label}</div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-blue-50">
                  <th className="p-3 text-left font-semibold border border-neutral-300 w-[140px]">Code</th>
                  <th className="p-3 text-left font-semibold border border-neutral-300">Account Name</th>
                  <th className="p-3 text-right font-semibold border border-neutral-300 w-[220px]">Balance</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row.accountId} className="hover:bg-neutral-50">
                    <td className="p-3 border border-neutral-200 font-mono text-xs">{row.accountCode || '—'}</td>
                    <td className="p-3 border border-neutral-200">{row.accountName}</td>
                    <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-blue-50 font-bold">
                  <td colSpan={2} className="p-3 border border-neutral-300">Subtotal {section.label}</td>
                  <td className="p-3 border border-neutral-300 text-right">{formatIDR(section.total || 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}

        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-600">Total Assets</span>
            <span className="font-semibold">{formatIDR(bsData.summary.totalAssets || 0)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-neutral-600">Total Liabilities</span>
            <span className="font-semibold">{formatIDR(bsData.summary.totalLiabilities || 0)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-neutral-600">Total Equity</span>
            <span className="font-semibold">{formatIDR(bsData.summary.totalEquity || 0)}</span>
          </div>
          <div className="mt-3 border-t border-neutral-200 pt-3 flex items-center justify-between">
            <span className="font-semibold text-neutral-900">Total Liabilities + Equity</span>
            <span className="font-bold text-primary-700">{formatIDR(bsData.summary.totalLiabilitiesAndEquity || 0)}</span>
          </div>
        </div>
      </div>
    );
  }

  if (report.id === 'balance-sheet-multi-period') {
    const bsmData = data as { sections: BalanceSheetMultiSection[]; summary: BalanceSheetMultiSummary };
    const sections = bsmData.sections || [];
    const hasRows = sections.some((section) => section.rows.length > 0);
    if (!hasRows) return renderEmptyReport('No balance sheet balances found for the selected comparison dates.');

    return (
      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.id}>
            <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{section.label}</div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-blue-50">
                  <th className="p-3 text-left font-semibold border border-neutral-300 w-[140px]">Code</th>
                  <th className="p-3 text-left font-semibold border border-neutral-300">Account Name</th>
                  <th className="p-3 text-right font-semibold border border-neutral-300">Current Period</th>
                  <th className="p-3 text-right font-semibold border border-neutral-300">Compare Period</th>
                  <th className="p-3 text-right font-semibold border border-neutral-300">Variance</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row.accountId} className="hover:bg-neutral-50">
                    <td className="p-3 border border-neutral-200 font-mono text-xs">{row.accountCode || '—'}</td>
                    <td className="p-3 border border-neutral-200">{row.accountName}</td>
                    <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.currentAmount)}</td>
                    <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.compareAmount)}</td>
                    <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.variance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-blue-50 font-bold">
                  <td colSpan={2} className="p-3 border border-neutral-300">Subtotal {section.label}</td>
                  <td className="p-3 border border-neutral-300 text-right">{formatIDR(section.totalCurrent || 0)}</td>
                  <td className="p-3 border border-neutral-300 text-right">{formatIDR(section.totalCompare || 0)}</td>
                  <td className="p-3 border border-neutral-300 text-right">{formatIDR(section.totalVariance || 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}

        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-600">Total Assets</span>
            <span className="font-semibold">{formatIDR(bsmData.summary.current.totalAssets || 0)} vs {formatIDR(bsmData.summary.compare.totalAssets || 0)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-600">Total Liabilities</span>
            <span className="font-semibold">{formatIDR(bsmData.summary.current.totalLiabilities || 0)} vs {formatIDR(bsmData.summary.compare.totalLiabilities || 0)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-600">Total Equity</span>
            <span className="font-semibold">{formatIDR(bsmData.summary.current.totalEquity || 0)} vs {formatIDR(bsmData.summary.compare.totalEquity || 0)}</span>
          </div>
          <div className="border-t border-neutral-200 pt-3 flex items-center justify-between">
            <span className="font-semibold text-neutral-900">Assets Variance</span>
            <span className="font-bold text-primary-700">{formatIDR(bsmData.summary.variance.totalAssets || 0)}</span>
          </div>
        </div>
      </div>
    );
  }

  if (report.id === 'profit-loss-multi-period') {
    const plcData = data as { sections: PLComparativeSection[]; summary: PLComparativeSummary };
    const sections = plcData.sections || [];
    const hasRows = sections.some((s) => s.rows.length > 0);
    if (!hasRows) return renderEmptyReport('Tidak ada data laba rugi untuk periode yang dipilih.');

    const varianceColor = (v: number) => v > 0 ? 'text-success-700' : v < 0 ? 'text-danger-600' : '';

    return (
      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.id}>
            <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{section.label}</div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-blue-50">
                  <th className="p-3 text-left font-semibold border border-neutral-300 w-[100px]">Code</th>
                  <th className="p-3 text-left font-semibold border border-neutral-300">Account</th>
                  <th className="p-3 text-right font-semibold border border-neutral-300">Periode Ini</th>
                  <th className="p-3 text-right font-semibold border border-neutral-300">Periode Pembanding</th>
                  <th className="p-3 text-right font-semibold border border-neutral-300">Variance (Rp)</th>
                  <th className="p-3 text-right font-semibold border border-neutral-300 w-[100px]">Variance (%)</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row, i) => (
                  <tr key={i} className="hover:bg-neutral-50">
                    <td className="p-3 border border-neutral-200 font-mono text-xs">{row.code}</td>
                    <td className="p-3 border border-neutral-200">{row.name}</td>
                    <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.currentAmount)}</td>
                    <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.compareAmount)}</td>
                    <td className={`p-3 border border-neutral-200 text-right font-medium ${varianceColor(row.variance)}`}>{formatIDR(row.variance)}</td>
                    <td className={`p-3 border border-neutral-200 text-right ${varianceColor(row.variancePct)}`}>{row.variancePct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-blue-50 font-bold">
                  <td colSpan={2} className="p-3 border border-neutral-300">Subtotal {section.label}</td>
                  <td className="p-3 border border-neutral-300 text-right">{formatIDR(section.subtotal.current || 0)}</td>
                  <td className="p-3 border border-neutral-300 text-right">{formatIDR(section.subtotal.compare || 0)}</td>
                  <td className={`p-3 border border-neutral-300 text-right ${varianceColor(section.subtotal.variance)}`}>{formatIDR(section.subtotal.variance || 0)}</td>
                  <td className={`p-3 border border-neutral-300 text-right ${varianceColor(section.subtotal.variancePct)}`}>{(section.subtotal.variancePct || 0).toFixed(1)}%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}

        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-600">Total Pendapatan</span>
            <span className="font-semibold">{formatIDR(plcData.summary.currentRevenue || 0)} vs {formatIDR(plcData.summary.compareRevenue || 0)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-600">Total Biaya</span>
            <span className="font-semibold">{formatIDR(plcData.summary.currentExpenses || 0)} vs {formatIDR(plcData.summary.compareExpenses || 0)}</span>
          </div>
          <div className="border-t border-neutral-200 pt-3 flex items-center justify-between">
            <span className="font-semibold text-neutral-900">Laba Bersih</span>
            <span className={`font-bold ${varianceColor(plcData.summary.netIncomeVariance)}`}>
              {formatIDR(plcData.summary.currentNetIncome || 0)} vs {formatIDR(plcData.summary.compareNetIncome || 0)}
              {' '}({(plcData.summary.netIncomeVariancePct || 0).toFixed(1)}%)
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (report.id === 'account-ledger') {
    const alData = data as {
      accountCode: string; accountName: string; accountType: string;
      openingBalance: number; rows: AccountLedgerRow[]; closingBalance: number;
    };
    const alRows = alData.rows || [];

    return (
      <div>
        <div className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
          <div className="text-sm font-semibold text-neutral-900">{alData.accountCode} - {alData.accountName}</div>
          <div className="text-xs text-neutral-500 mt-0.5">Tipe: {alData.accountType}</div>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-blue-50">
              <th className="p-3 text-left font-semibold border border-neutral-300 w-[120px]">Tanggal</th>
              <th className="p-3 text-left font-semibold border border-neutral-300 w-[140px]">No. Jurnal</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Keterangan</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Debit</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Kredit</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Saldo</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-neutral-50 font-medium">
              <td colSpan={5} className="p-3 border border-neutral-200 text-neutral-600">Saldo Awal</td>
              <td className="p-3 border border-neutral-200 text-right font-semibold">{formatIDR(alData.openingBalance || 0)}</td>
            </tr>
            {alRows.map((row, i) => (
              <tr key={i} className="hover:bg-neutral-50">
                <td className="p-3 border border-neutral-200">{formatDateID(row.date)}</td>
                <td className="p-3 border border-neutral-200 font-mono text-xs">{row.entryNo}</td>
                <td className="p-3 border border-neutral-200">{row.description}</td>
                <td className="p-3 border border-neutral-200 text-right">{row.debit ? formatIDR(row.debit) : '—'}</td>
                <td className="p-3 border border-neutral-200 text-right">{row.credit ? formatIDR(row.credit) : '—'}</td>
                <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.runningBalance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-blue-50 font-bold">
              <td colSpan={5} className="p-3 border border-neutral-300">Saldo Akhir</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(alData.closingBalance || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  if (report.id === 'cash-flow-statement') {
    const cfsData = data as { sections: CashFlowStatementSection[]; summary: CashFlowStatementSummary };
    const sections = cfsData.sections || [];
    const hasRows = sections.some((s) => s.rows.length > 0);
    if (!hasRows) return renderEmptyReport('Tidak ada data arus kas untuk periode yang dipilih.');

    return (
      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.id}>
            <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{section.label}</div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-blue-50">
                  <th className="p-3 text-left font-semibold border border-neutral-300 w-[140px]">Code</th>
                  <th className="p-3 text-left font-semibold border border-neutral-300">Akun</th>
                  <th className="p-3 text-right font-semibold border border-neutral-300 w-[220px]">Jumlah</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row, i) => (
                  <tr key={i} className="hover:bg-neutral-50">
                    <td className="p-3 border border-neutral-200 font-mono text-xs">{row.code}</td>
                    <td className="p-3 border border-neutral-200">{row.name}</td>
                    <td className={`p-3 border border-neutral-200 text-right font-medium ${row.amount >= 0 ? 'text-success-700' : 'text-danger-600'}`}>
                      {formatIDR(row.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-blue-50 font-bold">
                  <td colSpan={2} className="p-3 border border-neutral-300">Subtotal {section.label}</td>
                  <td className={`p-3 border border-neutral-300 text-right ${section.subtotal >= 0 ? 'text-success-700' : 'text-danger-600'}`}>
                    {formatIDR(section.subtotal || 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}

        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-600">Perubahan Kas Bersih</span>
            <span className={`font-semibold ${(cfsData.summary.netCashChange || 0) >= 0 ? 'text-success-700' : 'text-danger-600'}`}>
              {formatIDR(cfsData.summary.netCashChange || 0)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-600">Kas Awal Periode</span>
            <span className="font-semibold">{formatIDR(cfsData.summary.beginningCash || 0)}</span>
          </div>
          {Math.abs(cfsData.summary.reconciliationDifference || 0) > 0.005 && (
            <div className="flex items-center justify-between text-sm rounded-md bg-danger-50 px-2 py-1.5">
              <span className="font-medium text-danger-700">Selisih Belum Terjelaskan</span>
              <span className="font-semibold text-danger-700">{formatIDR(cfsData.summary.reconciliationDifference || 0)}</span>
            </div>
          )}
          <div className="border-t border-neutral-200 pt-3 flex items-center justify-between">
            <span className="font-semibold text-neutral-900">Kas Akhir Periode</span>
            <span className="font-bold text-primary-700">{formatIDR(cfsData.summary.endingCash || 0)}</span>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

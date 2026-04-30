import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/apiClient';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import { formatIDR, formatDateID } from '../../utils/formatters';
import { exportToCsv } from '../../utils/exportCsv';
import { Download } from 'lucide-react';
import type { BankReconciliationRow, BankReconciliationSummary } from './Reports';

interface ReconciliationData {
  rows: BankReconciliationRow[];
  summary: BankReconciliationSummary;
}

const BankReconciliation: React.FC = () => {
  const { data, isLoading } = useQuery<ReconciliationData>({
    queryKey: ['reports', 'bank-reconciliation'],
    queryFn: () => api.get('/api/v1/reports/banking', { type: 'reconciliation-summary' }),
  });

  const rows = data?.rows ?? [];
  const summary = data?.summary ?? { totalAccounts: 0, totalUnmatched: 0, totalUnmatchedAmount: 0 };

  const handleExport = () => {
    const csvRows = rows.map((r) => ({
      account: r.accountName,
      code: r.accountCode ?? '',
      bank: r.bankName ?? '',
      bookBalance: r.bookBalance,
      statementBalance: r.statementEndBalance ?? '',
      variance: r.variance ?? '',
      matched: r.matchedCount,
      unmatched: r.unmatchedCount,
      unmatchedAmount: r.unmatchedAmount,
      lastStatement: r.lastStatementDate ? formatDateID(r.lastStatementDate) : '',
    }));
    exportToCsv('bank-reconciliation.csv', csvRows, [
      { label: 'Account', key: 'account' },
      { label: 'Code', key: 'code' },
      { label: 'Bank', key: 'bank' },
      { label: 'Book Balance', key: 'bookBalance' },
      { label: 'Statement Balance', key: 'statementBalance' },
      { label: 'Variance', key: 'variance' },
      { label: 'Matched', key: 'matched' },
      { label: 'Unmatched', key: 'unmatched' },
      { label: 'Unmatched Amount', key: 'unmatchedAmount' },
      { label: 'Last Statement', key: 'lastStatement' },
    ]);
  };

  const columns: TableColumn<BankReconciliationRow>[] = [
    {
      key: 'accountName',
      label: 'Account',
      render: (_v, row) => (
        <div>
          <div className="font-medium">{row.accountName}</div>
          {row.accountCode && <div className="text-xs text-neutral-400">{row.accountCode}</div>}
        </div>
      ),
    },
    { key: 'bankName', label: 'Bank', render: (_v, row) => row.bankName ?? '—' },
    {
      key: 'bookBalance',
      label: 'Book Balance',
      align: 'right',
      render: (_v, row) => formatIDR(row.bookBalance),
    },
    {
      key: 'statementEndBalance',
      label: 'Statement Balance',
      align: 'right',
      render: (_v, row) =>
        row.statementEndBalance != null
          ? formatIDR(row.statementEndBalance)
          : <span className="text-neutral-400 text-xs">No statement</span>,
    },
    {
      key: 'variance',
      label: 'Variance',
      align: 'right',
      render: (_v, row) => {
        if (row.variance == null) return '—';
        const hasVariance = Math.abs(row.variance) > 0.01;
        return (
          <span className={hasVariance ? 'text-danger-600 font-semibold' : 'text-success-700'}>
            {formatIDR(row.variance)}
          </span>
        );
      },
    },
    {
      key: 'matchedCount',
      label: 'Matched',
      align: 'right',
      render: (_v, row) => <span className="text-success-700">{row.matchedCount}</span>,
    },
    {
      key: 'unmatchedCount',
      label: 'Unmatched',
      align: 'right',
      render: (_v, row) =>
        row.unmatchedCount > 0 ? (
          <span className="text-amber-600 font-semibold">
            {row.unmatchedCount} ({formatIDR(row.unmatchedAmount)})
          </span>
        ) : (
          <span>{row.unmatchedCount}</span>
        ),
    },
    {
      key: 'lastStatementDate',
      label: 'Last Statement',
      render: (_v, row) => (row.lastStatementDate ? formatDateID(row.lastStatementDate) : '—'),
    },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Bank Reconciliation</h1>
          <p className="text-sm text-neutral-500 mt-0.5">Book balance vs statement balance per bank account</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={!rows.length}>
          <Download size={14} className="mr-1" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-sm text-neutral-500">Bank Accounts</div>
          <div className="text-2xl font-bold mt-1">{summary.totalAccounts}</div>
        </Card>
        <Card className="p-4 border-amber-200 bg-amber-50">
          <div className="text-sm text-amber-600">Unmatched Lines</div>
          <div className="text-2xl font-bold text-amber-700 mt-1">{summary.totalUnmatched}</div>
        </Card>
        <Card className="p-4 border-amber-200 bg-amber-50">
          <div className="text-sm text-amber-600">Unmatched Amount</div>
          <div className="text-2xl font-bold text-amber-700 mt-1">{formatIDR(summary.totalUnmatchedAmount)}</div>
        </Card>
      </div>

      <Card>
        <Table<BankReconciliationRow>
          columns={columns}
          data={rows}
          isLoading={isLoading}
        />
      </Card>
    </div>
  );
};

export default BankReconciliation;

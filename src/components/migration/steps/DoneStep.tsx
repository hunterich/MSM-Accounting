import React from 'react';
import { useQuery } from '@tanstack/react-query';
import Button from '../../UI/Button';
import Card from '../../UI/Card';
import Table, { type TableColumn } from '../../UI/Table';
import { api } from '../../../api/apiClient';
import { useBatch, useRollbackBatch } from '../../../hooks/useMigration';
import { formatIDR, formatDateID, humanizeLabel } from '../../../utils/formatters';
import { useToastStore } from '../../../stores/useToastStore';

export interface DoneStepProps {
  batch: {
    id: string;
    cutoverDate: string;
    summary?: Record<string, number>;
  };
  onRolledBack: () => void;
}

/** Shape of a Trial Balance row from `GET /api/v1/reports/gl?type=trial-balance`. */
interface TrialBalanceRow extends Record<string, unknown> {
  accountCode: string | null | undefined;
  accountName: string;
  endingDebit: number;
  endingCredit: number;
}

interface TrialBalanceResponse {
  rows: TrialBalanceRow[];
}

/** Human labels for the known `summary` count keys; unknown keys fall back to humanize. */
const SUMMARY_LABELS: Record<string, string> = {
  accounts: 'accounts',
  customers: 'customers',
  vendors: 'vendors',
  items: 'items',
  openingInvoices: 'open invoices',
  openingBills: 'open bills',
  openingJournalLines: 'trial-balance lines',
};

const MAX_TB_ROWS = 15;

/**
 * Task 9 final screen: confirms the migration committed, echoes the counts it
 * created, and — as a trust check — reads the *live* Trial Balance as of the
 * cutover date straight from the reporting endpoint so the user can see their
 * opening balances landed. Rollback stays available until post-cutover activity
 * exists; the server enforces that guard and can refuse (or throw), so both the
 * `{rolledBack:false}` and the thrown-error paths degrade to a friendly toast.
 */
const DoneStep: React.FC<DoneStepProps> = ({ batch, onRolledBack }) => {
  const pushToast = useToastStore((s) => s.pushToast);
  const rollback = useRollbackBatch(batch.id);

  // The commit response doesn't carry the summary counts — they're stamped on
  // the batch record server-side. Prefer a summary passed via props; otherwise
  // refetch the batch to read `summary`.
  const batchQuery = useBatch(batch.summary ? undefined : batch.id);
  const summary: Record<string, number> | undefined =
    batch.summary ??
    (batchQuery.data?.summary as Record<string, number> | undefined);

  const tb = useQuery({
    queryKey: ['migration', 'done-tb', batch.id, batch.cutoverDate],
    queryFn: () =>
      api.get<TrialBalanceResponse>('/api/v1/reports/gl', {
        type: 'trial-balance',
        asOfDate: batch.cutoverDate,
      }),
    staleTime: 0,
  });

  const summaryText = summary
    ? Object.entries(summary)
        .filter(([, count]) => typeof count === 'number' && count > 0)
        .map(([key, count]) => `${count} ${SUMMARY_LABELS[key] ?? humanizeLabel(key).toLowerCase()}`)
        .join(', ')
    : '';

  const tbColumns: TableColumn<TrialBalanceRow>[] = [
    {
      key: 'accountCode',
      label: 'Code',
      render: (value) => <span className="text-neutral-500">{(value as string) ?? '—'}</span>,
    },
    { key: 'accountName', label: 'Account' },
    {
      key: 'endingDebit',
      label: 'Debit',
      align: 'right',
      render: (value) => formatIDR(value as number),
    },
    {
      key: 'endingCredit',
      label: 'Credit',
      align: 'right',
      render: (value) => formatIDR(value as number),
    },
  ];

  const tbRows = (tb.data?.rows ?? []).slice(0, MAX_TB_ROWS);

  const handleRollback = async (): Promise<void> => {
    const confirmed = window.confirm(
      'This deletes everything this migration created. Continue?',
    );
    if (!confirmed) return;

    try {
      const result = await rollback.mutateAsync();
      if (result.rolledBack) {
        pushToast('Migration rolled back', 'success');
        onRolledBack();
        return;
      }
      pushToast(
        result.reason || 'Rollback blocked — the books may already be in use.',
        'error',
      );
    } catch (e) {
      const message =
        e instanceof Error && e.message
          ? e.message
          : 'Rollback failed — the books may already be in use.';
      pushToast(message, 'error');
    }
  };

  return (
    <Card title="Done">
      <div className="flex flex-col gap-5">
        <div className="rounded-md border border-success-200 bg-success-50 px-4 py-3">
          <div className="text-sm font-semibold text-success-800">Migration committed.</div>
          {summaryText ? (
            <div className="mt-1 text-sm text-success-700">Created {summaryText}.</div>
          ) : batchQuery.isLoading ? (
            <div className="mt-1 text-sm text-success-700">Loading summary…</div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium text-neutral-900">
            Your books now hold these opening balances (Trial Balance as of{' '}
            {formatDateID(batch.cutoverDate)})
          </div>

          {tb.isLoading ? (
            <div className="text-sm text-neutral-600">Loading trial balance…</div>
          ) : tb.isError ? (
            <div className="rounded-md border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800">
              Could not load trial balance for verification.
            </div>
          ) : tbRows.length === 0 ? (
            <div className="text-sm text-neutral-600">No trial-balance rows to show.</div>
          ) : (
            <Table columns={tbColumns} data={tbRows} virtualize={false} />
          )}
        </div>

        <div className="flex items-center border-t border-neutral-200 pt-4">
          <Button variant="danger" onClick={handleRollback} loading={rollback.isPending}>
            Roll back this migration
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default DoneStep;

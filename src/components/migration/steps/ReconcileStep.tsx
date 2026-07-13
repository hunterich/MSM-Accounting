import React, { useEffect } from 'react';
import Button from '../../UI/Button';
import Card from '../../UI/Card';
import Table, { type TableColumn } from '../../UI/Table';
import { useReconcile, type ReconcileCheck } from '../../../hooks/useMigration';
import { formatIDR } from '../../../utils/formatters';

export interface ReconcileStepProps {
  batchId: string;
  onProceed: () => void;
  onBack: () => void;
}

interface CheckRow extends Record<string, unknown> {
  id: string;
  label: string;
  expected: number;
  actual: number;
  pass: boolean;
}

/** Friendly names for the four fixed checks — falls back to the API's own `label`. */
const CHECK_LABELS: Record<string, string> = {
  'tb-balanced': 'Trial balance is balanced',
  'ar-tie': 'Open AR ties to AR control',
  'ap-tie': 'Open AP ties to AP control',
  'inventory-tie': 'Opening stock ties to inventory',
};

/** One-line hint shown under a failing check to point at what to go fix. */
const CHECK_HINTS: Record<string, string> = {
  'tb-balanced':
    "Your trial balance debits (Actual) don't equal credits (Expected) — fix the trial balance import before continuing.",
  'ar-tie':
    "Your open AR invoices total (Actual) doesn't equal the AR control balance in the trial balance (Expected).",
  'ap-tie':
    "Your open AP bills total (Actual) doesn't equal the AP control balance in the trial balance (Expected).",
  'inventory-tie':
    "Your opening stock value (Actual) doesn't equal the inventory control balance in the trial balance (Expected).",
};

/**
 * Task 8 of the migration wizard: runs the four reconcile checks (TB balanced,
 * AR ties, AP ties, inventory ties) and blocks "Continue to commit" until all
 * four pass. `useReconcile` is keyed + enabled on `batchId` but the hook's own
 * docs say to trigger it explicitly rather than rely on mount-fetch timing, so
 * we `refetch()` on mount / batchId change.
 */
const ReconcileStep: React.FC<ReconcileStepProps> = ({ batchId, onProceed, onBack }) => {
  const { data, isLoading, isError, error, refetch, isFetching } = useReconcile(batchId);

  useEffect(() => {
    if (batchId) {
      void refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  const columns: TableColumn<CheckRow>[] = [
    {
      key: 'label',
      label: 'Check',
      render: (_value, row) => (
        <div>
          <div className="font-medium text-neutral-900">
            {CHECK_LABELS[row.id] ?? row.label}
          </div>
          {!row.pass && (
            <div className="mt-1 text-xs text-danger-600">
              {CHECK_HINTS[row.id] ?? 'This check does not match — review your staged data.'}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'expected',
      label: 'Expected',
      align: 'right',
      render: (value) => formatIDR(value as number),
    },
    {
      key: 'actual',
      label: 'Actual',
      align: 'right',
      render: (value) => formatIDR(value as number),
    },
    {
      key: 'pass',
      label: 'Status',
      align: 'center',
      render: (value) =>
        value ? (
          <span className="font-semibold text-success-600" aria-label="Pass">
            ✓
          </span>
        ) : (
          <span className="font-semibold text-danger-600" aria-label="Fail">
            ✗
          </span>
        ),
    },
  ];

  if (isLoading) {
    return (
      <Card title="Reconcile">
        <div className="text-sm text-neutral-600">Running reconciliation checks…</div>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card title="Reconcile">
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
            {error instanceof Error ? error.message : 'Could not run reconciliation checks.'}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
            <Button className="ml-auto" onClick={() => refetch()} loading={isFetching}>
              Retry
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const rows: CheckRow[] = (data.checks as ReconcileCheck[]).map((c) => ({
    id: c.id,
    label: c.label,
    expected: c.expected,
    actual: c.actual,
    pass: c.pass,
  }));

  return (
    <Card title="Reconcile">
      <div className="flex flex-col gap-4">
        {data.ok ? (
          <div className="rounded-md border border-success-200 bg-success-50 px-4 py-3 text-sm font-medium text-success-800">
            All checks pass — ready to commit
          </div>
        ) : (
          <div className="rounded-md border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-800">
            Some checks don't match — fix your staged data and re-check.
          </div>
        )}

        <Table columns={columns} data={rows} virtualize={false} />

        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button variant="secondary" onClick={() => refetch()} loading={isFetching}>
            Re-check
          </Button>
          <Button className="ml-auto" onClick={onProceed} disabled={data?.ok !== true}>
            Continue to commit
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default ReconcileStep;

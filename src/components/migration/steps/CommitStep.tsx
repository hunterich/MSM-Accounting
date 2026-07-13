import React, { useState } from 'react';
import Button from '../../UI/Button';
import Card from '../../UI/Card';
import {
  useCommitBatch,
  type CommitResult,
  type ReconcileCheck,
} from '../../../hooks/useMigration';
import { formatIDR, formatDateID } from '../../../utils/formatters';
import { useToastStore } from '../../../stores/useToastStore';

export interface CommitStepProps {
  batchId: string;
  cutoverDate: string;
  onCommitted: (result: CommitResult) => void;
  onBack: () => void;
}

/** Friendly names for the four fixed checks — falls back to the API's own `label`. */
const CHECK_LABELS: Record<string, string> = {
  'tb-balanced': 'Trial balance is balanced',
  'ar-tie': 'Open AR ties to AR control',
  'ap-tie': 'Open AP ties to AP control',
  'inventory-tie': 'Opening stock ties to inventory',
};

/**
 * Task 9 of the migration wizard: the final "commit" gate. Posts the staged
 * opening balances to the live books. The commit endpoint is reconcile-gated
 * server-side — it returns HTTP 200 with `committed:false` and the failing
 * checks if reconciliation no longer holds, so we must NOT advance in that case
 * (mirrors ReconcileStep). A thrown error (network / server) surfaces as a toast
 * and keeps the user on this step.
 */
const CommitStep: React.FC<CommitStepProps> = ({ batchId, cutoverDate, onCommitted, onBack }) => {
  const pushToast = useToastStore((s) => s.pushToast);
  const commit = useCommitBatch(batchId);
  const [blockedChecks, setBlockedChecks] = useState<ReconcileCheck[] | null>(null);

  const handleCommit = async (): Promise<void> => {
    try {
      const result = await commit.mutateAsync();
      if (result.committed) {
        setBlockedChecks(null);
        onCommitted(result);
        return;
      }
      // committed === false: reconcile failed at commit time. Show which checks
      // failed and stay put — do NOT advance to 'done'.
      const failed = (result.reconcile?.checks ?? []).filter((c) => !c.pass);
      setBlockedChecks(failed.length > 0 ? failed : (result.reconcile?.checks ?? []));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not commit the migration.';
      pushToast(message, 'error');
    }
  };

  return (
    <Card title="Commit">
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          This posts your opening balances to the live books as of{' '}
          <span className="font-medium text-neutral-900">{formatDateID(cutoverDate)}</span>. You can
          roll it back until you record new transactions.
        </div>

        {blockedChecks && (
          <div className="flex flex-col gap-2">
            <div className="rounded-md border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-800">
              Commit blocked — reconciliation failed. Go back and fix your data.
            </div>
            <ul className="flex flex-col gap-1 rounded-md border border-neutral-200 divide-y divide-neutral-100">
              {blockedChecks.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="text-neutral-800">
                    <span className="mr-1.5 font-semibold text-danger-600" aria-label="Fail">
                      ✗
                    </span>
                    {CHECK_LABELS[c.id] ?? c.label}
                  </span>
                  <span className="shrink-0 text-right text-xs text-neutral-500">
                    expected {formatIDR(c.expected)} · actual {formatIDR(c.actual)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onBack} disabled={commit.isPending}>
            Back
          </Button>
          {!blockedChecks && (
            <Button className="ml-auto" onClick={handleCommit} loading={commit.isPending}>
              Commit migration
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
};

export default CommitStep;

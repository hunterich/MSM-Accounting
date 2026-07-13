import React, { useState } from 'react';
import Button from '../../UI/Button';
import Card from '../../UI/Card';
import Input from '../../UI/Input';
import { useCreateBatch } from '../../../hooks/useMigration';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useToastStore } from '../../../stores/useToastStore';

export interface StartStepBatch {
  id: string;
  cutoverDate: string;
  status: string;
}

export interface StartStepProps {
  onCreated: (batch: StartStepBatch) => void;
}

/**
 * First step of the migration wizard. Captures the cutover date and creates a
 * DRAFT migration batch. Everything imported later is dated as-of this cutover;
 * the batch stays rollback-able until real post-cutover transactions are booked.
 */
const StartStep: React.FC<StartStepProps> = ({ onCreated }) => {
  const orgName = useAuthStore((s) => s.org?.name);
  const pushToast = useToastStore((s) => s.pushToast);
  const createBatch = useCreateBatch();

  const [cutoverDate, setCutoverDate] = useState('');

  const handleStart = async (): Promise<void> => {
    if (!cutoverDate) return;
    try {
      const batch = await createBatch.mutateAsync(cutoverDate);
      onCreated({
        id: batch.id,
        cutoverDate: batch.cutoverDate ?? cutoverDate,
        status: batch.status,
      });
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  return (
    <Card title="Start data migration">
      <div className="flex flex-col gap-4">
        <div className="text-sm text-neutral-600">
          Migrating into{' '}
          <span className="font-medium text-neutral-900">
            {orgName ?? 'this company'}
          </span>
          .
        </div>

        <p className="text-sm text-neutral-600">
          This is a clean cutover. The wizard imports your master data (chart of
          accounts, customers, vendors, items) and opening balances as of the
          cutover date. You can roll the whole migration back at any time until
          you record your first new transaction after the cutover.
        </p>

        <Input
          id="cutoverDate"
          type="date"
          label="Cutover date"
          required
          value={cutoverDate}
          onChange={(e) => setCutoverDate(e.target.value)}
        />

        <div className="flex items-center">
          <Button
            onClick={handleStart}
            disabled={!cutoverDate || createBatch.isPending}
            loading={createBatch.isPending}
            className="ml-auto"
          >
            Start migration
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default StartStep;

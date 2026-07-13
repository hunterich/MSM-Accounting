import React, { useState } from 'react';
import Card from '../UI/Card';
import StartStep, { type StartStepBatch } from './steps/StartStep';
import EntityStageStep from './steps/EntityStageStep';
import ReconcileStep from './steps/ReconcileStep';
import CommitStep from './steps/CommitStep';
import DoneStep from './steps/DoneStep';
import type { MigrationEntity } from '../../utils/migrationFields';
import { useModulePermissions } from '../../hooks/useModulePermissions';

type Step =
  | 'start'
  | 'accounts'
  | 'customers'
  | 'vendors'
  | 'items'
  | 'opening-journal'
  | 'opening-invoices'
  | 'opening-bills'
  | 'reconcile'
  | 'commit'
  | 'done';

const STEPS: Step[] = [
  'start',
  'accounts',
  'customers',
  'vendors',
  'items',
  'opening-journal',
  'opening-invoices',
  'opening-bills',
  'reconcile',
  'commit',
  'done',
];

const LABEL: Record<Step, string> = {
  start: 'Start',
  accounts: 'Chart of Accounts',
  customers: 'Customers',
  vendors: 'Vendors',
  items: 'Items & Stock',
  'opening-journal': 'Trial Balance',
  'opening-invoices': 'Open AR',
  'opening-bills': 'Open AP',
  reconcile: 'Reconcile',
  commit: 'Commit',
  done: 'Done',
};

/** The steps whose body is an EntityStageStep (upload → map → stage one entity). */
const ENTITY_STEPS: MigrationEntity[] = [
  'accounts',
  'customers',
  'vendors',
  'items',
  'opening-journal',
  'opening-invoices',
  'opening-bills',
];

function isEntityStep(step: Step): step is MigrationEntity {
  return (ENTITY_STEPS as string[]).includes(step);
}

interface Batch {
  id: string;
  cutoverDate: string;
  status: string;
}

/**
 * Wizard shell / state machine for the Accurate → MSM data migration. Owns the
 * created batch and the current step; each step body advances via `goNext()`.
 */
const MigrationWizard: React.FC = () => {
  const { canCreate } = useModulePermissions('settings');

  const [step, setStep] = useState<Step>('start');
  const [batch, setBatch] = useState<Batch | null>(null);

  if (!canCreate) {
    return (
      <Card title="Data migration">
        <p className="text-sm text-neutral-600">
          You don't have permission to run data migration.
        </p>
      </Card>
    );
  }

  const go = (next: Step): void => setStep(next);

  const goNext = (): void => {
    const idx = STEPS.indexOf(step);
    const next = STEPS[Math.min(idx + 1, STEPS.length - 1)];
    setStep(next);
  };

  const goToPrev = (): void => {
    const idx = STEPS.indexOf(step);
    // Never step backward past 'commit' — once committed, the only forward
    // motion is to 'done'; there is no un-commit.
    if (step === 'commit' || step === 'done') return;
    const prev = STEPS[Math.max(idx - 1, 0)];
    setStep(prev);
  };

  // Guard: any non-start step is meaningless without a batch. If we somehow
  // land there (stale state, refresh), fall back to 'start'.
  const effectiveStep: Step = step !== 'start' && !batch ? 'start' : step;
  const currentIdx = STEPS.indexOf(effectiveStep);

  const renderBody = (): React.ReactNode => {
    if (effectiveStep === 'start') {
      return (
        <StartStep
          onCreated={(b: StartStepBatch) => {
            setBatch(b);
            setStep('accounts');
          }}
        />
      );
    }

    if (!batch) {
      // Unreachable (effectiveStep is normalised to 'start' above) but keeps
      // batch non-null for the branches below.
      return null;
    }

    if (isEntityStep(effectiveStep)) {
      return (
        <EntityStageStep
          key={effectiveStep}
          batchId={batch.id}
          entity={effectiveStep}
          title={LABEL[effectiveStep]}
          optional
          onStaged={() => goNext()}
          onSkip={() => goNext()}
          onBack={() => goToPrev()}
        />
      );
    }

    if (effectiveStep === 'reconcile') {
      return (
        <ReconcileStep
          batchId={batch.id}
          onProceed={() => setStep('commit')}
          onBack={() => go('opening-bills')}
        />
      );
    }

    if (effectiveStep === 'commit') {
      return (
        <CommitStep
          batchId={batch.id}
          cutoverDate={batch.cutoverDate}
          onCommitted={() => setStep('done')}
          onBack={() => setStep('reconcile')}
        />
      );
    }

    // effectiveStep === 'done'
    return (
      <DoneStep
        batch={{ id: batch.id, cutoverDate: batch.cutoverDate }}
        onRolledBack={() => {
          setBatch(null);
          setStep('start');
        }}
      />
    );
  };

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      {/* Progress rail */}
      <nav className="md:w-56 shrink-0">
        <ol className="flex flex-col gap-1">
          {STEPS.map((s, i) => {
            const isCurrent = i === currentIdx;
            const isDone = i < currentIdx;
            return (
              <li
                key={s}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                  isCurrent
                    ? 'bg-primary-100 font-medium text-primary-800'
                    : isDone
                      ? 'text-neutral-500'
                      : 'text-neutral-400'
                }`}
              >
                <span
                  className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                    isCurrent
                      ? 'bg-primary-700 text-white'
                      : isDone
                        ? 'bg-primary-100 text-primary-700'
                        : 'bg-neutral-100 text-neutral-400'
                  }`}
                >
                  {isDone ? '✓' : i + 1}
                </span>
                <span>{LABEL[s]}</span>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Step body */}
      <div className="min-w-0 flex-1">{renderBody()}</div>
    </div>
  );
};

export default MigrationWizard;

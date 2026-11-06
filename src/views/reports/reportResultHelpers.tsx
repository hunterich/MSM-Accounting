import React from 'react';
import type { OpenReportEntry } from './reportTypes';

export interface ReportResultProps {
  activeReport: OpenReportEntry;
  categoryNameById: ReadonlyMap<string, string>;
}

export const getStatusPillClass = (status: string): string => {
  if (status === 'PAID' || status === 'Completed') return 'bg-success-50 text-success-700';
  if (status === 'OVERDUE') return 'bg-danger-50 text-danger-700';
  if (status === 'SENT') return 'bg-primary-50 text-primary-700';
  return 'bg-neutral-100 text-neutral-600';
};

export const renderEmptyReport = (message: string): React.ReactElement => (
  <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-6 py-10 text-center text-sm text-neutral-500">
    {message}
  </div>
);

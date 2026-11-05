import React from 'react';
import ControlReconciliationReport from './ControlReconciliationReport';
import { controlReconciliationKind } from './controlReconciliation';
import ApReportResult from './ApReportResult';
import ArReportResult from './ArReportResult';
import BankingReportResult from './BankingReportResult';
import GlReportResult from './GlReportResult';
import HrReportResult from './HrReportResult';
import InventoryReportResult from './InventoryReportResult';
import type { OpenReportEntry } from './reportTypes';
import SalesReportResult from './SalesReportResult';
import StatementReportResult from './StatementReportResult';

interface Props {
  activeReport: OpenReportEntry | null;
  isLoading: boolean;
  error: string | null;
  categoryNameById: ReadonlyMap<string, string>;
}

/** Dispatches results; each domain owns its tables and charts. */
export default function ReportResult({ activeReport, isLoading, error, categoryNameById }: Props): React.ReactNode {
  if (isLoading) return <div className="p-12 text-center text-neutral-500">Memuat laporan...</div>;
  if (error) return <div className="p-8 text-center text-danger-600">Error: {error}</div>;
  if (!activeReport) return null;
  if (controlReconciliationKind(activeReport.report.id)) return <ControlReconciliationReport data={activeReport.data} />;
  const props = { activeReport, categoryNameById };
  if (activeReport.report.filterMode === 'statement') return <StatementReportResult {...props} />;
  switch (activeReport.report.category) {
    case 'sales': return <SalesReportResult {...props} />;
    case 'ar': return <ArReportResult {...props} />;
    case 'gl': return <GlReportResult {...props} />;
    case 'ap': return <ApReportResult {...props} />;
    case 'banking': return <BankingReportResult {...props} />;
    case 'inventory': return <InventoryReportResult {...props} />;
    case 'hr': return <HrReportResult {...props} />;
  }
}

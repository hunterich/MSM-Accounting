import React from 'react';
import Reports, { type ReportDefinition, type ReportParams } from '../../views/reports/Reports';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { makeTabId } from '../../stores/workspace/types';

/** The Reports module's catalog tab: renders the card grid, and opens each
 *  chosen report as its own `report` sub-tab carrying the run params. */
const ReportsCatalogTab: React.FC = () => {
  const { open } = useWorkspaceNav();
  const saveDraft = useWorkspaceStore((s) => s.saveDraft);

  const handleRun = (report: ReportDefinition, params: ReportParams) => {
    const target = { module: 'reports', entity: report.id, recordId: null, mode: 'view' as const };
    const opened = open({ kind: 'report', target, title: report.name, path: '/reports' });
    if (opened) saveDraft(makeTabId(target), params);
  };

  return <Reports variant="catalog" onRunReport={handleRun} />;
};

export default ReportsCatalogTab;

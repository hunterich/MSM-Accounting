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
  const setStatus = useWorkspaceStore((s) => s.setStatus);

  const handleRun = (report: ReportDefinition, params: ReportParams) => {
    const target = { module: 'reports', entity: report.id, recordId: null, mode: 'view' as const };
    // Reports have no unsaved-edit concept. Open 'clean', and re-clean after
    // stashing the run params, because saveDraft marks the tab 'dirty' — so the
    // tab bar never shows a false unsaved-changes dot on a report sub-tab.
    const opened = open({ kind: 'report', target, title: report.name, path: '/reports', initialStatus: 'clean' });
    if (opened) {
      const id = makeTabId(target);
      saveDraft(id, params);
      setStatus(id, 'clean');
    }
  };

  return <Reports variant="catalog" onRunReport={handleRun} />;
};

export default ReportsCatalogTab;

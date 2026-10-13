import React from 'react';
import Reports, { type ReportDefinition, type ReportParams } from '../../views/reports/Reports';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { reportTabId, reportTabTarget, reportTabTitle } from './reportTabs';

/** The Reports module's catalog tab: renders the card grid, and opens each
 *  run as a `report` sub-tab carrying its params. Distinct filters open
 *  separate tabs (compare periods side by side); the same filters refocus. */
const ReportsCatalogTab: React.FC = () => {
  const { open } = useWorkspaceNav();
  const saveDraft = useWorkspaceStore((s) => s.saveDraft);
  const setStatus = useWorkspaceStore((s) => s.setStatus);
  const setTitle = useWorkspaceStore((s) => s.setTitle);

  const handleRun = (report: ReportDefinition, params: ReportParams) => {
    // The params ride on the tab itself, so a tab blocked by the cap prompt and
    // opened later via "make room" still runs with the chosen filters.
    const opened = open({
      kind: 'report',
      target: reportTabTarget(report, params),
      title: reportTabTitle(report, params),
      path: '/reports',
      initialStatus: 'clean',
      draft: params,
    });
    if (opened) {
      // Refocusing an existing tab (whose filters may since have changed via
      // "Ubah Filter") must show what was just requested. Reports have no
      // unsaved state, so re-clean after saveDraft marks the tab dirty.
      const id = reportTabId(report, params);
      saveDraft(id, params);
      setStatus(id, 'clean');
      setTitle(id, reportTabTitle(report, params));
    }
  };

  return <Reports variant="catalog" onRunReport={handleRun} />;
};

export default ReportsCatalogTab;

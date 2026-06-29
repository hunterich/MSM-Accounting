import React from 'react';
import Reports, { findReportById, type ReportParams } from '../../views/reports/Reports';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';

/** A single open report, rendered from the params stashed on its workspace tab
 *  draft. "Ubah Filter" persists new params back to the same tab. */
const ReportsReportTab: React.FC<{ tabId: string }> = ({ tabId }) => {
  const tab = useWorkspaceStore((s) => s.tabs.find((t) => t.id === tabId));
  const saveDraft = useWorkspaceStore((s) => s.saveDraft);
  const setStatus = useWorkspaceStore((s) => s.setStatus);
  const report = findReportById(tab?.target.entity);
  const params = tab?.draft as ReportParams | undefined;

  if (!report) {
    return <div className="p-6 text-sm text-neutral-500">Unknown report.</div>;
  }

  return (
    <Reports
      variant="single"
      singleReport={report}
      singleParams={params}
      onParamsChange={(p) => {
        // Persist the new params, then re-clean: reports carry no unsaved state,
        // so the tab must not show a dirty dot after "Ubah Filter".
        saveDraft(tabId, p);
        setStatus(tabId, 'clean');
      }}
    />
  );
};

export default ReportsReportTab;

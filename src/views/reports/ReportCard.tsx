import { BarChart3, LayoutGrid } from 'lucide-react';
import React from 'react';
import type { ReportDefinition } from './reportTypes';

// ── Sub-components ─────────────────────────────────────────────────────────────

const TableIcon: React.FC = () => (
  <div className="w-12 h-12 rounded-lg bg-purple-50 flex items-center justify-center">
    <LayoutGrid size={24} className="text-purple-600" />
  </div>
);

const ChartIcon: React.FC = () => (
  <div className="w-12 h-12 rounded-lg bg-orange-50 flex items-center justify-center">
    <BarChart3 size={24} className="text-orange-500" />
  </div>
);

interface ReportCardProps {
  report: ReportDefinition;
  onClick: (report: ReportDefinition) => void;
}

const ReportCard: React.FC<ReportCardProps> = ({ report, onClick }) => (
  <button
    onClick={() => onClick(report)}
    className="flex items-start gap-4 p-4 bg-neutral-0 border border-neutral-200 rounded-lg text-left hover:border-primary-400 hover:shadow-sm transition-all cursor-pointer w-full"
  >
    {report.type === 'chart' ? <ChartIcon /> : <TableIcon />}
    <div>
      <div className="font-semibold text-neutral-900 text-sm mb-0.5">{report.name}</div>
      <div className="text-xs text-neutral-500 leading-relaxed">{report.description}</div>
    </div>
  </button>
);


export default ReportCard;

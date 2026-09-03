import React, { useState, useMemo } from 'react';
import { Play, CheckCircle } from 'lucide-react';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import ListPage from '../../components/Layout/ListPage';
import { useAssets, useRunDepreciation } from '../../hooks/useAssets';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { formatIDR } from '../../utils/formatters';

const currentDate = new Date();

const DepreciationRun = () => {
  const { canCreate } = useModulePermissions('gl_journal');
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const [year, setYear] = useState(currentDate.getFullYear());
  const [showConfirm, setShowConfirm] = useState(false);
  const [results, setResults] = useState<any>(null);

  const runMutation = useRunDepreciation();
  const { data: assetsResult, isLoading } = useAssets({ status: 'ACTIVE', limit: 200 });
  const activeAssets = assetsResult?.data ?? [];

  // Preview which assets will be processed
  const previewAssets = useMemo(() => {
    return activeAssets.map((a) => ({
      ...a,
      estimatedDepreciation:
        a.depreciationMethod === 'STRAIGHT_LINE'
          ? Math.round(((a.acquisitionCost - a.salvageValue) / a.usefulLifeMonths) * 100) / 100
          : Math.round(((a.bookValue * (a.depreciationMethod === 'DOUBLE_DECLINING' ? 2 : 1)) / (a.usefulLifeMonths / 12)) / 12 * 100) / 100,
    }));
  }, [activeAssets]);

  const totalEstimated = useMemo(
    () => previewAssets.reduce((s, a) => s + (a.estimatedDepreciation > 0 ? a.estimatedDepreciation : 0), 0),
    [previewAssets],
  );

  const handleRun = async () => {
    try {
      const result = await runMutation.mutateAsync({ month, year });
      setResults(result);
      setShowConfirm(false);
    } catch {
      setShowConfirm(false);
    }
  };

  const previewColumns: TableColumn<Record<string, unknown>>[] = [
    { key: 'assetNo', label: 'Asset No', render: (val: unknown) => <span className="font-mono font-semibold">{val as string}</span> },
    { key: 'name', label: 'Name' },
    { key: 'categoryName', label: 'Category' },
    {
      key: 'bookValue',
      label: 'Current Book Value',
      align: 'right' as const,
      render: (val: unknown) => formatIDR(Number(val)),
    },
    {
      key: 'estimatedDepreciation',
      label: 'Est. Depreciation',
      align: 'right' as const,
      render: (val: unknown) => {
        const v = Number(val);
        return v > 0 ? formatIDR(v) : <span className="text-neutral-400">-</span>;
      },
    },
  ];

  const resultColumns: TableColumn<Record<string, unknown>>[] = [
    { key: 'assetNo', label: 'Asset No', render: (val: unknown) => <span className="font-mono font-semibold">{val as string}</span> },
    { key: 'name', label: 'Name' },
    {
      key: 'depreciationAmount',
      label: 'Amount',
      align: 'right' as const,
      render: (val: unknown) => formatIDR(Number(val)),
    },
    {
      key: 'newBookValue',
      label: 'New Book Value',
      align: 'right' as const,
      render: (val: unknown) => formatIDR(Number(val)),
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => (
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${val === 'FULLY_DEPRECIATED' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
          {val === 'FULLY_DEPRECIATED' ? 'Fully Depreciated' : 'Active'}
        </span>
      ),
    },
    {
      key: 'journalEntryId',
      label: 'JE Ref',
      render: (val: unknown) => val ? <span className="font-mono text-xs">{(val as string).slice(0, 8)}...</span> : '-',
    },
  ];

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  return (
    <ListPage
      title="Depreciation Run"
      subtitle="Process monthly depreciation for all active assets."
    >
      {/* Period selector */}
      <Card className="mb-4">
        <h3 className="text-base font-semibold text-neutral-900 mb-4">Select Period</h3>
        <div className="flex items-end gap-4">
          <div>
            <label className="form-label">Month</label>
            <select
              className="block w-40 h-9 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 focus:border-primary-500 focus:outline-0"
              value={month}
              onChange={(e) => {
                setMonth(parseInt(e.target.value));
                setResults(null);
              }}
            >
              {months.map((name, idx) => (
                <option key={idx} value={idx + 1}>{name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Year</label>
            <select
              className="block w-28 h-9 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 focus:border-primary-500 focus:outline-0"
              value={year}
              onChange={(e) => {
                setYear(parseInt(e.target.value));
                setResults(null);
              }}
            >
              {Array.from({ length: 10 }, (_, i) => currentDate.getFullYear() - 2 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <Button
            text="Run Depreciation"
            variant="primary"
            icon={<Play size={16} />}
            onClick={() => setShowConfirm(true)}
            disabled={!canCreate || activeAssets.length === 0}
          />
        </div>
      </Card>

      {/* Results */}
      {results && (
        <Card className="mb-4">
          <div className="flex items-center gap-3 mb-4">
            <CheckCircle size={24} className="text-green-600" />
            <div>
              <h3 className="text-base font-semibold text-green-700">Depreciation Run Complete</h3>
              <p className="text-sm text-neutral-600">
                {results.assetsProcessed} assets processed for {months[month - 1]} {year}.
                Total depreciation: <strong>{formatIDR(results.totalDepreciation)}</strong>
              </p>
            </div>
          </div>
          <Table
            columns={resultColumns}
            data={(results.results || []) as Record<string, unknown>[]}
            showCount
            countLabel="assets processed"
          />
        </Card>
      )}

      {/* Preview */}
      {!results && (
        <Card padding={false}>
          <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-neutral-900">Preview: Active Assets</h3>
              <p className="text-sm text-neutral-500 mt-0.5">
                {previewAssets.length} assets will be processed.
                Estimated total: <strong>{formatIDR(totalEstimated)}</strong>
              </p>
            </div>
          </div>
          <Table
            columns={previewColumns}
            data={previewAssets as unknown as Record<string, unknown>[]}
            showCount
            countLabel="active assets"
            isLoading={isLoading}
            loadingLabel="Loading assets..."
          />
        </Card>
      )}

      {/* Confirmation Modal */}
      <Modal isOpen={showConfirm} onClose={() => setShowConfirm(false)} title="Confirm Depreciation Run" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-neutral-700">
            You are about to run depreciation for <strong>{months[month - 1]} {year}</strong>.
          </p>
          <div className="p-3 bg-neutral-50 rounded-lg text-sm">
            <p><strong>Assets to process:</strong> {previewAssets.length}</p>
            <p><strong>Estimated depreciation:</strong> {formatIDR(totalEstimated)}</p>
          </div>
          <p className="text-xs text-neutral-500">
            This will create depreciation entries and journal entries for each asset.
            This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="tertiary" text="Cancel" onClick={() => setShowConfirm(false)} />
            <Button
              type="button"
              variant="primary"
              text="Run Depreciation"
              icon={<Play size={16} />}
              onClick={handleRun}
              disabled={runMutation.isPending}
            />
          </div>
        </div>
      </Modal>
    </ListPage>
  );
};

export default DepreciationRun;

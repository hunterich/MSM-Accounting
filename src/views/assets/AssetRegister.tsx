import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Download } from 'lucide-react';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import ListPage from '../../components/Layout/ListPage';
import { useAssets, useAssetCategories } from '../../hooks/useAssets';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { formatIDR } from '../../utils/formatters';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  FULLY_DEPRECIATED: 'Fully Depreciated',
  DISPOSED: 'Disposed',
  WRITTEN_OFF: 'Written Off',
};

const AssetRegister = () => {
  const navigate = useNavigate();
  const { canCreate } = useModulePermissions('gl_journal');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const { data: categoriesData = [] } = useAssetCategories();
  const { data: assetsResult, isLoading } = useAssets({
    search: searchTerm || undefined,
    status: statusFilter || undefined,
    categoryId: categoryFilter || undefined,
    limit: 100,
  });

  const assets = assetsResult?.data ?? [];

  // Summary stats
  const summary = useMemo(() => {
    const totalAssets = assets.length;
    const totalCost = assets.reduce((s, a) => s + a.acquisitionCost, 0);
    const totalBookValue = assets.reduce((s, a) => s + a.bookValue, 0);
    const fullyDepreciated = assets.filter((a) => a.status === 'FULLY_DEPRECIATED').length;
    return { totalAssets, totalCost, totalBookValue, fullyDepreciated };
  }, [assets]);

  const handleExportCSV = () => {
    const headers = ['Asset No', 'Name', 'Category', 'Acquisition Date', 'Cost', 'Accum. Dep.', 'Book Value', 'Status'];
    const rows = assets.map((a) => [
      a.assetNo,
      a.name,
      a.categoryName,
      a.acquisitionDate,
      a.acquisitionCost,
      a.accumulatedDepreciation,
      a.bookValue,
      STATUS_LABELS[a.status] || a.status,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'asset-register.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const columns: TableColumn<Record<string, unknown>>[] = [
    {
      key: 'assetNo',
      label: 'Asset No',
      sortable: true,
      render: (val: unknown, row: Record<string, unknown>) => (
        <button
          type="button"
          className="text-primary-600 hover:text-primary-800 font-mono font-semibold text-left"
          onClick={() => navigate(`/assets/${row.id}`)}
        >
          {val as string}
        </button>
      ),
    },
    { key: 'name', label: 'Name', sortable: true },
    { key: 'categoryName', label: 'Category' },
    {
      key: 'acquisitionDate',
      label: 'Acq. Date',
      render: (val: unknown) => (val as string) || '-',
    },
    {
      key: 'acquisitionCost',
      label: 'Cost',
      align: 'right' as const,
      render: (val: unknown) => formatIDR(Number(val)),
    },
    {
      key: 'accumulatedDepreciation',
      label: 'Accum. Dep.',
      align: 'right' as const,
      render: (val: unknown) => formatIDR(Number(val)),
    },
    {
      key: 'bookValue',
      label: 'Book Value',
      align: 'right' as const,
      render: (val: unknown) => <span className="font-semibold">{formatIDR(Number(val))}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => <StatusTag status={STATUS_LABELS[val as string] || (val as string)} />,
    },
  ];

  return (
    <ListPage
      title="Asset Register"
      subtitle="Track and manage all fixed assets."
      actions={
        <div className="flex gap-2">
          <Button
            text="Export CSV"
            variant="secondary"
            icon={<Download size={16} />}
            onClick={handleExportCSV}
          />
          <Button
            text="New Asset"
            variant="primary"
            icon={<Plus size={16} />}
            disabled={!canCreate}
            onClick={() => navigate('/assets/new')}
          />
        </div>
      }
    >
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <Card>
          <p className="text-xs text-neutral-500 uppercase tracking-wide">Total Assets</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">{summary.totalAssets}</p>
        </Card>
        <Card>
          <p className="text-xs text-neutral-500 uppercase tracking-wide">Total Cost</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">{formatIDR(summary.totalCost)}</p>
        </Card>
        <Card>
          <p className="text-xs text-neutral-500 uppercase tracking-wide">Total Book Value</p>
          <p className="text-2xl font-bold text-primary-700 mt-1">{formatIDR(summary.totalBookValue)}</p>
        </Card>
        <Card>
          <p className="text-xs text-neutral-500 uppercase tracking-wide">Fully Depreciated</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">{summary.fullyDepreciated}</p>
        </Card>
      </div>

      <Card padding={false}>
        <div className="p-3 border-b border-neutral-200 flex gap-3 items-center flex-wrap">
          <div className="relative w-64">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              className="w-full h-9 pl-9 pr-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
              placeholder="Search assets..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <select
            className="h-9 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 focus:border-primary-500 focus:outline-0"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="FULLY_DEPRECIATED">Fully Depreciated</option>
            <option value="DISPOSED">Disposed</option>
            <option value="WRITTEN_OFF">Written Off</option>
          </select>
          <select
            className="h-9 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 focus:border-primary-500 focus:outline-0"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All Categories</option>
            {categoriesData.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <Table
          columns={columns}
          data={assets as unknown as Record<string, unknown>[]}
          showCount
          countLabel="assets"
          isLoading={isLoading}
          loadingLabel="Loading assets..."
        />
      </Card>
    </ListPage>
  );
};

export default AssetRegister;

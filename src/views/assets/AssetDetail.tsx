import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Edit2, CheckCircle, XCircle } from 'lucide-react';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import Input from '../../components/UI/Input';
import StatusTag from '../../components/UI/StatusTag';
import ListPage from '../../components/Layout/ListPage';
import { useAsset, useActivateAsset, useDisposeAsset } from '../../hooks/useAssets';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { formatIDR } from '../../utils/formatters';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  FULLY_DEPRECIATED: 'Fully Depreciated',
  DISPOSED: 'Disposed',
  WRITTEN_OFF: 'Written Off',
};

const METHOD_LABELS: Record<string, string> = {
  STRAIGHT_LINE: 'Straight Line',
  DECLINING_BALANCE: 'Declining Balance',
  DOUBLE_DECLINING: 'Double Declining',
};

const AssetDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { canEdit } = useModulePermissions('gl_journal');
  const { data: asset, isLoading } = useAsset(id);
  const activateMutation = useActivateAsset();
  const disposeMutation = useDisposeAsset();

  const [showDisposeModal, setShowDisposeModal] = useState(false);
  const [disposalForm, setDisposalForm] = useState({
    disposalDate: new Date().toISOString().slice(0, 10),
    disposalAmount: '',
    disposalMethod: 'Sale',
    notes: '',
  });

  if (isLoading) {
    return (
      <ListPage title="Asset Detail" subtitle="Loading...">
        <Card>
          <div className="animate-pulse h-40 bg-neutral-100 rounded" />
        </Card>
      </ListPage>
    );
  }

  if (!asset) {
    return (
      <ListPage title="Asset Not Found" subtitle="">
        <Card>
          <p className="text-neutral-600">The requested asset could not be found.</p>
          <Button text="Back to Assets" variant="secondary" onClick={() => navigate('/assets')} className="mt-4" />
        </Card>
      </ListPage>
    );
  }

  const handleActivate = async () => {
    if (!window.confirm('Activate this asset? It will start being eligible for depreciation.')) return;
    try {
      await activateMutation.mutateAsync(asset.id);
      window.location.reload();
    } catch {
      // Error handled by React Query
    }
  };

  const handleDispose = async () => {
    if (!disposalForm.disposalAmount) return;
    try {
      await disposeMutation.mutateAsync({
        id: asset.id,
        disposalDate: disposalForm.disposalDate,
        disposalAmount: parseFloat(disposalForm.disposalAmount),
        disposalMethod: disposalForm.disposalMethod,
        notes: disposalForm.notes || undefined,
      });
      setShowDisposeModal(false);
      window.location.reload();
    } catch {
      // Error handled by React Query
    }
  };

  // Remaining useful life
  const depEntries = asset.depreciationEntries || [];
  const monthsUsed = depEntries.length;
  const remainingMonths = Math.max(0, asset.usefulLifeMonths - monthsUsed);

  const depColumns: TableColumn<Record<string, unknown>>[] = [
    {
      key: 'period',
      label: 'Period',
      render: (_: unknown, row: Record<string, unknown>) => `${row.month}/${row.year}`,
    },
    {
      key: 'date',
      label: 'Date',
      render: (val: unknown) => (val as string) || '-',
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right' as const,
      render: (val: unknown) => formatIDR(Number(val)),
    },
    {
      key: 'accumulatedTotal',
      label: 'Accumulated Total',
      align: 'right' as const,
      render: (val: unknown) => formatIDR(Number(val)),
    },
    {
      key: 'bookValue',
      label: 'Book Value',
      align: 'right' as const,
      render: (val: unknown) => <span className="font-semibold">{formatIDR(Number(val))}</span>,
    },
  ];

  return (
    <ListPage
      title={asset.name}
      subtitle={`${asset.assetNo} - ${asset.categoryName}`}
      actions={
        <div className="flex gap-2">
          <Button
            text="Back"
            variant="secondary"
            icon={<ArrowLeft size={16} />}
            onClick={() => navigate('/assets')}
          />
          {(asset.status === 'DRAFT' || asset.status === 'ACTIVE') && canEdit && (
            <Button
              text="Edit"
              variant="secondary"
              icon={<Edit2 size={16} />}
              onClick={() => navigate(`/assets/${asset.id}/edit`)}
            />
          )}
          {asset.status === 'DRAFT' && canEdit && (
            <Button
              text="Activate"
              variant="primary"
              icon={<CheckCircle size={16} />}
              onClick={handleActivate}
            />
          )}
          {(asset.status === 'ACTIVE' || asset.status === 'FULLY_DEPRECIATED') && canEdit && (
            <Button
              text="Dispose"
              variant="danger"
              icon={<XCircle size={16} />}
              onClick={() => setShowDisposeModal(true)}
            />
          )}
        </div>
      }
    >
      {/* Asset Info */}
      <div className="grid grid-cols-12 gap-4 mb-4">
        <div className="col-span-8">
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <h3 className="text-lg font-semibold text-neutral-900">{asset.name}</h3>
              <StatusTag status={STATUS_LABELS[asset.status] || asset.status} />
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <div>
                <span className="text-neutral-500">Asset No:</span>
                <span className="ml-2 font-mono font-semibold">{asset.assetNo}</span>
              </div>
              <div>
                <span className="text-neutral-500">Category:</span>
                <span className="ml-2">{asset.categoryName}</span>
              </div>
              <div>
                <span className="text-neutral-500">Acquisition Date:</span>
                <span className="ml-2">{asset.acquisitionDate}</span>
              </div>
              <div>
                <span className="text-neutral-500">Depreciation Method:</span>
                <span className="ml-2">{METHOD_LABELS[asset.depreciationMethod] || asset.depreciationMethod}</span>
              </div>
              {asset.serialNumber && (
                <div>
                  <span className="text-neutral-500">Serial No:</span>
                  <span className="ml-2 font-mono">{asset.serialNumber}</span>
                </div>
              )}
              {asset.vendor && (
                <div>
                  <span className="text-neutral-500">Vendor:</span>
                  <span className="ml-2">{asset.vendor}</span>
                </div>
              )}
              {asset.location && (
                <div>
                  <span className="text-neutral-500">Location:</span>
                  <span className="ml-2">{asset.location}</span>
                </div>
              )}
              {asset.custodian && (
                <div>
                  <span className="text-neutral-500">Custodian:</span>
                  <span className="ml-2">{asset.custodian}</span>
                </div>
              )}
              {asset.department && (
                <div>
                  <span className="text-neutral-500">Department:</span>
                  <span className="ml-2">{asset.department}</span>
                </div>
              )}
              {asset.description && (
                <div className="col-span-2">
                  <span className="text-neutral-500">Description:</span>
                  <span className="ml-2">{asset.description}</span>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="col-span-4 space-y-4">
          <Card>
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Acquisition Cost</p>
            <p className="text-xl font-bold text-neutral-900 mt-1">{formatIDR(asset.acquisitionCost)}</p>
          </Card>
          <Card>
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Accumulated Depreciation</p>
            <p className="text-xl font-bold text-red-600 mt-1">{formatIDR(asset.accumulatedDepreciation)}</p>
          </Card>
          <Card>
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Book Value</p>
            <p className="text-xl font-bold text-primary-700 mt-1">{formatIDR(asset.bookValue)}</p>
          </Card>
          <Card>
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Remaining Life</p>
            <p className="text-xl font-bold text-neutral-900 mt-1">
              {remainingMonths > 0
                ? `${Math.floor(remainingMonths / 12)}y ${remainingMonths % 12}m`
                : 'Fully depreciated'}
            </p>
          </Card>
        </div>
      </div>

      {/* Disposal info */}
      {asset.status === 'DISPOSED' && (
        <Card className="mb-4">
          <h3 className="text-base font-semibold text-neutral-900 mb-3">Disposal Information</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div>
              <span className="text-neutral-500">Disposal Date:</span>
              <span className="ml-2">{asset.disposalDate}</span>
            </div>
            <div>
              <span className="text-neutral-500">Disposal Method:</span>
              <span className="ml-2">{asset.disposalMethod}</span>
            </div>
            <div>
              <span className="text-neutral-500">Disposal Amount:</span>
              <span className="ml-2 font-semibold">{formatIDR(asset.disposalAmount)}</span>
            </div>
            <div>
              <span className="text-neutral-500">Gain/Loss:</span>
              <span className={`ml-2 font-semibold ${asset.disposalGainLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {asset.disposalGainLoss >= 0 ? 'Gain' : 'Loss'}: {formatIDR(Math.abs(asset.disposalGainLoss))}
              </span>
            </div>
            {asset.disposalNotes && (
              <div className="col-span-2">
                <span className="text-neutral-500">Notes:</span>
                <span className="ml-2">{asset.disposalNotes}</span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Depreciation Schedule */}
      <Card padding={false}>
        <div className="p-4 border-b border-neutral-200">
          <h3 className="text-base font-semibold text-neutral-900">Depreciation Schedule</h3>
        </div>
        {depEntries.length > 0 ? (
          <Table
            columns={depColumns}
            data={depEntries as unknown as Record<string, unknown>[]}
            showCount
            countLabel="entries"
          />
        ) : (
          <div className="p-8 text-center text-neutral-500 text-sm">
            No depreciation entries yet. Run monthly depreciation from the Depreciation Run page.
          </div>
        )}
      </Card>

      {/* Disposal Modal */}
      <Modal isOpen={showDisposeModal} onClose={() => setShowDisposeModal(false)} title="Dispose Asset" size="md">
        <div className="space-y-4">
          <div className="p-3 bg-red-50 rounded-lg text-sm text-red-700">
            You are about to dispose asset <strong>{asset.assetNo}</strong> ({asset.name}).
            Current book value: <strong>{formatIDR(asset.bookValue)}</strong>.
          </div>

          <Input
            label="Disposal Date *"
            type="date"
            value={disposalForm.disposalDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDisposalForm((prev) => ({ ...prev, disposalDate: e.target.value }))}
          />

          <Input
            label="Disposal Amount *"
            type="number"
            value={disposalForm.disposalAmount}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDisposalForm((prev) => ({ ...prev, disposalAmount: e.target.value }))}
            placeholder="Sale proceeds amount"
          />

          <div>
            <label className="form-label">Disposal Method *</label>
            <select
              className="block w-full h-9 px-3 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
              value={disposalForm.disposalMethod}
              onChange={(e) => setDisposalForm((prev) => ({ ...prev, disposalMethod: e.target.value }))}
            >
              <option value="Sale">Sale</option>
              <option value="Scrapped">Scrapped</option>
              <option value="Donated">Donated</option>
              <option value="Trade-in">Trade-in</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div>
            <label className="form-label">Notes</label>
            <textarea
              className="block w-full px-3 py-2 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
              rows={2}
              value={disposalForm.notes}
              onChange={(e) => setDisposalForm((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Optional notes..."
            />
          </div>

          {disposalForm.disposalAmount && (
            <div className="p-3 bg-neutral-50 rounded-lg text-sm">
              <p>
                <strong>Gain/Loss:</strong>{' '}
                {(() => {
                  const gl = parseFloat(disposalForm.disposalAmount) - asset.bookValue;
                  return (
                    <span className={gl >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {gl >= 0 ? 'Gain' : 'Loss'}: {formatIDR(Math.abs(gl))}
                    </span>
                  );
                })()}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-6">
            <Button type="button" variant="tertiary" text="Cancel" onClick={() => setShowDisposeModal(false)} />
            <Button
              type="button"
              variant="danger"
              text="Confirm Disposal"
              onClick={handleDispose}
              disabled={!disposalForm.disposalAmount || !disposalForm.disposalDate}
            />
          </div>
        </div>
      </Modal>
    </ListPage>
  );
};

export default AssetDetail;

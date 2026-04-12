import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, ArrowLeft } from 'lucide-react';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import Table, { TableColumn } from '../../components/UI/Table';
import ListPage from '../../components/Layout/ListPage';
import {
  useAsset,
  useAssetCategories,
  useCreateAsset,
  useUpdateAsset,
  type AssetCategory,
} from '../../hooks/useAssets';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { formatIDR } from '../../utils/formatters';

const METHOD_LABELS: Record<string, string> = {
  STRAIGHT_LINE: 'Straight Line',
  DECLINING_BALANCE: 'Declining Balance',
  DOUBLE_DECLINING: 'Double Declining',
};

interface FormData {
  name: string;
  description: string;
  categoryId: string;
  acquisitionDate: string;
  acquisitionCost: string;
  depreciationMethod: string;
  usefulLifeMonths: string;
  salvageValue: string;
  location: string;
  custodian: string;
  department: string;
  serialNumber: string;
  vendor: string;
}

const emptyForm: FormData = {
  name: '',
  description: '',
  categoryId: '',
  acquisitionDate: '',
  acquisitionCost: '',
  depreciationMethod: 'STRAIGHT_LINE',
  usefulLifeMonths: '60',
  salvageValue: '0',
  location: '',
  custodian: '',
  department: '',
  serialNumber: '',
  vendor: '',
};

const AssetForm = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const { canCreate, canEdit } = useModulePermissions('assets');

  const { data: categories = [] } = useAssetCategories();
  const { data: existingAsset } = useAsset(id);
  const createMutation = useCreateAsset();
  const updateMutation = useUpdateAsset();

  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (isEdit && existingAsset) {
      setFormData({
        name: existingAsset.name,
        description: existingAsset.description,
        categoryId: existingAsset.categoryId,
        acquisitionDate: existingAsset.acquisitionDate,
        acquisitionCost: String(existingAsset.acquisitionCost),
        depreciationMethod: existingAsset.depreciationMethod,
        usefulLifeMonths: String(existingAsset.usefulLifeMonths),
        salvageValue: String(existingAsset.salvageValue),
        location: existingAsset.location,
        custodian: existingAsset.custodian,
        department: existingAsset.department,
        serialNumber: existingAsset.serialNumber,
        vendor: existingAsset.vendor,
      });
    }
  }, [isEdit, existingAsset]);

  const handleCategoryChange = (categoryId: string) => {
    const cat = categories.find((c: AssetCategory) => c.id === categoryId);
    setFormData((prev) => ({
      ...prev,
      categoryId,
      ...(cat && !isEdit
        ? {
            depreciationMethod: cat.depreciationMethod,
            usefulLifeMonths: String(cat.usefulLifeMonths),
            salvageValue: String(
              Math.round(((parseFloat(prev.acquisitionCost) || 0) * cat.salvagePercent) / 100),
            ),
          }
        : {}),
    }));
  };

  const handleCostChange = (cost: string) => {
    const cat = categories.find((c: AssetCategory) => c.id === formData.categoryId);
    setFormData((prev) => ({
      ...prev,
      acquisitionCost: cost,
      ...(cat && !isEdit
        ? {
            salvageValue: String(
              Math.round(((parseFloat(cost) || 0) * cat.salvagePercent) / 100),
            ),
          }
        : {}),
    }));
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData.name.trim()) errs.name = 'Asset name is required.';
    if (!formData.categoryId) errs.categoryId = 'Category is required.';
    if (!formData.acquisitionDate) errs.acquisitionDate = 'Acquisition date is required.';
    if (!formData.acquisitionCost || parseFloat(formData.acquisitionCost) <= 0) errs.acquisitionCost = 'Cost must be greater than 0.';
    if (!formData.usefulLifeMonths || parseInt(formData.usefulLifeMonths) < 1) errs.usefulLifeMonths = 'Must be at least 1 month.';
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    const payload = {
      name: formData.name.trim(),
      description: formData.description.trim() || undefined,
      categoryId: formData.categoryId,
      acquisitionDate: formData.acquisitionDate,
      acquisitionCost: parseFloat(formData.acquisitionCost),
      depreciationMethod: formData.depreciationMethod,
      usefulLifeMonths: parseInt(formData.usefulLifeMonths),
      salvageValue: parseFloat(formData.salvageValue) || 0,
      location: formData.location.trim() || undefined,
      custodian: formData.custodian.trim() || undefined,
      department: formData.department.trim() || undefined,
      serialNumber: formData.serialNumber.trim() || undefined,
      vendor: formData.vendor.trim() || undefined,
    };

    try {
      if (isEdit && id) {
        await updateMutation.mutateAsync({ id, ...payload });
        navigate(`/assets/${id}`);
      } else {
        const result = await createMutation.mutateAsync(payload) as any;
        navigate(`/assets/${result.id}`);
      }
    } catch {
      // Error handled by React Query
    }
  };

  const depColumns: TableColumn<Record<string, unknown>>[] = [
    {
      key: 'period',
      label: 'Period',
      render: (_: unknown, row: Record<string, unknown>) => `${row.month}/${row.year}`,
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right' as const,
      render: (val: unknown) => formatIDR(Number(val)),
    },
    {
      key: 'accumulatedTotal',
      label: 'Accumulated',
      align: 'right' as const,
      render: (val: unknown) => formatIDR(Number(val)),
    },
    {
      key: 'bookValue',
      label: 'Book Value',
      align: 'right' as const,
      render: (val: unknown) => formatIDR(Number(val)),
    },
  ];

  return (
    <ListPage
      title={isEdit ? 'Edit Asset' : 'New Asset'}
      subtitle={isEdit ? `Editing ${existingAsset?.assetNo || ''}` : 'Register a new fixed asset.'}
      actions={
        <Button
          text="Back"
          variant="secondary"
          icon={<ArrowLeft size={16} />}
          onClick={() => navigate(isEdit && id ? `/assets/${id}` : '/assets')}
        />
      }
    >
      <form onSubmit={handleSubmit}>
        <Card>
          <h3 className="text-base font-semibold text-neutral-900 mb-4">Asset Information</h3>
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-8">
              <Input
                label="Asset Name *"
                value={formData.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setFormData((prev) => ({ ...prev, name: e.target.value }));
                  setErrors((prev) => ({ ...prev, name: null }));
                }}
                placeholder="e.g. MacBook Pro 16-inch"
                error={errors.name}
              />
            </div>
            <div className="col-span-4">
              <label className="form-label">Category *</label>
              <select
                className="block w-full h-9 px-3 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                value={formData.categoryId}
                onChange={(e) => handleCategoryChange(e.target.value)}
              >
                <option value="">Select category</option>
                {categories.map((c: AssetCategory) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {errors.categoryId && <p className="text-xs text-red-500 mt-1">{errors.categoryId}</p>}
            </div>

            <div className="col-span-12">
              <label className="form-label">Description</label>
              <textarea
                className="block w-full px-3 py-2 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                rows={2}
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Optional description..."
              />
            </div>

            <div className="col-span-4">
              <Input
                label="Acquisition Date *"
                type="date"
                value={formData.acquisitionDate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setFormData((prev) => ({ ...prev, acquisitionDate: e.target.value }));
                  setErrors((prev) => ({ ...prev, acquisitionDate: null }));
                }}
                error={errors.acquisitionDate}
              />
            </div>
            <div className="col-span-4">
              <Input
                label="Acquisition Cost *"
                type="number"
                value={formData.acquisitionCost}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  handleCostChange(e.target.value);
                  setErrors((prev) => ({ ...prev, acquisitionCost: null }));
                }}
                placeholder="0"
                error={errors.acquisitionCost}
              />
            </div>
            <div className="col-span-4">
              <Input
                label="Vendor / Supplier"
                value={formData.vendor}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData((prev) => ({ ...prev, vendor: e.target.value }))}
                placeholder="e.g. Apple Store"
              />
            </div>

            <div className="col-span-4">
              <Input
                label="Serial Number"
                value={formData.serialNumber}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData((prev) => ({ ...prev, serialNumber: e.target.value }))}
                placeholder="e.g. SN-12345"
              />
            </div>
            <div className="col-span-4">
              <Input
                label="Location"
                value={formData.location}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData((prev) => ({ ...prev, location: e.target.value }))}
                placeholder="e.g. Office A"
              />
            </div>
            <div className="col-span-4">
              <Input
                label="Custodian"
                value={formData.custodian}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData((prev) => ({ ...prev, custodian: e.target.value }))}
                placeholder="e.g. John Doe"
              />
            </div>
            <div className="col-span-4">
              <Input
                label="Department"
                value={formData.department}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData((prev) => ({ ...prev, department: e.target.value }))}
                placeholder="e.g. IT"
              />
            </div>
          </div>
        </Card>

        <Card className="mt-4">
          <h3 className="text-base font-semibold text-neutral-900 mb-4">Depreciation Settings</h3>
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-4">
              <label className="form-label">Depreciation Method</label>
              <select
                className="block w-full h-9 px-3 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                value={formData.depreciationMethod}
                onChange={(e) => setFormData((prev) => ({ ...prev, depreciationMethod: e.target.value }))}
              >
                <option value="STRAIGHT_LINE">Straight Line</option>
                <option value="DECLINING_BALANCE">Declining Balance</option>
                <option value="DOUBLE_DECLINING">Double Declining</option>
              </select>
            </div>
            <div className="col-span-4">
              <Input
                label="Useful Life (months)"
                type="number"
                value={formData.usefulLifeMonths}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setFormData((prev) => ({ ...prev, usefulLifeMonths: e.target.value }));
                  setErrors((prev) => ({ ...prev, usefulLifeMonths: null }));
                }}
                error={errors.usefulLifeMonths}
              />
            </div>
            <div className="col-span-4">
              <Input
                label="Salvage Value"
                type="number"
                value={formData.salvageValue}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData((prev) => ({ ...prev, salvageValue: e.target.value }))}
                placeholder="0"
              />
            </div>
          </div>

          <div className="mt-4 p-3 bg-neutral-50 rounded-lg text-sm text-neutral-700">
            <p><strong>Method:</strong> {METHOD_LABELS[formData.depreciationMethod]}</p>
            <p>
              <strong>Monthly depreciation (est.):</strong>{' '}
              {formData.acquisitionCost && formData.usefulLifeMonths
                ? formatIDR(
                    Math.round(
                      ((parseFloat(formData.acquisitionCost) || 0) - (parseFloat(formData.salvageValue) || 0)) /
                        (parseInt(formData.usefulLifeMonths) || 1),
                    ),
                  )
                : '-'}
            </p>
          </div>
        </Card>

        <div className="flex justify-end gap-3 mt-4">
          <Button
            type="button"
            variant="tertiary"
            text="Cancel"
            onClick={() => navigate(isEdit && id ? `/assets/${id}` : '/assets')}
          />
          <Button
            type="submit"
            variant="primary"
            text={isEdit ? 'Update Asset' : 'Save Asset'}
            icon={<Save size={16} />}
            disabled={isEdit ? !canEdit : !canCreate}
          />
        </div>
      </form>

      {/* Depreciation Schedule (edit mode only) */}
      {isEdit && existingAsset && existingAsset.depreciationEntries.length > 0 && (
        <Card className="mt-4" padding={false}>
          <div className="p-4 border-b border-neutral-200">
            <h3 className="text-base font-semibold text-neutral-900">Depreciation Schedule</h3>
          </div>
          <Table
            columns={depColumns}
            data={existingAsset.depreciationEntries as unknown as Record<string, unknown>[]}
            showCount
            countLabel="entries"
          />
        </Card>
      )}
    </ListPage>
  );
};

export default AssetForm;

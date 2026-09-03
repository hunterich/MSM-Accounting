import React, { useState, useMemo } from 'react';
import { Plus, Search, Edit2, Trash2, Save } from 'lucide-react';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import Modal from '../../components/UI/Modal';
import ListPage from '../../components/Layout/ListPage';
import {
  useAssetCategories,
  useCreateAssetCategory,
  useUpdateAssetCategory,
  useDeleteAssetCategory,
  type AssetCategory,
} from '../../hooks/useAssets';
import { useModulePermissions } from '../../hooks/useModulePermissions';

const METHOD_LABELS: Record<string, string> = {
  STRAIGHT_LINE: 'Straight Line',
  DECLINING_BALANCE: 'Declining Balance',
  DOUBLE_DECLINING: 'Double Declining',
};

interface CategoryForm {
  name: string;
  depreciationMethod: string;
  usefulLifeMonths: number;
  salvagePercent: number;
}

const emptyForm: CategoryForm = {
  name: '',
  depreciationMethod: 'STRAIGHT_LINE',
  usefulLifeMonths: 60,
  salvagePercent: 0,
};

const AssetCategories = () => {
  const { canCreate, canEdit, canDelete } = useModulePermissions('gl_journal');
  const { data: categories = [], isLoading } = useAssetCategories();
  const createMutation = useCreateAssetCategory();
  const updateMutation = useUpdateAssetCategory();
  const deleteMutation = useDeleteAssetCategory();

  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<AssetCategory | null>(null);
  const [formData, setFormData] = useState<CategoryForm>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const filtered = useMemo(
    () =>
      categories.filter(
        (c) =>
          c.name.toLowerCase().includes(searchTerm.toLowerCase()),
      ),
    [categories, searchTerm],
  );

  const handleOpenModal = (category: AssetCategory | null = null) => {
    setErrors({});
    if (category) {
      setEditing(category);
      setFormData({
        name: category.name,
        depreciationMethod: category.depreciationMethod,
        usefulLifeMonths: category.usefulLifeMonths,
        salvagePercent: category.salvagePercent,
      });
    } else {
      setEditing(null);
      setFormData(emptyForm);
    }
    setIsModalOpen(true);
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData.name.trim()) errs.name = 'Name is required.';
    if (formData.usefulLifeMonths < 1) errs.usefulLifeMonths = 'Must be at least 1 month.';
    if (formData.salvagePercent < 0 || formData.salvagePercent > 100) errs.salvagePercent = 'Must be 0-100%.';
    return errs;
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    const payload = {
      name: formData.name.trim(),
      depreciationMethod: formData.depreciationMethod,
      usefulLifeMonths: formData.usefulLifeMonths,
      salvagePercent: formData.salvagePercent,
    };

    if (editing) {
      updateMutation.mutate({ id: editing.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
    setIsModalOpen(false);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Delete this category? This cannot be undone.')) {
      deleteMutation.mutate(id);
    }
  };

  const columns: TableColumn<Record<string, unknown>>[] = [
    { key: 'name', label: 'Category Name', sortable: true },
    {
      key: 'depreciationMethod',
      label: 'Depreciation Method',
      render: (val: unknown) => METHOD_LABELS[val as string] || (val as string),
    },
    {
      key: 'usefulLifeMonths',
      label: 'Useful Life',
      align: 'right' as const,
      render: (val: unknown) => {
        const months = val as number;
        const years = Math.floor(months / 12);
        const rem = months % 12;
        return years > 0
          ? `${years} yr${years > 1 ? 's' : ''}${rem > 0 ? ` ${rem} mo` : ''}`
          : `${months} mo`;
      },
    },
    {
      key: 'salvagePercent',
      label: 'Salvage %',
      align: 'right' as const,
      render: (val: unknown) => `${Number(val)}%`,
    },
    {
      key: 'assetCount',
      label: 'Assets',
      align: 'right' as const,
    },
    {
      key: 'actions',
      label: '',
      align: 'right' as const,
      render: (_: unknown, row: Record<string, unknown>) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="small" icon={<Edit2 size={15} />} disabled={!canEdit} onClick={() => handleOpenModal(row as unknown as AssetCategory)} />
          <Button variant="ghost" size="small" icon={<Trash2 size={15} />} disabled={!canDelete} onClick={() => handleDelete(row.id as string)} />
        </div>
      ),
    },
  ];

  return (
    <ListPage
      title="Asset Categories"
      subtitle="Define depreciation defaults for asset groups."
      actions={
        <Button
          text="New Category"
          variant="primary"
          icon={<Plus size={16} />}
          disabled={!canCreate}
          onClick={() => handleOpenModal()}
        />
      }
    >
      <Card padding={false}>
        <div className="p-3 border-b border-neutral-200">
          <div className="relative w-72">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              className="w-full h-9 pl-9 pr-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
              placeholder="Search categories..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <Table
          columns={columns}
          data={filtered as unknown as Record<string, unknown>[]}
          showCount
          countLabel="categories"
          isLoading={isLoading}
          loadingLabel="Loading categories..."
        />
      </Card>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editing ? 'Edit Asset Category' : 'New Asset Category'} size="md">
        <form onSubmit={handleSave}>
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12">
              <Input
                label="Category Name *"
                value={formData.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setFormData((prev) => ({ ...prev, name: e.target.value }));
                  setErrors((prev) => ({ ...prev, name: null }));
                }}
                placeholder="e.g. Office Equipment"
                error={errors.name}
              />
            </div>

            <div className="col-span-12">
              <label className="form-label">Depreciation Method *</label>
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

            <div className="col-span-6">
              <Input
                label="Useful Life (months) *"
                type="number"
                value={String(formData.usefulLifeMonths)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setFormData((prev) => ({ ...prev, usefulLifeMonths: parseInt(e.target.value) || 0 }));
                  setErrors((prev) => ({ ...prev, usefulLifeMonths: null }));
                }}
                error={errors.usefulLifeMonths}
              />
              <p className="text-xs text-neutral-500 mt-1">
                = {Math.floor(formData.usefulLifeMonths / 12)} years {formData.usefulLifeMonths % 12 > 0 ? `${formData.usefulLifeMonths % 12} months` : ''}
              </p>
            </div>

            <div className="col-span-6">
              <Input
                label="Salvage Value %"
                type="number"
                value={String(formData.salvagePercent)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setFormData((prev) => ({ ...prev, salvagePercent: parseFloat(e.target.value) || 0 }));
                  setErrors((prev) => ({ ...prev, salvagePercent: null }));
                }}
                error={errors.salvagePercent}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <Button type="button" variant="tertiary" text="Cancel" onClick={() => setIsModalOpen(false)} />
            <Button
              type="submit"
              variant="primary"
              text={editing ? 'Update Category' : 'Save Category'}
              icon={<Save size={16} />}
              disabled={editing ? !canEdit : !canCreate}
            />
          </div>
        </form>
      </Modal>
    </ListPage>
  );
};

export default AssetCategories;

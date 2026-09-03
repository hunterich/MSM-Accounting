import React, { useMemo, useState } from 'react';
import { Edit2, Plus, Save, Search, Trash2, Download } from 'lucide-react';
import { exportToCsv } from '../../utils/exportCsv';
import Button from '../../components/UI/Button';
import Card from '../../components/UI/Card';
import Input from '../../components/UI/Input';
import Modal from '../../components/UI/Modal';
import StatusTag from '../../components/UI/StatusTag';
import Table, { TableColumn } from '../../components/UI/Table';
import ListPage from '../../components/Layout/ListPage';
import {
    useCreateVendorCategory,
    useDeleteVendorCategory,
    useUpdateVendorCategory,
    useVendorCategories,
} from '../../hooks/useAP';
import { useChartOfAccounts } from '../../hooks/useGL';
import { useModulePermissions } from '../../hooks/useModulePermissions';

interface VendorCategoryForm {
    name: string;
    code: string;
    defaultPaymentTerms: string;
    defaultApAccountId: string;
    description: string;
    isActive: boolean;
}

interface VendorCategory extends VendorCategoryForm {
    id: string;
    vendorCount?: number;
}

interface AccountOption {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    isPostable: boolean;
    type: string;
}

const emptyForm: VendorCategoryForm = {
    name: '',
    code: '',
    defaultPaymentTerms: 'Net 30',
    defaultApAccountId: '',
    description: '',
    isActive: true,
};

const VendorCategories = () => {
    const { canCreate, canEdit, canDelete } = useModulePermissions('ap_vendors');
    const { data: categories = [], isLoading } = useVendorCategories();
    const { data: chartOfAccounts = [] } = useChartOfAccounts();
    const createMutation = useCreateVendorCategory();
    const updateMutation = useUpdateVendorCategory();
    const deleteMutation = useDeleteVendorCategory();

    const [searchTerm, setSearchTerm] = useState<string>('');
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [editing, setEditing] = useState<VendorCategory | null>(null);
    const [formData, setFormData] = useState<VendorCategoryForm>(emptyForm);
    const [errors, setErrors] = useState<Record<string, string | null>>({});

    const apAccountOptions = useMemo(
        () => (chartOfAccounts as AccountOption[]).filter(
            (account) => account.isActive && account.isPostable && String(account.type).toLowerCase() === 'liability'
        ),
        [chartOfAccounts]
    );

    const filteredCategories = useMemo(
        () => (categories as VendorCategory[]).filter((category) =>
            category.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            category.code.toLowerCase().includes(searchTerm.toLowerCase())
        ),
        [categories, searchTerm]
    );

    const handleOpenModal = (category: VendorCategory | null = null) => {
        setErrors({});
        if (category) {
            setEditing(category);
            setFormData({
                name: category.name,
                code: category.code,
                defaultPaymentTerms: category.defaultPaymentTerms || 'Net 30',
                defaultApAccountId: category.defaultApAccountId || '',
                description: category.description || '',
                isActive: category.isActive,
            });
        } else {
            setEditing(null);
            setFormData({
                ...emptyForm,
                defaultApAccountId: apAccountOptions[0]?.id || '',
            });
        }
        setIsModalOpen(true);
    };

    const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const name = event.target.value;
        setFormData((prev) => ({
            ...prev,
            name,
            code: editing ? prev.code : name.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase(),
        }));
        setErrors((prev) => ({ ...prev, name: null }));
    };

    const handleCodeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const code = event.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
        setFormData((prev) => ({ ...prev, code }));
        setErrors((prev) => ({ ...prev, code: null }));
    };

    const validate = () => {
        const nextErrors: Record<string, string> = {};
        if (!formData.name.trim()) nextErrors.name = 'Category name is required.';
        if (!formData.code.trim()) nextErrors.code = 'Code is required.';
        return nextErrors;
    };

    const handleSave = (event: React.FormEvent) => {
        event.preventDefault();
        const nextErrors = validate();
        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
        }

        const payload = {
            name: formData.name.trim(),
            code: formData.code.trim().toUpperCase(),
            defaultPaymentTerms: formData.defaultPaymentTerms || undefined,
            defaultApAccountId: formData.defaultApAccountId || undefined,
            description: formData.description.trim() || undefined,
            isActive: formData.isActive,
        };

        if (editing) {
            updateMutation.mutate({ id: editing.id, ...payload });
        } else {
            createMutation.mutate(payload);
        }
        setIsModalOpen(false);
    };

    const handleDelete = (id: string) => {
        if (window.confirm('Delete this vendor category? Vendors assigned to it will become uncategorized.')) {
            deleteMutation.mutate(id);
        }
    };

    const columns = [
        {
            key: 'code',
            label: 'Code',
            sortable: true,
            render: (value: unknown) => <span className="font-mono font-semibold text-primary-700">{value as string}</span>,
        },
        { key: 'name', label: 'Category Name', sortable: true },
        { key: 'defaultPaymentTerms', label: 'Default Terms', render: (value: unknown) => (value as string) || '—' },
        {
            key: 'defaultApAccountId',
            label: 'Default A/P Account',
            render: (value: unknown) => {
                const account = apAccountOptions.find((item) => item.id === value);
                return account ? `${account.code} - ${account.name}` : '—';
            },
        },
        { key: 'vendorCount', label: 'Vendors', align: 'right' as const },
        { key: 'isActive', label: 'Status', render: (value: unknown) => <StatusTag status={(value as boolean) ? 'Active' : 'Inactive'} /> },
        {
            key: 'actions',
            label: '',
            align: 'right' as const,
            render: (_: unknown, row: Record<string, unknown>) => (
                <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="small" icon={<Edit2 size={15} />} disabled={!canEdit} onClick={() => handleOpenModal(row as unknown as VendorCategory)} />
                    <Button variant="ghost" size="small" icon={<Trash2 size={15} />} disabled={!canDelete} onClick={() => handleDelete(row['id'] as string)} />
                </div>
            ),
        },
    ];

    return (
        <ListPage
            containerClassName="ap-module"
            title="Vendor Categories"
            subtitle="Manage supplier groups and default A/P settings."
            actions={
                <div className="flex items-center gap-2">
                    <button
                        className="btn btn-secondary flex items-center gap-1"
                        title="Export CSV"
                        onClick={() => {
                            const rows = filteredCategories.map((cat) => ({
                                name: cat.name,
                                code: cat.code,
                                defaultPaymentTerms: cat.defaultPaymentTerms || '',
                                isActive: cat.isActive ? 'Yes' : 'No',
                            }));
                            exportToCsv('vendor-categories.csv', rows, [
                                { label: 'Name', key: 'name' },
                                { label: 'Code', key: 'code' },
                                { label: 'Payment Terms', key: 'defaultPaymentTerms' },
                                { label: 'Is Active', key: 'isActive' },
                            ]);
                        }}
                    >
                        <Download size={16} />
                        <span className="hidden sm:inline">Export</span>
                    </button>
                    <Button
                        text="New Category"
                        variant="primary"
                        icon={<Plus size={16} />}
                        disabled={!canCreate}
                        onClick={() => handleOpenModal()}
                    />
                </div>
            }
        >
            <Card padding={false}>
                <div className="p-3 border-b border-neutral-200">
                    <div className="relative w-72">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                            type="text"
                            className="w-full h-9 pl-9 pr-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                            placeholder="Search by name or code..."
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                        />
                    </div>
                </div>
                <Table
                    columns={columns as TableColumn<Record<string, unknown>>[]}
                    data={filteredCategories as unknown as Record<string, unknown>[]}
                    showCount
                    countLabel="categories"
                    isLoading={isLoading}
                    loadingLabel="Loading vendor categories..."
                />
            </Card>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editing ? 'Edit Vendor Category' : 'New Vendor Category'}
                size="md"
            >
                <form onSubmit={handleSave}>
                    <div className="grid grid-cols-12 gap-4">
                        <div className="col-span-8">
                            <Input
                                label="Category Name *"
                                value={formData.name}
                                onChange={handleNameChange}
                                placeholder="e.g. Packaging Suppliers"
                                error={errors.name}
                            />
                        </div>
                        <div className="col-span-4">
                            <Input
                                label="Code *"
                                value={formData.code}
                                onChange={handleCodeChange}
                                placeholder="e.g. PACK"
                                error={errors.code}
                            />
                        </div>

                        <div className="col-span-6">
                            <label className="form-label">Default Payment Terms</label>
                            <select
                                className="block w-full px-3 py-2 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                                value={formData.defaultPaymentTerms}
                                onChange={(event) => setFormData((prev) => ({ ...prev, defaultPaymentTerms: event.target.value }))}
                            >
                                <option value="Due on Receipt">Due on Receipt</option>
                                <option value="Net 15">Net 15</option>
                                <option value="Net 30">Net 30</option>
                                <option value="Net 45">Net 45</option>
                            </select>
                        </div>

                        <div className="col-span-6">
                            <label className="form-label">Default A/P Control Account</label>
                            <select
                                className="block w-full px-3 py-2 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                                value={formData.defaultApAccountId}
                                onChange={(event) => setFormData((prev) => ({ ...prev, defaultApAccountId: event.target.value }))}
                            >
                                <option value="">No default account</option>
                                {apAccountOptions.map((account) => (
                                    <option key={account.id} value={account.id}>
                                        {account.code} - {account.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="col-span-12">
                            <label className="form-label">Description</label>
                            <textarea
                                className="block w-full px-3 py-2 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                                rows={2}
                                value={formData.description}
                                onChange={(event) => setFormData((prev) => ({ ...prev, description: event.target.value }))}
                                placeholder="Optional description..."
                            />
                        </div>

                        <div className="col-span-12 flex items-center gap-2">
                            <input
                                id="vendor-category-active"
                                type="checkbox"
                                checked={formData.isActive}
                                onChange={(event) => setFormData((prev) => ({ ...prev, isActive: event.target.checked }))}
                                className="w-4 h-4 rounded border-neutral-300 text-primary-600"
                            />
                            <label htmlFor="vendor-category-active" className="text-sm text-neutral-700 cursor-pointer">Active</label>
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

export default VendorCategories;

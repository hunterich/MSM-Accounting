import React, { useState, useMemo } from 'react';
import { Plus, Search, Edit2, Trash2, Save } from 'lucide-react';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import Modal from '../../components/UI/Modal';
import { useCustomerCategories, useCreateCustomerCategory, useUpdateCustomerCategory, useDeleteCustomerCategory } from '../../hooks/useReturns';
import { formatIDR } from '../../utils/formatters';
import { useModulePermissions } from '../../hooks/useModulePermissions';

interface CategoryFormData {
    name: string;
    prefix: string;
    defaultCreditLimit: number;
    defaultPaymentTerms: number;
    defaultDiscount: number;
    description: string;
}

interface Category extends CategoryFormData {
    id: string;
}

const CustomerCategories = () => {
    const { canCreate, canEdit, canDelete } = useModulePermissions('ar_customers');
    const { data: categories = [], isLoading } = useCustomerCategories();
    const createCategoryMutation = useCreateCustomerCategory();
    const updateCategoryMutation = useUpdateCustomerCategory();
    const deleteCategoryMutation = useDeleteCustomerCategory();
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [editingCategory, setEditingCategory] = useState<Category | null>(null);
    const [formData, setFormData] = useState<CategoryFormData>({
        name: '',
        prefix: '',
        defaultCreditLimit: 0,
        defaultPaymentTerms: 0,
        defaultDiscount: 0,
        description: ''
    });

    const filteredCategories = useMemo(() => {
        return (categories as Category[]).filter(cat =>
            cat.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            cat.prefix.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [categories, searchTerm]);

    const handleOpenModal = (category: Category | null = null) => {
        if (category) {
            setEditingCategory(category);
            setFormData({
                name: category.name,
                prefix: category.prefix,
                defaultCreditLimit: category.defaultCreditLimit,
                defaultPaymentTerms: category.defaultPaymentTerms,
                defaultDiscount: category.defaultDiscount,
                description: category.description || ''
            });
        } else {
            setEditingCategory(null);
            setFormData({
                name: '',
                prefix: '',
                defaultCreditLimit: 0,
                defaultPaymentTerms: 0,
                defaultDiscount: 0,
                description: ''
            });
        }
        setIsModalOpen(true);
    };

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        if (editingCategory) {
            updateCategoryMutation.mutate({ id: editingCategory.id, ...formData });
        } else {
            createCategoryMutation.mutate(formData);
        }
        setIsModalOpen(false);
    };

    const handleDelete = (id: string) => {
        if (window.confirm('Are you sure you want to delete this category?')) {
            deleteCategoryMutation.mutate(id);
        }
    };

    const columns = [
        { key: 'name', label: 'Category Name', sortable: true },
        { key: 'prefix', label: 'ID Prefix', sortable: true },
        {
            key: 'defaultCreditLimit',
            label: 'Default Credit Limit',
            align: 'right' as const,
            render: (val: unknown) => formatIDR(val as number)
        },
        {
            key: 'defaultPaymentTerms',
            label: 'Default Terms',
            render: (val: unknown) => (val as number) === 0 ? 'Due on Receipt' : `Net ${val}`
        },
        {
            key: 'defaultDiscount',
            label: 'Default Discount',
            align: 'right' as const,
            render: (val: unknown) => `${val}%`
        },
        {
            key: 'actions',
            label: '',
            align: 'right' as const,
            render: (_: unknown, row: Record<string, unknown>) => (
                <div className="flex justify-end gap-2">
                    <Button
                        variant="ghost"
                        size="small"
                        icon={<Edit2 size={16} />}
                        disabled={!canEdit}
                        onClick={() => handleOpenModal(row as unknown as Category)}
                    />
                    <Button
                        variant="ghost"
                        size="small"
                        className="text-red-500"
                        icon={<Trash2 size={16} />}
                        disabled={!canDelete}
                        onClick={() => handleDelete(row['id'] as string)}
                    />
                </div>
            )
        }
    ];

    return (
        <div className="container container-full-width">
            <div className="page-header">
                <div className="page-title">
                    <h1>Customer Categories</h1>
                    <p className="text-muted">Manage customer classifications and default settings</p>
                </div>
                <div className="page-actions">
                    <Button
                        variant="primary"
                        icon={<Plus size={16} />}
                        text="New Category"
                        disabled={!canCreate}
                        onClick={() => handleOpenModal()}
                    />
                </div>
            </div>

            <Card padding={false}>
                <div className="p-4 border-b">
                    <div className="w-1/3 relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                        <input
                            className="block w-full pl-9 px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                            placeholder="Search categories..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
                <Table
                    columns={columns as TableColumn<Record<string, unknown>>[]}
                    data={filteredCategories as unknown as Record<string, unknown>[]}
                />
            </Card>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingCategory ? 'Edit Category' : 'New Customer Category'}
                size="md"
            >
                <form onSubmit={handleSave}>
                    <div className="grid grid-cols-12 gap-4">
                        <div className="col-span-8">
                            <Input
                                label="Category Name *"
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                required
                                placeholder="e.g. Wholesale"
                            />
                        </div>
                        <div className="col-span-4">
                            <Input
                                label="ID Prefix *"
                                value={formData.prefix}
                                onChange={e => setFormData({ ...formData, prefix: e.target.value.toUpperCase() })}
                                required
                                placeholder="e.g. WH"
                            />
                        </div>

                        <div className="col-span-12">
                            <hr className="form-divider" />
                            <h4 className="form-section-title">Default Settings</h4>
                        </div>

                        <div className="col-span-6">
                            <Input
                                label="Credit Limit"
                                type="number"
                                value={formData.defaultCreditLimit}
                                onChange={e => setFormData({ ...formData, defaultCreditLimit: Number(e.target.value) })}
                                placeholder="0"
                            />
                        </div>
                        <div className="col-span-3">
                            <Input
                                label="Payment Terms (Days)"
                                type="number"
                                value={formData.defaultPaymentTerms}
                                onChange={e => setFormData({ ...formData, defaultPaymentTerms: Number(e.target.value) })}
                                placeholder="0"
                            />
                        </div>
                        <div className="col-span-3">
                            <label className="block mb-2 text-sm font-medium text-neutral-700">Discount (%)</label>
                            <input
                                className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                type="number"
                                step="0.1"
                                value={formData.defaultDiscount}
                                onChange={e => setFormData({ ...formData, defaultDiscount: Number(e.target.value) })}
                                placeholder="0"
                            />
                        </div>

                        <div className="col-span-12">
                            <label className="block mb-2 text-sm font-medium text-neutral-700">Description</label>
                            <textarea
                                className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 bg-clip-padding border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] py-2"
                                rows={2}
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                placeholder="Optional description..."
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-6">
                        <Button
                            type="button"
                            variant="tertiary"
                            text="Cancel"
                            onClick={() => setIsModalOpen(false)}
                        />
                        <Button
                            type="submit"
                            variant="primary"
                            text="Save Category"
                            icon={<Save size={16} />}
                            disabled={editingCategory ? !canEdit : !canCreate}
                        />
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default CustomerCategories;

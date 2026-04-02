import React, { useState, useMemo } from 'react';
import { Plus, Search, Edit2, Trash2, Save } from 'lucide-react';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import Modal from '../../components/UI/Modal';
import ListPage from '../../components/Layout/ListPage';
import StatusTag from '../../components/UI/StatusTag';
import { useItemCategories, useCreateItemCategory, useUpdateItemCategory, useDeleteItemCategory } from '../../hooks/useInventory';
import { useModulePermissions } from '../../hooks/useModulePermissions';

const emptyForm = { name: '', code: '', description: '', isActive: true };

const ItemCategories = () => {
    const { canCreate, canEdit, canDelete } = useModulePermissions('inv_categories');
    const { data: categories = [], isLoading } = useItemCategories();
    const createMutation = useCreateItemCategory();
    const updateMutation = useUpdateItemCategory();
    const deleteMutation = useDeleteItemCategory();

    const [searchTerm, setSearchTerm]       = useState('');
    const [isModalOpen, setIsModalOpen]     = useState(false);
    const [editing, setEditing]             = useState(null);
    const [formData, setFormData]           = useState(emptyForm);
    const [errors, setErrors]               = useState({});

    const filtered = useMemo(() =>
        categories.filter((c) =>
            c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.code.toLowerCase().includes(searchTerm.toLowerCase())
        ),
        [categories, searchTerm]
    );

    const handleOpenModal = (category = null) => {
        setErrors({});
        if (category) {
            setEditing(category);
            setFormData({ name: category.name, code: category.code, description: category.description, isActive: category.isActive });
        } else {
            setEditing(null);
            setFormData(emptyForm);
        }
        setIsModalOpen(true);
    };

    const handleNameChange = (e) => {
        const name = e.target.value;
        // Auto-derive code from first 3 letters if code not manually set
        setFormData((prev) => ({
            ...prev,
            name,
            code: prev.code && editing ? prev.code : name.replace(/\s+/g, '').slice(0, 3).toUpperCase(),
        }));
        setErrors((prev) => ({ ...prev, name: null }));
    };

    const handleCodeChange = (e) => {
        const code = e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
        setFormData((prev) => ({ ...prev, code }));
        setErrors((prev) => ({ ...prev, code: null }));
    };

    const validate = () => {
        const errs = {};
        if (!formData.name.trim()) errs.name = 'Name is required.';
        if (!formData.code.trim()) errs.code = 'Code is required.';
        return errs;
    };

    const handleSave = (e) => {
        e.preventDefault();
        const errs = validate();
        if (Object.keys(errs).length > 0) { setErrors(errs); return; }

        const payload = {
            name:        formData.name.trim(),
            code:        formData.code.trim().toUpperCase(),
            description: formData.description.trim() || null,
            isActive:    formData.isActive,
        };

        if (editing) {
            updateMutation.mutate({ id: editing.id, ...payload });
        } else {
            createMutation.mutate(payload);
        }
        setIsModalOpen(false);
    };

    const handleDelete = (id) => {
        if (window.confirm('Delete this category? Items assigned to it will become uncategorised.')) {
            deleteMutation.mutate(id);
        }
    };

    const columns = [
        { key: 'code',        label: 'Code',        sortable: true, render: (val) => <span className="font-mono font-semibold text-primary-700">{val}</span> },
        { key: 'name',        label: 'Category Name', sortable: true },
        { key: 'description', label: 'Description',   render: (val) => val || '—' },
        { key: 'skuSequence', label: 'SKUs Issued', align: 'right', render: (val) => val ?? 0 },
        { key: 'isActive',    label: 'Status',      render: (val) => <StatusTag status={val ? 'Active' : 'Inactive'} /> },
        {
            key: 'actions',
            label: '',
            align: 'right',
            render: (_, row) => (
                <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="small" icon={<Edit2 size={15} />} disabled={!canEdit}   onClick={() => handleOpenModal(row)} />
                    <Button variant="ghost" size="small" icon={<Trash2 size={15} />} disabled={!canDelete} onClick={() => handleDelete(row.id)} />
                </div>
            ),
        },
    ];

    return (
        <ListPage
            containerClassName="inventory-module"
            title="Item Categories"
            subtitle="Manage inventory categories and SKU prefixes."
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
                            placeholder="Search by name or code..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
                <Table
                    columns={columns}
                    data={filtered}
                    showCount
                    countLabel="categories"
                    isLoading={isLoading}
                    loadingLabel="Loading categories..."
                />
            </Card>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editing ? 'Edit Item Category' : 'New Item Category'}
                size="md"
            >
                <form onSubmit={handleSave}>
                    <div className="grid grid-cols-12 gap-4">
                        <div className="col-span-8">
                            <Input
                                label="Category Name *"
                                value={formData.name}
                                onChange={handleNameChange}
                                placeholder="e.g. Electronics"
                                error={errors.name}
                            />
                        </div>
                        <div className="col-span-4">
                            <Input
                                label="SKU Code *"
                                value={formData.code}
                                onChange={handleCodeChange}
                                placeholder="e.g. ELE"
                                error={errors.code}
                            />
                            <p className="text-xs text-neutral-500 mt-1">Used as prefix: ELE-0001</p>
                        </div>

                        <div className="col-span-12">
                            <label className="form-label">Description</label>
                            <textarea
                                className="block w-full px-3 py-2 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                                rows="2"
                                value={formData.description}
                                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                                placeholder="Optional description..."
                            />
                        </div>

                        <div className="col-span-12 flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="cat-active"
                                checked={formData.isActive}
                                onChange={(e) => setFormData((prev) => ({ ...prev, isActive: e.target.checked }))}
                                className="w-4 h-4 rounded border-neutral-300 text-primary-600"
                            />
                            <label htmlFor="cat-active" className="text-sm text-neutral-700 cursor-pointer">Active</label>
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

export default ItemCategories;

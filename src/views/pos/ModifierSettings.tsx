import React, { useState, useMemo } from 'react';
import { Plus, Edit2, Trash2, Save, Link2, X } from 'lucide-react';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import Modal from '../../components/UI/Modal';
import ListPage from '../../components/Layout/ListPage';
import StatusTag from '../../components/UI/StatusTag';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { useItemSkuIndex, useItemCategories } from '../../hooks/useInventory';
import { useToastStore } from '../../stores/useToastStore';
import {
    useModifierGroups,
    useCreateModifierGroup,
    useUpdateModifierGroup,
    useDeleteModifierGroup,
    useModifierAttachments,
    useCreateModifierAttachment,
    useDeleteModifierAttachment,
    type ModifierGroup,
    type SelectionType,
} from '../../hooks/useModifiers';
import ModifierOptionsEditor, { newOptionRow, type OptionRow } from './ModifierOptionsEditor';

interface GroupForm {
    name: string;
    selectionType: SelectionType;
    isRequired: boolean;
    sortOrder: number;
    isActive: boolean;
    options: OptionRow[];
}

const emptyForm = (): GroupForm => ({
    name: '',
    selectionType: 'SINGLE',
    isRequired: false,
    sortOrder: 0,
    isActive: true,
    options: [newOptionRow()],
});

const ModifierSettings = (): React.ReactElement => {
    const { canCreate, canEdit, canDelete } = useModulePermissions('pos_retail');
    const pushToast = useToastStore((s) => s.pushToast);

    const { data: groups = [], isLoading } = useModifierGroups();
    const createGroup = useCreateModifierGroup();
    const updateGroup = useUpdateModifierGroup();
    const deleteGroup = useDeleteModifierGroup();

    const { data: skuIndex } = useItemSkuIndex();
    const { data: categories = [] } = useItemCategories();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editing, setEditing]         = useState<ModifierGroup | null>(null);
    const [formData, setFormData]       = useState<GroupForm>(emptyForm);
    const [errors, setErrors]           = useState<Record<string, string | null>>({});
    const [selectedGroup, setSelectedGroup] = useState<ModifierGroup | null>(null);

    // Item picker options — all items (active + inactive), unpaginated.
    const itemOptions = useMemo(
        () => (skuIndex?.data ?? [])
            .filter((it) => it.isActive)
            .map((it) => ({ value: it.id, label: it.sku ? `${it.name} (${it.sku})` : it.name })),
        [skuIndex],
    );

    const handleOpenModal = (group: ModifierGroup | null = null) => {
        setErrors({});
        if (group) {
            setEditing(group);
            setFormData({
                name: group.name,
                selectionType: group.selectionType,
                isRequired: group.isRequired,
                sortOrder: group.sortOrder,
                isActive: group.isActive,
                options: group.options.length
                    ? group.options.map((o, i) => ({
                        key: `existing-${o.id ?? i}`,
                        id: o.id,
                        name: o.name,
                        priceDelta: String(o.priceDelta),
                        itemId: o.itemId ?? '',
                        sortOrder: o.sortOrder ?? i,
                        isActive: o.isActive,
                    }))
                    : [newOptionRow()],
            });
        } else {
            setEditing(null);
            setFormData(emptyForm());
        }
        setIsModalOpen(true);
    };

    const validate = (): Record<string, string> => {
        const errs: Record<string, string> = {};
        if (!formData.name.trim()) errs.name = 'Name is required.';
        const named = formData.options.filter((o) => o.name.trim());
        if (named.length === 0) errs.options = 'Add at least one option.';
        return errs;
    };

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        const errs = validate();
        if (Object.keys(errs).length > 0) { setErrors(errs); return; }

        const payload = {
            name: formData.name.trim(),
            selectionType: formData.selectionType,
            isRequired: formData.isRequired,
            sortOrder: Number(formData.sortOrder) || 0,
            isActive: formData.isActive,
            options: formData.options
                .filter((o) => o.name.trim())
                .map((o, i) => ({
                    name: o.name.trim(),
                    priceDelta: Number(o.priceDelta) || 0,
                    itemId: o.itemId || null,
                    sortOrder: Number(o.sortOrder) || i,
                    isActive: o.isActive,
                })),
        };

        if (editing) {
            updateGroup.mutate({ id: editing.id, ...payload }, {
                onSuccess: () => { pushToast('Modifier group updated.'); setIsModalOpen(false); },
                onError: (err: Error) => pushToast(err.message, 'error'),
            });
        } else {
            createGroup.mutate(payload, {
                onSuccess: () => { pushToast('Modifier group created.'); setIsModalOpen(false); },
                onError: (err: Error) => pushToast(err.message, 'error'),
            });
        }
    };

    const handleDelete = (group: ModifierGroup) => {
        const warn = group.attachmentCount > 0
            ? `Delete "${group.name}"? It is attached to ${group.attachmentCount} item(s)/category(ies); those attachments will be removed.`
            : `Delete "${group.name}"?`;
        if (!window.confirm(warn)) return;
        deleteGroup.mutate(group.id, {
            onSuccess: () => {
                pushToast('Modifier group deleted.');
                if (selectedGroup?.id === group.id) setSelectedGroup(null);
            },
            onError: (err: Error) => pushToast(err.message, 'error'),
        });
    };

    const columns = [
        { key: 'name', label: 'Group Name', sortable: true, render: (val: unknown) => <span className="font-medium">{val as string}</span> },
        {
            key: 'selectionType', label: 'Selection',
            render: (val: unknown) => (
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-neutral-100 text-neutral-700">
                    {val === 'MULTI' ? 'Multiple choice' : 'Single choice'}
                </span>
            ),
        },
        {
            key: 'isRequired', label: 'Required',
            render: (val: unknown) => (val as boolean)
                ? <span className="text-xs font-medium px-2 py-0.5 rounded bg-warning-100 text-warning-700">Required</span>
                : <span className="text-xs text-neutral-400">Optional</span>,
        },
        { key: 'options', label: 'Options', align: 'right' as const, render: (val: unknown) => (val as unknown[])?.length ?? 0 },
        { key: 'attachmentCount', label: 'Attached to', align: 'right' as const, render: (val: unknown) => (val as number) ?? 0 },
        { key: 'isActive', label: 'Status', render: (val: unknown) => <StatusTag status={(val as boolean) ? 'Active' : 'Inactive'} /> },
        {
            key: 'actions', label: '', align: 'right' as const,
            render: (_: unknown, row: Record<string, unknown>) => {
                const group = row as unknown as ModifierGroup;
                return (
                    <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="small" icon={<Link2 size={15} />} text="Attachments"
                            onClick={() => setSelectedGroup(group)} />
                        <Button variant="ghost" size="small" icon={<Edit2 size={15} />} disabled={!canEdit}
                            onClick={() => handleOpenModal(group)} />
                        <Button variant="ghost" size="small" icon={<Trash2 size={15} />} disabled={!canDelete}
                            onClick={() => handleDelete(group)} />
                    </div>
                );
            },
        },
    ];

    return (
        <ListPage
            containerClassName="pos-module"
            title="POS Modifiers"
            subtitle="Manage option groups (e.g. size, add-ons) and attach them to items or categories."
            actions={
                <Button
                    text="New Modifier Group"
                    variant="primary"
                    icon={<Plus size={16} />}
                    disabled={!canCreate}
                    onClick={() => handleOpenModal()}
                />
            }
        >
            <Card padding={false}>
                <Table
                    columns={columns as TableColumn<Record<string, unknown>>[]}
                    data={groups as unknown as Record<string, unknown>[]}
                    showCount
                    countLabel="groups"
                    isLoading={isLoading}
                    loadingLabel="Loading modifier groups..."
                />
            </Card>

            {selectedGroup && (
                <AttachmentsPanel
                    group={selectedGroup}
                    onClose={() => setSelectedGroup(null)}
                    itemOptions={itemOptions}
                    categoryOptions={categories.map((c) => ({ value: c.id, label: c.name, subLabel: c.code }))}
                    canEdit={canEdit}
                    canDelete={canDelete}
                />
            )}

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editing ? 'Edit Modifier Group' : 'New Modifier Group'}
                size="lg"
            >
                <form onSubmit={handleSave}>
                    <div className="grid grid-cols-12 gap-4">
                        <div className="col-span-12 md:col-span-8">
                            <Input
                                label="Group Name *"
                                value={formData.name}
                                onChange={(e) => { setFormData((p) => ({ ...p, name: e.target.value })); setErrors((p) => ({ ...p, name: null })); }}
                                placeholder="e.g. Size, Add-ons, Sugar level"
                                error={errors.name}
                            />
                        </div>
                        <div className="col-span-6 md:col-span-4">
                            <label className="form-label">Sort order</label>
                            <input
                                type="number"
                                className="block w-full px-3 py-2 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                                value={formData.sortOrder}
                                onChange={(e) => setFormData((p) => ({ ...p, sortOrder: Number(e.target.value) || 0 }))}
                            />
                        </div>

                        <div className="col-span-12">
                            <label className="form-label">Selection type</label>
                            <div className="flex gap-2">
                                {(['SINGLE', 'MULTI'] as SelectionType[]).map((t) => (
                                    <button
                                        key={t}
                                        type="button"
                                        onClick={() => setFormData((p) => ({ ...p, selectionType: t }))}
                                        className={`flex-1 h-10 rounded-md border text-sm font-medium transition-colors ${
                                            formData.selectionType === t
                                                ? 'border-primary-500 bg-primary-50 text-primary-700'
                                                : 'border-neutral-300 bg-neutral-0 text-neutral-600 hover:border-neutral-400'
                                        }`}
                                    >
                                        {t === 'SINGLE' ? 'Single choice' : 'Multiple choice'}
                                    </button>
                                ))}
                            </div>
                            <p className="text-xs text-neutral-500 mt-1">
                                {formData.selectionType === 'SINGLE'
                                    ? 'Customer picks exactly one option.'
                                    : 'Customer can pick several options.'}
                            </p>
                        </div>

                        <div className="col-span-12 flex items-center gap-6">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.isRequired}
                                    onChange={(e) => setFormData((p) => ({ ...p, isRequired: e.target.checked }))}
                                    className="w-4 h-4 rounded border-neutral-300 text-primary-600"
                                />
                                <span className="text-sm text-neutral-700">Required (customer must choose)</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.isActive}
                                    onChange={(e) => setFormData((p) => ({ ...p, isActive: e.target.checked }))}
                                    className="w-4 h-4 rounded border-neutral-300 text-primary-600"
                                />
                                <span className="text-sm text-neutral-700">Active</span>
                            </label>
                        </div>

                        <ModifierOptionsEditor
                            options={formData.options}
                            onChange={(rows) => { setFormData((p) => ({ ...p, options: rows })); setErrors((p) => ({ ...p, options: null })); }}
                            itemOptions={itemOptions}
                        />
                        {errors.options && <p className="col-span-12 text-sm text-danger-600 -mt-2">{errors.options}</p>}
                    </div>

                    <div className="flex justify-end gap-3 mt-6">
                        <Button type="button" variant="tertiary" text="Cancel" onClick={() => setIsModalOpen(false)} />
                        <Button
                            type="submit"
                            variant="primary"
                            text={editing ? 'Update Group' : 'Save Group'}
                            icon={<Save size={16} />}
                            disabled={(editing ? !canEdit : !canCreate) || createGroup.isPending || updateGroup.isPending}
                        />
                    </div>
                </form>
            </Modal>
        </ListPage>
    );
};

// ── Attachments panel ────────────────────────────────────────────────────────────

interface AttachOption { value: string; label: string; subLabel?: string | number }

interface AttachmentsPanelProps {
    group: ModifierGroup;
    onClose: () => void;
    itemOptions: AttachOption[];
    categoryOptions: AttachOption[];
    canEdit: boolean;
    canDelete: boolean;
}

const AttachmentsPanel = ({ group, onClose, itemOptions, categoryOptions, canEdit, canDelete }: AttachmentsPanelProps): React.ReactElement => {
    const pushToast = useToastStore((s) => s.pushToast);
    const { data: attachments = [], isLoading } = useModifierAttachments(group.id);
    const createAttachment = useCreateModifierAttachment();
    const deleteAttachment = useDeleteModifierAttachment();

    const [mode, setMode] = useState<'item' | 'category'>('item');
    const [targetId, setTargetId] = useState('');

    const handleAttach = () => {
        if (!targetId) { pushToast('Choose an item or category first.', 'error'); return; }
        // Exactly-one target: send only the field for the active mode.
        const body = mode === 'item'
            ? { groupId: group.id, itemId: targetId }
            : { groupId: group.id, itemCategoryId: targetId };
        createAttachment.mutate(body, {
            onSuccess: () => { pushToast('Attached.'); setTargetId(''); },
            onError: (err: Error) => pushToast(err.message, 'error'),
        });
    };

    const handleRemove = (id: string) => {
        deleteAttachment.mutate(id, {
            onSuccess: () => pushToast('Attachment removed.'),
            onError: (err: Error) => pushToast(err.message, 'error'),
        });
    };

    const options = mode === 'item' ? itemOptions : categoryOptions;

    return (
        <Card className="mt-4">
            <div className="flex items-start justify-between mb-4">
                <div>
                    <h3 className="text-base font-semibold text-neutral-900">Attachments — {group.name}</h3>
                    <p className="text-sm text-neutral-500">Attach this group to individual items or to a whole item category.</p>
                </div>
                <button type="button" onClick={onClose} className="p-1 text-neutral-400 hover:text-neutral-700" aria-label="Close">
                    <X size={18} />
                </button>
            </div>

            {/* Existing attachments */}
            {isLoading ? (
                <p className="text-sm text-neutral-500">Loading attachments...</p>
            ) : attachments.length === 0 ? (
                <p className="text-sm text-neutral-500 border border-dashed border-neutral-300 rounded-md p-3 text-center mb-4">
                    Not attached to anything yet.
                </p>
            ) : (
                <div className="flex flex-wrap gap-2 mb-4">
                    {attachments.map((a) => (
                        <span key={a.id} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-neutral-100 text-sm text-neutral-700">
                            <span className="text-xs font-medium text-neutral-500">
                                {a.itemCategoryId ? 'Category' : 'Item'}:
                            </span>
                            {a.item?.name ?? a.itemCategory?.name ?? '—'}
                            {canDelete && (
                                <button type="button" onClick={() => handleRemove(a.id)} className="text-neutral-400 hover:text-danger-600" aria-label="Remove attachment">
                                    <X size={14} />
                                </button>
                            )}
                        </span>
                    ))}
                </div>
            )}

            {/* Attach form — exactly one target: mode toggle picks item OR category */}
            {canEdit && (
                <div className="border-t border-neutral-200 pt-4">
                    <div className="flex gap-2 mb-3">
                        {(['item', 'category'] as const).map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => { setMode(m); setTargetId(''); }}
                                className={`px-3 h-9 rounded-md border text-sm font-medium transition-colors ${
                                    mode === m
                                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                                        : 'border-neutral-300 bg-neutral-0 text-neutral-600 hover:border-neutral-400'
                                }`}
                            >
                                {m === 'item' ? 'Attach to Item' : 'Attach to Category'}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-start gap-2">
                        <div className="flex-1">
                            <SearchableSelect
                                options={options}
                                value={targetId}
                                onChange={setTargetId}
                                placeholder={mode === 'item' ? 'Select an item...' : 'Select a category...'}
                            />
                        </div>
                        <Button
                            variant="primary"
                            text="Attach"
                            icon={<Link2 size={15} />}
                            onClick={handleAttach}
                            disabled={!targetId || createAttachment.isPending}
                        />
                    </div>
                </div>
            )}
        </Card>
    );
};

export default ModifierSettings;

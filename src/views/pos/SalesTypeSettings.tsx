import React, { useState, useMemo } from 'react';
import { Plus, Edit2, Trash2, Save } from 'lucide-react';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import Modal from '../../components/UI/Modal';
import ListPage from '../../components/Layout/ListPage';
import StatusTag from '../../components/UI/StatusTag';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { useAccountsByType } from '../../hooks/useGL';
import { useToastStore } from '../../stores/useToastStore';
import {
    useSalesTypes,
    useCreateSalesType,
    useUpdateSalesType,
    useDeleteSalesType,
    type SalesType,
    type SalesChannel,
} from '../../hooks/useSalesTypes';

interface SalesTypeForm {
    name: string;
    channel: SalesChannel;
    serviceChargePct: string;
    chargeAccountId: string;
    taxable: boolean;
    sortOrder: number;
    isActive: boolean;
}

const emptyForm = (): SalesTypeForm => ({
    name: '',
    channel: 'OFFLINE',
    serviceChargePct: '0',
    chargeAccountId: '',
    taxable: true,
    sortOrder: 0,
    isActive: true,
});

const SalesTypeSettings = (): React.ReactElement => {
    const { canCreate, canEdit, canDelete } = useModulePermissions('pos_retail');
    const pushToast = useToastStore((s) => s.pushToast);

    const { data: salesTypes = [], isLoading } = useSalesTypes();
    const createType = useCreateSalesType();
    const updateType = useUpdateSalesType();
    const deleteType = useDeleteSalesType();

    // Charge account picker — postable Revenue accounts (income used to book the
    // service charge). Optional field.
    const { data: revenueAccounts = [] } = useAccountsByType('Revenue');
    const accountOptions = useMemo(
        () => revenueAccounts.map((a) => ({
            value: a.id,
            label: a.code ? `${a.code} — ${a.name}` : a.name,
        })),
        [revenueAccounts],
    );

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editing, setEditing]         = useState<SalesType | null>(null);
    const [formData, setFormData]       = useState<SalesTypeForm>(emptyForm);
    const [errors, setErrors]           = useState<Record<string, string | null>>({});

    const handleOpenModal = (type: SalesType | null = null) => {
        setErrors({});
        if (type) {
            setEditing(type);
            setFormData({
                name: type.name,
                channel: type.channel,
                serviceChargePct: String(type.serviceChargePct),
                chargeAccountId: type.chargeAccountId ?? '',
                taxable: type.taxable,
                sortOrder: type.sortOrder,
                isActive: type.isActive,
            });
        } else {
            setEditing(null);
            setFormData(emptyForm());
        }
        setIsModalOpen(true);
    };

    const validate = (): Record<string, string> => {
        const errs: Record<string, string> = {};
        if (!formData.name.trim()) errs.name = 'Nama wajib diisi.';
        return errs;
    };

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        const errs = validate();
        if (Object.keys(errs).length > 0) { setErrors(errs); return; }

        const payload = {
            name: formData.name.trim(),
            channel: formData.channel,
            serviceChargePct: Number(formData.serviceChargePct) || 0,
            chargeAccountId: formData.chargeAccountId || null,
            taxable: formData.taxable,
            sortOrder: Number(formData.sortOrder) || 0,
            isActive: formData.isActive,
        };

        if (editing) {
            updateType.mutate({ id: editing.id, ...payload }, {
                onSuccess: () => { pushToast('Tipe penjualan diperbarui.'); setIsModalOpen(false); },
                onError: (err: Error) => pushToast(err.message, 'error'),
            });
        } else {
            createType.mutate(payload, {
                onSuccess: () => { pushToast('Tipe penjualan dibuat.'); setIsModalOpen(false); },
                onError: (err: Error) => pushToast(err.message, 'error'),
            });
        }
    };

    const handleDelete = (type: SalesType) => {
        if (!window.confirm(`Hapus "${type.name}"?`)) return;
        deleteType.mutate(type.id, {
            onSuccess: () => pushToast('Tipe penjualan dihapus.'),
            onError: (err: Error) => pushToast(err.message, 'error'),
        });
    };

    const columns = [
        { key: 'name', label: 'Nama', sortable: true, render: (val: unknown) => <span className="font-medium">{val as string}</span> },
        {
            key: 'channel', label: 'Saluran',
            render: (val: unknown) => (val === 'ONLINE')
                ? <span className="text-xs font-medium px-2 py-0.5 rounded bg-primary-50 text-primary-700">Online</span>
                : <span className="text-xs font-medium px-2 py-0.5 rounded bg-neutral-100 text-neutral-700">Offline</span>,
        },
        {
            key: 'serviceChargePct', label: 'Biaya Layanan %', align: 'right' as const,
            render: (val: unknown) => `${Number(val ?? 0)}%`,
        },
        {
            key: 'taxable', label: 'Kena Pajak',
            render: (val: unknown) => (val as boolean)
                ? <span className="text-xs font-medium px-2 py-0.5 rounded bg-warning-100 text-warning-700">Ya</span>
                : <span className="text-xs text-neutral-400">Tidak</span>,
        },
        { key: 'isActive', label: 'Status', render: (val: unknown) => <StatusTag status={(val as boolean) ? 'Active' : 'Inactive'} /> },
        {
            key: 'actions', label: '', align: 'right' as const,
            render: (_: unknown, row: Record<string, unknown>) => {
                const type = row as unknown as SalesType;
                return (
                    <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="small" icon={<Edit2 size={15} />} disabled={!canEdit}
                            onClick={() => handleOpenModal(type)} />
                        <Button variant="ghost" size="small" icon={<Trash2 size={15} />} disabled={!canDelete}
                            onClick={() => handleDelete(type)} />
                    </div>
                );
            },
        },
    ];

    return (
        <ListPage
            containerClassName="pos-module"
            title="Sales Types"
            subtitle="Kelola tipe penjualan (mis. dine-in, ojek online) beserta biaya layanan dan akun pendapatannya."
            actions={
                <Button
                    text="New Sales Type"
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
                    data={salesTypes as unknown as Record<string, unknown>[]}
                    showCount
                    countLabel="tipe"
                    isLoading={isLoading}
                    loadingLabel="Memuat tipe penjualan..."
                />
            </Card>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editing ? 'Edit Sales Type' : 'New Sales Type'}
                size="lg"
            >
                <form onSubmit={handleSave}>
                    <div className="grid grid-cols-12 gap-4">
                        <div className="col-span-12 md:col-span-8">
                            <Input
                                label="Nama *"
                                value={formData.name}
                                onChange={(e) => { setFormData((p) => ({ ...p, name: e.target.value })); setErrors((p) => ({ ...p, name: null })); }}
                                placeholder="mis. Dine-in, GoFood, GrabFood"
                                error={errors.name}
                            />
                        </div>
                        <div className="col-span-6 md:col-span-4">
                            <label className="form-label">Urutan</label>
                            <input
                                type="number"
                                className="block w-full px-3 py-2 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                                value={formData.sortOrder}
                                onChange={(e) => setFormData((p) => ({ ...p, sortOrder: Number(e.target.value) || 0 }))}
                            />
                        </div>

                        <div className="col-span-12">
                            <label className="form-label">Saluran</label>
                            <div className="flex gap-2">
                                {(['OFFLINE', 'ONLINE'] as SalesChannel[]).map((c) => (
                                    <button
                                        key={c}
                                        type="button"
                                        onClick={() => setFormData((p) => ({ ...p, channel: c }))}
                                        className={`flex-1 h-10 rounded-md border text-sm font-medium transition-colors ${
                                            formData.channel === c
                                                ? 'border-primary-500 bg-primary-50 text-primary-700'
                                                : 'border-neutral-300 bg-neutral-0 text-neutral-600 hover:border-neutral-400'
                                        }`}
                                    >
                                        {c === 'OFFLINE' ? 'Offline' : 'Online'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="col-span-6">
                            <label className="form-label">Biaya Layanan %</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="block w-full px-3 py-2 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                                value={formData.serviceChargePct}
                                onChange={(e) => setFormData((p) => ({ ...p, serviceChargePct: e.target.value }))}
                            />
                        </div>
                        <div className="col-span-6">
                            <label className="form-label">Akun Biaya</label>
                            <SearchableSelect
                                options={accountOptions}
                                value={formData.chargeAccountId}
                                onChange={(v) => setFormData((p) => ({ ...p, chargeAccountId: v }))}
                                placeholder="Pilih akun (opsional)..."
                            />
                        </div>

                        <div className="col-span-12 flex items-center gap-6">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.taxable}
                                    onChange={(e) => setFormData((p) => ({ ...p, taxable: e.target.checked }))}
                                    className="w-4 h-4 rounded border-neutral-300 text-primary-600"
                                />
                                <span className="text-sm text-neutral-700">Kena Pajak</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.isActive}
                                    onChange={(e) => setFormData((p) => ({ ...p, isActive: e.target.checked }))}
                                    className="w-4 h-4 rounded border-neutral-300 text-primary-600"
                                />
                                <span className="text-sm text-neutral-700">Aktif</span>
                            </label>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-6">
                        <Button type="button" variant="tertiary" text="Batal" onClick={() => setIsModalOpen(false)} />
                        <Button
                            type="submit"
                            variant="primary"
                            text={editing ? 'Perbarui' : 'Simpan'}
                            icon={<Save size={16} />}
                            disabled={(editing ? !canEdit : !canCreate) || createType.isPending || updateType.isPending}
                        />
                    </div>
                </form>
            </Modal>
        </ListPage>
    );
};

export default SalesTypeSettings;

import React, { useState } from 'react';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import StatusTag from '../../components/UI/StatusTag';
import { Plus, Settings, Trash2, AlertCircle, FileUp } from 'lucide-react';
import { useCustomers } from '../../hooks/useAR';
import { useBankAccounts } from '../../hooks/useBanking';
import {
    useDeleteEcommerceConnection,
    useEcommerceConnections,
    useUpdateEcommerceConnection,
} from '../../hooks/useIntegrations';
import ListPage from '../../components/Layout/ListPage';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { useSalesTypes } from '../../hooks/useSalesTypes';
import Table, { TableColumn } from '../../components/UI/Table';
import type { EcommerceConnection, ImportStatusFilter } from '../../types/index';
import ConnectShopModal from './ConnectShopModal';
import SettlementImportModal from '../../components/integrations/SettlementImportModal';

interface SelectOption {
    value: string;
    label: string;
}

const Integrations = () => {
    const { canCreate, canEdit, canDelete } = useModulePermissions('integrations');
    const { data: customersData } = useCustomers();
    const customers = customersData?.data ?? [];
    const { data: bankAccounts = [] } = useBankAccounts();
    const { data: salesTypes = [] } = useSalesTypes();
    const { data: connectionsData, isLoading, error } = useEcommerceConnections();
    const shops: EcommerceConnection[] = connectionsData?.data ?? [];
    const updateConnection = useUpdateEcommerceConnection();
    const deleteConnection = useDeleteEcommerceConnection();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [settingsShopId, setSettingsShopId] = useState<string | null>(null);
    const [settlementShopId, setSettlementShopId] = useState<string | null>(null);

    const bankOptions: SelectOption[] = bankAccounts.map(b => ({ value: b.id, label: b.name }));

    const handleDeleteShop = async (id: string): Promise<void> => {
        try {
            await deleteConnection.mutateAsync(id);
        } catch (deleteError) {
            window.alert(deleteError instanceof Error ? deleteError.message : 'Failed to delete shop connection.');
        }
    };

    // Settings modal
    const settingsShop = settingsShopId ? shops.find(s => s.id === settingsShopId) : null;

    const handleSaveSettings = async (filter: ImportStatusFilter): Promise<void> => {
        if (settingsShopId) {
            try {
                await updateConnection.mutateAsync({ id: settingsShopId, importStatusFilter: filter });
            } catch (saveError) {
                window.alert(saveError instanceof Error ? saveError.message : 'Failed to save integration settings.');
                return;
            }
        }
        setSettingsShopId(null);
    };

    const handleSaveSalesType = async (salesTypeId: string): Promise<void> => {
        if (settingsShopId) {
            try {
                await updateConnection.mutateAsync({ id: settingsShopId, salesTypeId: salesTypeId || null });
            } catch (saveError) {
                window.alert(saveError instanceof Error ? saveError.message : 'Failed to save default sales type.');
            }
        }
    };

    const columns = [
        { key: 'platform', label: 'Platform', render: (val: unknown) => <span className="text-strong">{val as string}</span> },
        { key: 'name', label: 'Shop Name' },
        {
            key: 'customer',
            label: 'Mapped Customer',
            render: (val: unknown) => {
                const cust = customers.find(c => c.id === (val as string)) || { name: 'Unknown Customer' };
                return cust.name === 'Unknown Customer' ? val as string : cust.name;
            }
        },
        {
            key: 'holdingAccount',
            label: 'Settlement Account',
            render: (val: unknown) => {
                const acc = bankOptions.find(b => b.value === (val as string));
                return acc ? acc.label : val as string;
            }
        },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={val === 'Active' ? 'Success' : 'Warning'} label={val as string} /> },
        {
            key: 'actions',
            label: '',
            render: (_: unknown, row: EcommerceConnection) => (
                <div className="row-actions-end">
                    <Button icon={<Settings size={14} />} size="small" variant="secondary" disabled={!canEdit} onClick={() => setSettingsShopId(row.id)} />
                    <Button icon={<FileUp size={14} />} size="small" variant="secondary" disabled={!canEdit} onClick={() => setSettlementShopId(row.id)} title="Import settlement statement" />
                    <Button icon={<Trash2 size={14} />} size="small" variant="danger" disabled={!canDelete} onClick={() => handleDeleteShop(row.id)} />
                </div>
            )
        }
    ];

    return (
        <ListPage
            containerClassName="integrations-module"
            title="E-Commerce Integrations"
            subtitle="Manage your customized shop connections and accounting mappings."
            actions={<Button text="Add New Shop" variant="primary" icon={<Plus size={16} />} disabled={!canCreate} onClick={() => setIsModalOpen(true)} />}
        >

            <div className="grid-12 integrations-info-grid">
                <div className="col-span-12">
                    <div className="integrations-helper-card">
                        <AlertCircle size={20} color="#2563eb" className="integrations-helper-icon" />
                        <div>
                            <h4 className="integrations-helper-title">How Mapping Works</h4>
                            <p className="integrations-helper-text">
                                When you import transactions from a shop, sales will be recorded against the <strong>Mapped Customer</strong>.
                                Funds held by the platform (before payout to your bank) will be tracked in the <strong>Settlement Account</strong>.
                            </p>
                            <p className="integrations-helper-text">
                                Settlement accounts now come from your real banking records, so create the wallet or clearing account in Banking first if you do not see it here.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {error ? (
                <div className="mb-4 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
                    {error instanceof Error ? error.message : 'Failed to load integrations.'}
                </div>
            ) : null}

            <Card padding={false}>
                <Table columns={columns as TableColumn<Record<string, unknown>>[]} data={shops as unknown as Record<string, unknown>[]} isLoading={isLoading} />
            </Card>

            <ConnectShopModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                existingShops={shops}
                canCreate={canCreate}
            />

            <SettlementImportModal
                isOpen={!!settlementShopId}
                connectionId={settlementShopId ?? ''}
                platform={shops.find((s) => s.id === settlementShopId)?.platform ?? ''}
                onClose={() => setSettlementShopId(null)}
            />

            {/* Shop Settings Modal */}
            <Modal
                title={settingsShop ? `Settings — ${settingsShop.name}` : 'Shop Settings'}
                isOpen={!!settingsShopId}
                onClose={() => setSettingsShopId(null)}
                size="sm"
            >
                {settingsShop && (
                    <div className="integrations-modal-body">
                        <div className="mb-4">
                            <label className="form-label">Import Status Filter</label>
                            <span className="integrations-field-hint mb-2 block">
                                Choose which order statuses to include when importing transactions.
                            </span>
                            <div className="flex flex-col gap-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="importStatusFilter"
                                        value="Selesai"
                                        checked={settingsShop.importStatusFilter === 'Selesai'}
                                        disabled={!canEdit || updateConnection.isPending}
                                        onChange={() => handleSaveSettings('Selesai' as ImportStatusFilter)}
                                    />
                                    <span className="text-sm">Completed only</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="importStatusFilter"
                                        value="All"
                                        checked={settingsShop.importStatusFilter === 'All'}
                                        disabled={!canEdit || updateConnection.isPending}
                                        onChange={() => handleSaveSettings('All' as ImportStatusFilter)}
                                    />
                                    <span className="text-sm">All statuses</span>
                                </label>
                            </div>
                        </div>

                        <div className="mb-4">
                            <label className="form-label">Default sales type</label>
                            <span className="integrations-field-hint mb-2 block">
                                Sales imported from this shop are tagged with this sales type (tipe penjualan).
                            </span>
                            <select
                                className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                value={settingsShop.salesTypeId ?? ''}
                                disabled={!canEdit || updateConnection.isPending}
                                onChange={(e) => { void handleSaveSalesType(e.target.value); }}
                            >
                                <option value="">— None —</option>
                                {salesTypes.map((st) => (
                                    <option key={st.id} value={st.id}>{st.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                )}
            </Modal>
        </ListPage>
    );
};

export default Integrations;

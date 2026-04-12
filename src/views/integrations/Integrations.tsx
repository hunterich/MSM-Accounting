import React, { useState } from 'react';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import Input from '../../components/UI/Input';
import StatusTag from '../../components/UI/StatusTag';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { Plus, Settings, Trash2, AlertCircle, X } from 'lucide-react';
import { useCustomers, useCreateCustomer } from '../../hooks/useAR';
import { useBankAccounts, useCreateBankAccount } from '../../hooks/useBanking';
import {
    useCreateEcommerceConnection,
    useDeleteEcommerceConnection,
    useEcommerceConnections,
    useUpdateEcommerceConnection,
} from '../../hooks/useIntegrations';
import ListPage from '../../components/Layout/ListPage';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import Table, { TableColumn } from '../../components/UI/Table';
import type { EcommerceConnection, EcommercePlatform, ImportStatusFilter } from '../../types/index';

interface NewShopForm {
    platform: EcommercePlatform;
    name: string;
    customerId: string;
    holdingAccountId: string;
}

interface FormErrors {
    name?: string | null;
    customerId?: string | null;
    holdingAccountId?: string | null;
}

interface SelectOption {
    value: string;
    label: string;
}

const Integrations = () => {
    const { canCreate, canEdit, canDelete } = useModulePermissions('integrations');
    const { data: customersData } = useCustomers();
    const customers = customersData?.data ?? [];
    const { data: bankAccounts = [] } = useBankAccounts();
    const { data: connectionsData, isLoading, error } = useEcommerceConnections();
    const shops: EcommerceConnection[] = connectionsData?.data ?? [];
    const createConnection = useCreateEcommerceConnection();
    const updateConnection = useUpdateEcommerceConnection();
    const deleteConnection = useDeleteEcommerceConnection();
    const createCustomer = useCreateCustomer();
    const createBankAccount = useCreateBankAccount();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [settingsShopId, setSettingsShopId] = useState<string | null>(null);

    const [newShop, setNewShop] = useState<NewShopForm>({
        platform: 'Shopee',
        name: '',
        customerId: '',
        holdingAccountId: ''
    });
    const [formErrors, setFormErrors] = useState<FormErrors>({});

    // Inline quick-create state
    const [showNewCustomer, setShowNewCustomer] = useState(false);
    const [newCustomerName, setNewCustomerName] = useState('');
    const [newCustomerError, setNewCustomerError] = useState('');
    const [showNewAccount, setShowNewAccount] = useState(false);
    const [newAccountName, setNewAccountName] = useState('');
    const [newAccountBank, setNewAccountBank] = useState('');
    const [newAccountNumber, setNewAccountNumber] = useState('');
    const [newAccountError, setNewAccountError] = useState('');

    const handleQuickCreateCustomer = async () => {
        const trimmed = newCustomerName.trim();
        if (!trimmed) { setNewCustomerError('Name is required.'); return; }
        // Auto-generate a code from the name (uppercase first letters, max 10 chars)
        const autoCode = trimmed.replace(/\s+/g, '-').toUpperCase().slice(0, 10);
        try {
            const created = await createCustomer.mutateAsync({ name: trimmed, code: autoCode }) as { id: string };
            setNewShop(prev => ({ ...prev, customerId: created.id }));
            setShowNewCustomer(false);
            setNewCustomerName('');
            setNewCustomerError('');
            setFormErrors(prev => ({ ...prev, customerId: null }));
        } catch (e) {
            setNewCustomerError(e instanceof Error ? e.message : 'Failed to create customer.');
        }
    };

    const handleQuickCreateAccount = async () => {
        if (!newAccountName.trim()) { setNewAccountError('Account name is required.'); return; }
        try {
            const created = await createBankAccount.mutateAsync({
                accountNickname: newAccountName.trim(),
                bankName: newAccountBank.trim(),
                last4: newAccountNumber.trim(),
                currency: 'IDR',
                openingBalance: '0',
            } as Parameters<typeof createBankAccount.mutateAsync>[0]);
            setNewShop(prev => ({ ...prev, holdingAccountId: (created as { id: string }).id }));
            setShowNewAccount(false);
            setNewAccountName('');
            setNewAccountBank('');
            setNewAccountNumber('');
            setNewAccountError('');
            setFormErrors(prev => ({ ...prev, holdingAccountId: null }));
        } catch (e) {
            setNewAccountError(e instanceof Error ? e.message : 'Failed to create account.');
        }
    };

    const customerOptions: SelectOption[] = customers.map(c => ({ value: c.id, label: c.name }));
    const bankOptions: SelectOption[] = bankAccounts.map(b => ({ value: b.id, label: b.name }));

    const platformOptions: SelectOption[] = [
        { value: 'Shopee', label: 'Shopee Indonesia' },
        { value: 'TikTok', label: 'TikTok Shop' },
        { value: 'Tokopedia', label: 'Tokopedia' },
        { value: 'Lazada', label: 'Lazada' }
    ];

    const resetModal = (): void => {
        setIsModalOpen(false);
        setFormErrors({});
        setNewShop({ platform: 'Shopee', name: '', customerId: '', holdingAccountId: '' });
        setShowNewCustomer(false); setNewCustomerName(''); setNewCustomerError('');
        setShowNewAccount(false); setNewAccountName(''); setNewAccountBank(''); setNewAccountNumber(''); setNewAccountError('');
    };

    const handleSaveShop = async (): Promise<void> => {
        const nextErrors: FormErrors = {};
        const trimmedName = newShop.name.trim();
        if (!trimmedName) nextErrors.name = 'Shop name is required.';
        if (!newShop.customerId) nextErrors.customerId = 'Default customer is required.';
        if (!newShop.holdingAccountId) nextErrors.holdingAccountId = 'Settlement account is required.';

        const duplicate = shops.some((shop) => (
            shop.platform === newShop.platform &&
            shop.name.trim().toLowerCase() === trimmedName.toLowerCase()
        ));
        if (duplicate) nextErrors.name = 'This shop already exists for the selected platform.';

        if (Object.keys(nextErrors).length > 0) {
            setFormErrors(nextErrors);
            return;
        }

        try {
            await createConnection.mutateAsync({
                platform: newShop.platform,
                name: trimmedName,
                customerId: newShop.customerId,
                holdingAccountId: newShop.holdingAccountId,
                status: 'Active',
            });
            resetModal();
        } catch (saveError) {
            setFormErrors((prev) => ({
                ...prev,
                name: saveError instanceof Error ? saveError.message : 'Failed to save shop connection.',
            }));
        }
    };

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
            actions={<Button text="Add New Shop" variant="primary" icon={<Plus size={16} />} disabled={!canCreate} onClick={() => { setFormErrors({}); setIsModalOpen(true); }} />}
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

            {/* Add New Shop Modal */}
            <Modal
                title="Connect New Shop"
                isOpen={isModalOpen}
                onClose={resetModal}
            >
                <div className="integrations-modal-body">
                    <div className="mb-4">
                        <label className="form-label">Platform</label>
                        <select
                            className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed"
                            value={newShop.platform}
                            onChange={(e) => setNewShop({ ...newShop, platform: e.target.value as EcommercePlatform })}
                        >
                            {platformOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="mb-4">
                        <label className="form-label">Shop Name / Identifier</label>
                        <Input
                            placeholder="e.g. MyShopeeStore_01"
                            value={newShop.name}
                            onChange={(e) => {
                                setNewShop({ ...newShop, name: e.target.value });
                                setFormErrors((prev) => ({ ...prev, name: null }));
                            }}
                        />
                        {formErrors.name ? <div className="form-feedback invalid-feedback">{formErrors.name}</div> : null}
                        <span className="integrations-field-hint">This helps you identify the import source.</span>
                    </div>

                    <div className="integrations-divider" />
                    <h4 className="integrations-section-title">Accounting Mapping</h4>

                    {/* Default Customer */}
                    <div className="mb-1">
                        <label className="form-label">Default Customer</label>
                        <SearchableSelect
                            options={customerOptions}
                            value={newShop.customerId}
                            onChange={(val) => {
                                setNewShop({ ...newShop, customerId: val });
                                setFormErrors((prev) => ({ ...prev, customerId: null }));
                                setShowNewCustomer(false);
                            }}
                            placeholder="Select Customer..."
                            footerAction={{ label: 'Add new customer', onAction: () => { setShowNewCustomer(v => !v); setShowNewAccount(false); } }}
                        />
                        {formErrors.customerId ? <div className="form-feedback invalid-feedback">{formErrors.customerId}</div> : null}
                        <span className="integrations-field-hint">Sales will be recorded under this customer.</span>
                    </div>

                    {/* Inline quick-create customer */}
                    {showNewCustomer && (
                        <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50 p-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-primary-700 uppercase tracking-wide">New Customer</span>
                                <button type="button" onClick={() => { setShowNewCustomer(false); setNewCustomerName(''); setNewCustomerError(''); }} className="text-neutral-400 hover:text-neutral-600"><X size={14} /></button>
                            </div>
                            <Input
                                placeholder="Customer name *"
                                value={newCustomerName}
                                onChange={e => { setNewCustomerName(e.target.value); setNewCustomerError(''); }}
                                className="mb-2"
                            />
                            {newCustomerError && <div className="form-feedback invalid-feedback mb-2">{newCustomerError}</div>}
                            <Button
                                text={createCustomer.isPending ? 'Creating...' : 'Create & Select'}
                                variant="primary"
                                size="small"
                                disabled={createCustomer.isPending}
                                onClick={handleQuickCreateCustomer}
                            />
                        </div>
                    )}

                    {/* Settlement / Holding Account */}
                    <div className="mb-1">
                        <label className="form-label">Settlement / Holding Account</label>
                        <SearchableSelect
                            options={bankOptions}
                            value={newShop.holdingAccountId}
                            onChange={(val) => {
                                setNewShop({ ...newShop, holdingAccountId: val });
                                setFormErrors((prev) => ({ ...prev, holdingAccountId: null }));
                                setShowNewAccount(false);
                            }}
                            placeholder="Select Account..."
                            footerAction={{ label: 'Add new account', onAction: () => { setShowNewAccount(v => !v); setShowNewCustomer(false); } }}
                        />
                        {formErrors.holdingAccountId ? <div className="form-feedback invalid-feedback">{formErrors.holdingAccountId}</div> : null}
                        <span className="integrations-field-hint">Where funds are held before withdrawal to bank.</span>
                    </div>

                    {/* Inline quick-create bank account */}
                    {showNewAccount && (
                        <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50 p-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-primary-700 uppercase tracking-wide">New Account</span>
                                <button type="button" onClick={() => { setShowNewAccount(false); setNewAccountName(''); setNewAccountBank(''); setNewAccountNumber(''); setNewAccountError(''); }} className="text-neutral-400 hover:text-neutral-600"><X size={14} /></button>
                            </div>
                            <Input placeholder="Account name *" value={newAccountName} onChange={e => { setNewAccountName(e.target.value); setNewAccountError(''); }} className="mb-2" />
                            <Input placeholder="Bank name (optional)" value={newAccountBank} onChange={e => setNewAccountBank(e.target.value)} className="mb-2" />
                            <Input placeholder="Account number (optional)" value={newAccountNumber} onChange={e => setNewAccountNumber(e.target.value)} className="mb-2" />
                            {newAccountError && <div className="form-feedback invalid-feedback mb-2">{newAccountError}</div>}
                            <Button
                                text={createBankAccount.isPending ? 'Creating...' : 'Create & Select'}
                                variant="primary"
                                size="small"
                                disabled={createBankAccount.isPending}
                                onClick={handleQuickCreateAccount}
                            />
                        </div>
                    )}

                </div>

                <div className="integrations-modal-actions">
                    <Button text="Cancel" variant="tertiary" onClick={resetModal} />
                    <Button
                        text={createConnection.isPending ? 'Saving...' : 'Save Connection'}
                        variant="primary"
                        disabled={!canCreate || createConnection.isPending}
                        onClick={handleSaveShop}
                    />
                </div>
            </Modal>

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
                                    <span className="text-sm">Selesai (Completed only)</span>
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
                                    <span className="text-sm">Semua Status (All statuses)</span>
                                </label>
                            </div>
                        </div>
                    </div>
                )}
            </Modal>
        </ListPage>
    );
};

export default Integrations;

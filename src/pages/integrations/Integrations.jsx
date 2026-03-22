import React, { useState } from 'react';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import Input from '../../components/UI/Input';
import StatusTag from '../../components/UI/StatusTag';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { Plus, Settings, Trash2, AlertCircle } from 'lucide-react';
import { customers, bankAccounts } from '../../data/mockData';
import { useIntegrationStore } from '../../stores/useIntegrationStore';
import ListPage from '../../components/Layout/ListPage';

const Integrations = () => {
    const shops = useIntegrationStore((s) => s.shops);
    const addShop = useIntegrationStore((s) => s.addShop);
    const updateShop = useIntegrationStore((s) => s.updateShop);
    const deleteShop = useIntegrationStore((s) => s.deleteShop);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [settingsShopId, setSettingsShopId] = useState(null);

    const [newShop, setNewShop] = useState({
        platform: 'Shopee',
        name: '',
        customerId: '',
        holdingAccountId: ''
    });
    const [formErrors, setFormErrors] = useState({});

    // Mock Data Options
    const customerOptions = customers.map(c => ({ value: c.id, label: c.name }));
    const bankOptions = bankAccounts.map(b => ({ value: b.id, label: b.name }));

    // Add "Platform Wallets" if not in mockData (simulating user creation)
    const allBankOptions = [
        ...bankOptions,
        { value: 'BANK-005', label: 'Asset: Shopee Wallet' },
        { value: 'BANK-006', label: 'Asset: TikTok Balance' }
    ].filter((option, index, list) => list.findIndex((candidate) => candidate.value === option.value) === index);

    const platformOptions = [
        { value: 'Shopee', label: 'Shopee Indonesia' },
        { value: 'TikTok', label: 'TikTok Shop' },
        { value: 'Tokopedia', label: 'Tokopedia' },
        { value: 'Lazada', label: 'Lazada' }
    ];

    const resetModal = () => {
        setIsModalOpen(false);
        setFormErrors({});
        setNewShop({ platform: 'Shopee', name: '', customerId: '', holdingAccountId: '' });
    };

    const handleSaveShop = () => {
        const nextErrors = {};
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

        const shop = {
            id: `SHOP-${Date.now()}`,
            platform: newShop.platform,
            name: trimmedName,
            customer: newShop.customerId,
            holdingAccount: newShop.holdingAccountId,
            status: 'Active'
        };
        addShop(shop);
        resetModal();
    };

    const handleDeleteShop = (id) => {
        deleteShop(id);
    };

    // Settings modal
    const settingsShop = settingsShopId ? shops.find(s => s.id === settingsShopId) : null;

    const handleSaveSettings = (filter) => {
        if (settingsShopId) {
            updateShop(settingsShopId, { importStatusFilter: filter });
        }
        setSettingsShopId(null);
    };

    const columns = [
        { key: 'platform', label: 'Platform', render: (val) => <span className="text-strong">{val}</span> },
        { key: 'name', label: 'Shop Name' },
        {
            key: 'customer',
            label: 'Mapped Customer',
            render: (val) => {
                const cust = customers.find(c => c.id === val) || { name: 'Unknown Customer' };
                return cust.name === 'Unknown Customer' ? val : cust.name;
            }
        },
        {
            key: 'holdingAccount',
            label: 'Settlement Account',
            render: (val) => {
                const acc = allBankOptions.find(b => b.value === val);
                return acc ? acc.label : val;
            }
        },
        { key: 'status', label: 'Status', render: (val) => <StatusTag status={val === 'Active' ? 'Success' : 'Warning'} label={val} /> },
        {
            key: 'actions',
            label: '',
            render: (_, row) => (
                <div className="row-actions-end">
                    <Button icon={<Settings size={14} />} size="small" variant="secondary" onClick={() => setSettingsShopId(row.id)} />
                    <Button icon={<Trash2 size={14} />} size="small" variant="danger" onClick={() => handleDeleteShop(row.id)} />
                </div>
            )
        }
    ];

    return (
        <ListPage
            containerClassName="integrations-module"
            title="E-Commerce Integrations"
            subtitle="Manage your customized shop connections and accounting mappings."
            actions={<Button text="Add New Shop" variant="primary" icon={<Plus size={16} />} onClick={() => { setFormErrors({}); setIsModalOpen(true); }} />}
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
                        </div>
                    </div>
                </div>
            </div>

            <Card padding={false}>
                <Table columns={columns} data={shops} />
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
                            onChange={(e) => setNewShop({ ...newShop, platform: e.target.value })}
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

                    <div className="mb-4">
                        <label className="form-label">Default Customer</label>
                        <SearchableSelect
                            options={customerOptions}
                            value={newShop.customerId}
                            onChange={(val) => {
                                setNewShop({ ...newShop, customerId: val });
                                setFormErrors((prev) => ({ ...prev, customerId: null }));
                            }}
                            placeholder="Select Customer..."
                        />
                        {formErrors.customerId ? <div className="form-feedback invalid-feedback">{formErrors.customerId}</div> : null}
                        <span className="integrations-field-hint">Sales will be recorded under this customer.</span>
                    </div>

                    <div className="mb-4">
                        <label className="form-label">Settlement / Holding Account</label>
                        <select
                            className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed"
                            value={newShop.holdingAccountId}
                            onChange={(e) => {
                                setNewShop({ ...newShop, holdingAccountId: e.target.value });
                                setFormErrors((prev) => ({ ...prev, holdingAccountId: null }));
                            }}
                        >
                            <option value="">Select Account...</option>
                            {allBankOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                        {formErrors.holdingAccountId ? <div className="form-feedback invalid-feedback">{formErrors.holdingAccountId}</div> : null}
                        <span className="integrations-field-hint">Where funds are held before withdrawal to bank.</span>
                    </div>

                </div>

                <div className="integrations-modal-actions">
                    <Button text="Cancel" variant="tertiary" onClick={resetModal} />
                    <Button text="Save Connection" variant="primary" onClick={handleSaveShop} />
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
                                        onChange={() => handleSaveSettings('Selesai')}
                                    />
                                    <span className="text-sm">Selesai (Completed only)</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="importStatusFilter"
                                        value="All"
                                        checked={settingsShop.importStatusFilter === 'All'}
                                        onChange={() => handleSaveSettings('All')}
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

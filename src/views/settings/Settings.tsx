import React, { useEffect, useState } from 'react';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import { Save, Briefcase, User, Shield, Bell, ScrollText, DatabaseZap, Hash, Mail, Upload, ToggleLeft, Lock, ClipboardCheck } from 'lucide-react';
import SecurityRolesTab from './SecurityRolesTab';
import AuditLogPanel from '../../components/UI/AuditLogPanel';
import DataMigrationPanel from './DataMigrationPanel';
import EmailTemplates from './EmailTemplates';
import CsvImportPanel from './CsvImportPanel';
import { useSettingsStore, DEFAULT_DOCUMENT_NUMBERING } from '../../stores/useSettingsStore';
import { useChartOfAccounts } from '../../hooks/useGL';
import { useAccountDefaults, useUpdateOrganizationSettings } from '../../hooks/useOrganizationSettings';
import { ACCOUNT_DEFAULT_SPECS, DEFAULT_ACCOUNT_DEFAULTS } from '../../../lib/account-defaults';
import type { AccountDefaultKey } from '../../../lib/account-defaults';
import type { LucideIcon } from 'lucide-react';

interface SecuritySettings {
    require2FA: boolean;
    allowInvites: boolean;
    sessionTimeoutMinutes: string;
}

interface NotificationSettings {
    financeEmail: string;
    invoiceReminders: boolean;
    paymentAlerts: boolean;
    dailySummary: boolean;
}

interface CreditLimitFormState {
    defaultLimit: string;
    defaultPaymentTerms: string;
    enforceLimit: boolean;
}

interface MenuItem {
    id: string;
    label: string;
    icon: LucideIcon;
}

interface ToggleRowProps {
    label: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    hint?: string;
}

const FeatureRow = ({ label, checked, onChange, hint }: ToggleRowProps) => (
    <div className="mb-3">
        <label className="form-label settings-checkbox-label">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="settings-checkbox-input"
            />
            <span className="settings-label-strong">{label}</span>
        </label>
        {hint && <div className="settings-help-text ml-6">{hint}</div>}
    </div>
);

const ApprovalRow = ({ label, checked, onChange }: ToggleRowProps) => (
    <div className="mb-3">
        <label className="form-label settings-checkbox-label">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="settings-checkbox-input"
            />
            <span className="settings-label-strong">Require approval for {label}</span>
        </label>
    </div>
);

const Settings = () => {
    const [activeTab, setActiveTab] = useState('customers');
    const storeCompanyInfo = useSettingsStore(s => s.companyInfo);
    const storeTaxSettings = useSettingsStore(s => s.taxSettings);
    const storeCustomerCreditSettings = useSettingsStore(s => s.customerCreditSettings);
    const storeSalesPolicy = useSettingsStore(s => s.salesPolicy);
    const storeFeatures = useSettingsStore(s => s.features);
    const storeApprovalRequirements = useSettingsStore(s => s.approvalRequirements);
    const storeAccountDefaults = useSettingsStore(s => s.accountDefaults ?? DEFAULT_ACCOUNT_DEFAULTS);
    const updateCompanyInfo = useSettingsStore(s => s.updateCompanyInfo);
    const updateTaxSettings = useSettingsStore(s => s.updateTaxSettings);
    const updateCustomerCreditSettings = useSettingsStore(s => s.updateCustomerCreditSettings);
    const updateSalesPolicy = useSettingsStore(s => s.updateSalesPolicy);
    const updateFeatures = useSettingsStore(s => s.updateFeatures);
    const updateApprovalRequirements = useSettingsStore(s => s.updateApprovalRequirements);
    const updateAccountDefaults = useSettingsStore(s => s.updateAccountDefaults);
    const documentNumbering = useSettingsStore(s => s.documentNumbering ?? DEFAULT_DOCUMENT_NUMBERING);
    const updateDocumentNumbering = useSettingsStore(s => s.updateDocumentNumbering);
    const { data: chartOfAccounts = [] } = useChartOfAccounts();
    const { data: serverAccountDefaults } = useAccountDefaults();
    const updateOrgSettings = useUpdateOrganizationSettings();

    const [generalSettings, setGeneralSettings] = useState(storeCompanyInfo);
    const [taxData, setTaxData] = useState(storeTaxSettings);
    const [creditLimitSettings, setCreditLimitSettings] = useState<CreditLimitFormState>({
        defaultLimit: String(storeCustomerCreditSettings.defaultLimit),
        defaultPaymentTerms: String(storeCustomerCreditSettings.defaultPaymentTerms),
        enforceLimit: storeCustomerCreditSettings.enforceLimit,
    });
    const [salesPolicy, setSalesPolicy] = useState(storeSalesPolicy);
    const [features, setFeatures] = useState(storeFeatures);
    const [approvalRequirements, setApprovalRequirements] = useState(storeApprovalRequirements);
    const [accountDefaults, setAccountDefaults] = useState(storeAccountDefaults);

    // Hydrate from server-of-truth (DB) when org settings load. Falls back to
    // Zustand cache for first paint to avoid flicker. Server values overwrite
    // local state on every fetch.
    useEffect(() => {
      if (!serverAccountDefaults) return;
      if (Object.keys(serverAccountDefaults).length === 0) return;
      setAccountDefaults((prev) => ({ ...prev, ...serverAccountDefaults }));
    }, [serverAccountDefaults]);
    const [securitySettings, setSecuritySettings] = useState<SecuritySettings>({
        require2FA: false,
        allowInvites: true,
        sessionTimeoutMinutes: '30'
    });
    const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>({
        financeEmail: 'finance@msm-accounting.local',
        invoiceReminders: true,
        paymentAlerts: true,
        dailySummary: false
    });
    const [lastSavedTab, setLastSavedTab] = useState('');

    const menuItems: MenuItem[] = [
        { id: 'general', label: 'Company Info', icon: Briefcase },
        { id: 'customers', label: 'Customers & Sales', icon: User },
        { id: 'features', label: 'Features', icon: ToggleLeft },
        { id: 'restrictions', label: 'Restrictions', icon: Lock },
        { id: 'approvals', label: 'Approval Rules', icon: ClipboardCheck },
        { id: 'accounts', label: 'Account Defaults', icon: Briefcase },
        { id: 'numbering', label: 'Document Numbering', icon: Hash },
        { id: 'security', label: 'Security & Roles', icon: Shield },
        { id: 'notifications', label: 'Notifications', icon: Bell },
        { id: 'audit', label: 'Audit Log', icon: ScrollText },
        { id: 'migration', label: 'Migrasi Data', icon: DatabaseZap },
        { id: 'email-templates', label: 'Email Templates', icon: Mail },
        { id: 'csv-import', label: 'CSV Import', icon: Upload },
    ];

    const saveCustomerCreditSettings = (): boolean => {
        const defaultLimit = Number(creditLimitSettings.defaultLimit);
        const defaultPaymentTerms = Number(creditLimitSettings.defaultPaymentTerms);
        if (isNaN(defaultLimit) || defaultLimit < 0) {
            window.alert('Default credit limit must be a non-negative number.');
            return false;
        }
        if (isNaN(defaultPaymentTerms) || defaultPaymentTerms < 0) {
            window.alert('Default credit terms must be a non-negative number of days.');
            return false;
        }

        updateCustomerCreditSettings({
            defaultLimit,
            defaultPaymentTerms,
            enforceLimit: creditLimitSettings.enforceLimit,
        });
        return true;
    };

    const saveSection = async (sectionId: string): Promise<void> => {
        if (sectionId === 'general') {
            if (!generalSettings.companyName.trim()) {
                window.alert('Company name is required.');
                return;
            }
            if (generalSettings.email && !generalSettings.email.includes('@')) {
                window.alert('Company email format is invalid.');
                return;
            }
            // Persist company identity to the organization record (DB is the source
            // of truth, shared across devices), then mirror into the local store.
            try {
                await updateOrgSettings.mutateAsync({
                    displayName: generalSettings.companyName.trim(),
                    npwp: generalSettings.npwp?.trim() || null,
                    address: generalSettings.address?.trim() || null,
                    phone: generalSettings.phone?.trim() || null,
                    companyEmail: generalSettings.email?.trim() || null,
                    logoUrl: generalSettings.logoUrl?.trim() || null,
                    timezone: generalSettings.timezone,
                    locale: generalSettings.locale,
                } as Parameters<typeof updateOrgSettings.mutateAsync>[0]);
            } catch (e) {
                window.alert(`Failed to save company info: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
            updateCompanyInfo(generalSettings);
            updateTaxSettings(taxData);
        }

        if (sectionId === 'customers') {
            if (!saveCustomerCreditSettings()) {
                return;
            }
        }

        if (sectionId === 'features') {
            updateFeatures(features);
            // Pajak checkbox in this tab binds to taxData.enabled (single source
            // of truth) — persist that change here too.
            updateTaxSettings({ enabled: taxData.enabled });
        }

        if (sectionId === 'restrictions') {
            if (!saveCustomerCreditSettings()) {
                return;
            }
            updateSalesPolicy(salesPolicy);
        }

        if (sectionId === 'approvals') {
            updateApprovalRequirements(approvalRequirements);
        }

        if (sectionId === 'accounts') {
            // Server is source of truth. Strip empty values (= "Auto-detect")
            // so the API can clear them, then mirror response into Zustand
            // cache so other components reading from the store stay in sync.
            const payload: Record<string, string> = {};
            for (const [k, v] of Object.entries(accountDefaults as Record<string, string>)) {
                if (typeof v === 'string') payload[k] = v;
            }
            try {
                await updateOrgSettings.mutateAsync({ accountDefaults: payload });
                updateAccountDefaults(accountDefaults);
            } catch (e) {
                window.alert(`Failed to save account defaults: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
        }

        if (sectionId === 'security') {
            const timeout = Number(securitySettings.sessionTimeoutMinutes);
            if (isNaN(timeout) || timeout <= 0) {
                window.alert('Session timeout must be greater than zero.');
                return;
            }
        }

        if (sectionId === 'notifications') {
            const requiresEmail = notificationSettings.invoiceReminders || notificationSettings.paymentAlerts || notificationSettings.dailySummary;
            if (requiresEmail && !notificationSettings.financeEmail.includes('@')) {
                window.alert('Enter a valid finance notification email.');
                return;
            }
        }

        setLastSavedTab(sectionId);
    };

    return (
        <div className="container settings-module settings-layout">

            {/* Sidebar Navigation */}
            <div>
                <h2 className="settings-title">Settings</h2>
                <div className="settings-nav-list">
                    {menuItems.map(item => {
                        const Icon = item.icon;
                        return (
                            <button
                                key={item.id}
                                onClick={() => setActiveTab(item.id)}
                                className={`settings-nav-item ${activeTab === item.id ? 'active' : ''}`}
                            >
                                <Icon size={18} /> {item.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Content Area */}
            <div>
                <div className="settings-content-title-wrap">
                    <h1 className="settings-content-title">
                        {menuItems.find(i => i.id === activeTab)?.label || 'Settings'}
                    </h1>
                    {lastSavedTab === activeTab ? (
                        <div className="settings-help-text">Changes saved locally.</div>
                    ) : null}
                </div>

                {activeTab === 'general' && (
                    <Card title="General Settings">
                        <p className="settings-muted">Company profile and basic configuration.</p>
                        <div className="mb-4">
                            <label className="form-label">Company Name</label>
                            <Input
                                value={generalSettings.companyName}
                                onChange={(e) => setGeneralSettings((prev) => ({ ...prev, companyName: e.target.value }))}
                            />
                        </div>
                        <div className="mb-4">
                            <label className="form-label">Address</label>
                            <Input
                                value={generalSettings.address || ''}
                                onChange={(e) => setGeneralSettings((prev) => ({ ...prev, address: e.target.value }))}
                                placeholder="Jl. Sudirman No. 1, Jakarta"
                            />
                        </div>
                        <div className="mb-4">
                            <label className="form-label">Phone</label>
                            <Input
                                value={generalSettings.phone || ''}
                                onChange={(e) => setGeneralSettings((prev) => ({ ...prev, phone: e.target.value }))}
                                placeholder="021-1234567"
                            />
                        </div>
                        <div className="mb-4">
                            <label className="form-label">Company Email</label>
                            <Input
                                type="email"
                                value={generalSettings.email || ''}
                                onChange={(e) => setGeneralSettings((prev) => ({ ...prev, email: e.target.value }))}
                                placeholder="finance@company.com"
                            />
                        </div>
                        <div className="mb-4">
                            <label className="form-label">NPWP</label>
                            <Input
                                value={generalSettings.npwp || ''}
                                onChange={(e) => setGeneralSettings((prev) => ({ ...prev, npwp: e.target.value }))}
                                placeholder="01.234.567.8-901.000"
                            />
                        </div>
                        <div className="mb-4">
                            <label className="form-label">Logo URL (optional)</label>
                            <Input
                                value={generalSettings.logoUrl || ''}
                                onChange={(e) => setGeneralSettings((prev) => ({ ...prev, logoUrl: e.target.value }))}
                                placeholder="https://..."
                            />
                        </div>
                        <div className="mb-4">
                            <label className="form-label">Timezone</label>
                            <select
                                className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed"
                                value={generalSettings.timezone}
                                onChange={(e) => setGeneralSettings((prev) => ({ ...prev, timezone: e.target.value }))}
                            >
                                <option value="Asia/Jakarta">Asia/Jakarta (WIB)</option>
                                <option value="Asia/Makassar">Asia/Makassar (WITA)</option>
                                <option value="Asia/Jayapura">Asia/Jayapura (WIT)</option>
                                <option value="UTC">UTC</option>
                            </select>
                        </div>
                        <div className="mb-4">
                            <label className="form-label">Locale</label>
                            <select
                                className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 disabled:bg-neutral-100 disabled:cursor-not-allowed"
                                value={generalSettings.locale}
                                onChange={(e) => setGeneralSettings((prev) => ({ ...prev, locale: e.target.value }))}
                            >
                                <option value="id-ID">Indonesia (id-ID)</option>
                                <option value="en-US">English (en-US)</option>
                            </select>
                        </div>
                        <div className="mb-4 pt-6 border-t border-neutral-200 mt-6">
                            <h3 className="text-lg font-semibold text-neutral-800 mb-2">Tax Settings</h3>
                            <p className="settings-muted mb-4">Configure the default tax rate applied to new transactions (e.g. Invoices, Bills).</p>

                            <div className="mb-4">
                                <label className="form-label settings-checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={taxData.enabled}
                                        onChange={(e) => setTaxData({ ...taxData, enabled: e.target.checked })}
                                        className="settings-checkbox-input w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                                    />
                                    <span className="settings-label-strong font-medium text-neutral-700">Enable Default Tax on Transactions</span>
                                </label>
                            </div>

                            {taxData.enabled && (
                                <>
                                    <div className="mb-4">
                                        <label className="form-label">Default Tax Rate (%)</label>
                                        <Input
                                            type="number"
                                            value={taxData.defaultRate}
                                            onChange={(e) => setTaxData((prev) => ({ ...prev, defaultRate: Number(e.target.value) }))}
                                            placeholder="e.g. 11 for PPN 11"
                                        />
                                    </div>
                                    <div className="mb-4">
                                        <label className="form-label settings-checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={taxData.inclusiveByDefault}
                                                onChange={(e) => setTaxData({ ...taxData, inclusiveByDefault: e.target.checked })}
                                                className="settings-checkbox-input w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                                            />
                                            <span className="settings-label-strong font-medium text-neutral-700">Tax is Inclusive by Default</span>
                                        </label>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="settings-save-wrap">
                            <Button text="Save Changes" variant="primary" icon={<Save size={16} />} onClick={() => saveSection('general')} />
                        </div>
                    </Card>
                )}

                {activeTab === 'customers' && (
                    <Card title="Customer & Credit Settings">
                        <h3 className="settings-section-title">Credit Limit Configuration</h3>

                        <div className="mb-4">
                            <label className="form-label settings-label-strong">Master Credit Limit (Default)</label>
                            <div className="settings-help-text">
                                This value will be applied to new customers who use the master setting.
                            </div>
                            <Input
                                type="number"
                                value={creditLimitSettings.defaultLimit}
                                onChange={(e) => setCreditLimitSettings({ ...creditLimitSettings, defaultLimit: e.target.value })}
                            />
                        </div>

                        <div className="mb-4">
                            <label className="form-label settings-label-strong">Master Credit Terms (Days)</label>
                            <div className="settings-help-text">
                                New customers using the master setting will start with these payment terms.
                            </div>
                            <Input
                                type="number"
                                value={creditLimitSettings.defaultPaymentTerms}
                                onChange={(e) => setCreditLimitSettings({ ...creditLimitSettings, defaultPaymentTerms: e.target.value })}
                            />
                        </div>

                        <div className="settings-help-text mt-2 mb-4">
                            Looking for the credit-limit and sales-policy rules? They live under <span className="settings-label-strong">Restrictions</span> now.
                        </div>

                        <div className="settings-save-wrap">
                            <Button text="Save Changes" variant="primary" icon={<Save size={16} />} onClick={() => saveSection('customers')} />
                        </div>
                    </Card>
                )}

                {activeTab === 'features' && (
                    <Card title="Features">
                        <p className="settings-muted">
                            Turn whole modules on or off. Disabled modules disappear from the sidebar for everyone in the organization. Re-enable any time.
                        </p>

                        <h3 className="settings-section-title mt-4">Sales</h3>
                        <FeatureRow label="Sales Orders"           checked={features.salesOrders}        onChange={(v) => setFeatures({ ...features, salesOrders: v })} />
                        <FeatureRow label="Sales Returns"          checked={features.salesReturns}       onChange={(v) => setFeatures({ ...features, salesReturns: v })} />
                        <FeatureRow label="Recurring Billing (customer invoices & subscriptions)" checked={features.recurringInvoices}  onChange={(v) => setFeatures({ ...features, recurringInvoices: v })} />
                        <FeatureRow label="Recurring Expenses (vendor subscriptions you pay)"      checked={features.recurringExpenses ?? true} onChange={(v) => setFeatures({ ...features, recurringExpenses: v })} />
                        <FeatureRow label="Delivery Notes"         checked={features.deliveryNotes}      onChange={(v) => setFeatures({ ...features, deliveryNotes: v })} />
                        <FeatureRow label="Customer Categories"    checked={features.customerCategories} onChange={(v) => setFeatures({ ...features, customerCategories: v })} />
                        <FeatureRow label="Approvals"              checked={features.approvals}          onChange={(v) => setFeatures({ ...features, approvals: v })} />
                        <FeatureRow label="Shop Integrations"      checked={features.shopIntegrations}   onChange={(v) => setFeatures({ ...features, shopIntegrations: v })} />

                        <h3 className="settings-section-title mt-6">Purchases</h3>
                        <FeatureRow label="Purchase Orders"        checked={features.purchaseOrders}    onChange={(v) => setFeatures({ ...features, purchaseOrders: v })} />
                        <FeatureRow label="Vendor Categories"      checked={features.vendorCategories}  onChange={(v) => setFeatures({ ...features, vendorCategories: v })} />

                        <h3 className="settings-section-title mt-6">Inventory &amp; Other</h3>
                        <FeatureRow label="Item Categories"        checked={features.itemCategories}    onChange={(v) => setFeatures({ ...features, itemCategories: v })} />
                        <FeatureRow label="Fixed Assets"           checked={features.fixedAssets}       onChange={(v) => setFeatures({ ...features, fixedAssets: v })} />
                        <FeatureRow label="HR &amp; Payroll"       checked={features.hrPayroll}         onChange={(v) => setFeatures({ ...features, hrPayroll: v })} />
                        <FeatureRow label="Tax (PPN)"              checked={taxData.enabled}            onChange={(v) => setTaxData({ ...taxData, enabled: v })} hint="Mirrors Company Info → Tax Settings."  />

                        <div className="settings-save-wrap">
                            <Button text="Save Changes" variant="primary" icon={<Save size={16} />} onClick={() => saveSection('features')} />
                        </div>
                    </Card>
                )}

                {activeTab === 'restrictions' && (
                    <Card title="Org-wide Restrictions">
                        <p className="settings-muted">
                            Rules that apply across the whole organization. Users with the matching role override flag (under Security &amp; Roles) can bypass each rule.
                        </p>

                        <h3 className="settings-section-title mt-4">Customer &amp; Credit</h3>
                        <div className="mb-4">
                            <label className="form-label settings-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={creditLimitSettings.enforceLimit}
                                    onChange={(e) => setCreditLimitSettings({ ...creditLimitSettings, enforceLimit: e.target.checked })}
                                    className="settings-checkbox-input"
                                />
                                <span className="settings-label-strong">Enforce Credit Limit validation on invoices</span>
                            </label>
                        </div>

                        <h3 className="settings-section-title mt-6">Sales Policies</h3>
                        <div className="mb-4">
                            <label className="form-label settings-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={salesPolicy.blockSellBelowCost}
                                    onChange={(e) => setSalesPolicy({ ...salesPolicy, blockSellBelowCost: e.target.checked })}
                                    className="settings-checkbox-input"
                                />
                                <span className="settings-label-strong">Block selling below product cost</span>
                            </label>
                        </div>
                        <div className="mb-4">
                            <label className="form-label settings-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={salesPolicy.requireSalesOrder}
                                    onChange={(e) => setSalesPolicy({ ...salesPolicy, requireSalesOrder: e.target.checked })}
                                    className="settings-checkbox-input"
                                />
                                <span className="settings-label-strong">Require Sales Order before creating Invoice</span>
                            </label>
                        </div>

                        <div className="settings-save-wrap">
                            <Button text="Save Changes" variant="primary" icon={<Save size={16} />} onClick={() => saveSection('restrictions')} />
                        </div>
                    </Card>
                )}

                {activeTab === 'approvals' && (
                    <Card title="Approval Requirements">
                        <p className="settings-muted">
                            Pick which modules require approval before create/edit operations take effect. Pending records appear in the Approval Inbox under Sales.
                        </p>
                        <div className="settings-help-text mt-1 mb-3">
                            Note: Phase 1 — these toggles persist your selection. Save-time enforcement in each form is rolled out per module.
                        </div>

                        <h3 className="settings-section-title mt-4">Accounts Receivable</h3>
                        <ApprovalRow label="Sales Orders"       checked={approvalRequirements.ar_sales_orders} onChange={(v) => setApprovalRequirements({ ...approvalRequirements, ar_sales_orders: v })} />
                        <ApprovalRow label="Invoices"           checked={approvalRequirements.ar_invoices}     onChange={(v) => setApprovalRequirements({ ...approvalRequirements, ar_invoices: v })} />
                        <ApprovalRow label="Receive Payments"   checked={approvalRequirements.ar_payments}     onChange={(v) => setApprovalRequirements({ ...approvalRequirements, ar_payments: v })} />
                        <ApprovalRow label="Returns &amp; Credits" checked={approvalRequirements.ar_credits}   onChange={(v) => setApprovalRequirements({ ...approvalRequirements, ar_credits: v })} />

                        <h3 className="settings-section-title mt-6">Accounts Payable</h3>
                        <ApprovalRow label="Purchase Orders"    checked={approvalRequirements.ap_pos}      onChange={(v) => setApprovalRequirements({ ...approvalRequirements, ap_pos: v })} />
                        <ApprovalRow label="Bills"              checked={approvalRequirements.ap_bills}    onChange={(v) => setApprovalRequirements({ ...approvalRequirements, ap_bills: v })} />
                        <ApprovalRow label="Send Payments"      checked={approvalRequirements.ap_payments} onChange={(v) => setApprovalRequirements({ ...approvalRequirements, ap_payments: v })} />
                        <ApprovalRow label="Returns &amp; Debits" checked={approvalRequirements.ap_debits} onChange={(v) => setApprovalRequirements({ ...approvalRequirements, ap_debits: v })} />

                        <h3 className="settings-section-title mt-6">Inventory &amp; HR</h3>
                        <ApprovalRow label="Stock Adjustments"  checked={approvalRequirements.inv_adj}    onChange={(v) => setApprovalRequirements({ ...approvalRequirements, inv_adj: v })} />
                        <ApprovalRow label="Payroll Runs"       checked={approvalRequirements.hr_payroll} onChange={(v) => setApprovalRequirements({ ...approvalRequirements, hr_payroll: v })} />

                        <div className="settings-save-wrap">
                            <Button text="Save Changes" variant="primary" icon={<Save size={16} />} onClick={() => saveSection('approvals')} />
                        </div>
                    </Card>
                )}

                {activeTab === 'numbering' && (
                    <Card title="Document Numbering">
                        <p className="text-sm text-neutral-600 mb-6">Configure auto-numbering format for each document type.</p>
                        <div className="space-y-4">
                            {[
                                { key: 'ar_invoice',  label: 'Sales Invoice' },
                                { key: 'ap_bill',     label: 'Purchase Bill' },
                                { key: 'so_order',    label: 'Sales Order' },
                                { key: 'po_order',    label: 'Purchase Order' },
                                { key: 'ar_payment',  label: 'AR Payment' },
                                { key: 'ap_payment',  label: 'AP Payment' },
                            ].map(({ key, label }) => {
                                const cfg = documentNumbering[key] || {};
                                return (
                                    <div key={key} className="grid grid-cols-12 gap-3 items-end pb-4 border-b border-neutral-100 last:border-0 last:pb-0">
                                        <div className="col-span-3">
                                            <div className="text-sm font-semibold text-neutral-700">{label}</div>
                                            <div className="text-xs text-neutral-500 mt-0.5">
                                                Preview: {cfg.prefix}/{new Date().getFullYear()}/{String(new Date().getMonth()+1).padStart(2,'0')}/{String(1).padStart(cfg.seqLength || 6, '0')}
                                            </div>
                                        </div>
                                        <div className="col-span-3">
                                            <label className="form-label">Prefix</label>
                                            <Input
                                                value={cfg.prefix || ''}
                                                onChange={(e) => updateDocumentNumbering(key, { prefix: e.target.value.toUpperCase() })}
                                                placeholder="e.g. INV"
                                                inputClassName="font-mono uppercase"
                                            />
                                        </div>
                                        <div className="col-span-3">
                                            <label className="form-label">Reset Period</label>
                                            <select
                                                className="block w-full px-3 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                                                value={cfg.resetPeriod || 'monthly'}
                                                onChange={(e) => updateDocumentNumbering(key, { resetPeriod: e.target.value })}
                                            >
                                                <option value="monthly">Monthly</option>
                                                <option value="yearly">Yearly</option>
                                                <option value="never">Never reset</option>
                                            </select>
                                        </div>
                                        <div className="col-span-3">
                                            <label className="form-label">Sequence Length</label>
                                            <select
                                                className="block w-full px-3 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                                                value={cfg.seqLength || 6}
                                                onChange={(e) => updateDocumentNumbering(key, { seqLength: Number(e.target.value) })}
                                            >
                                                <option value={4}>4 digits</option>
                                                <option value={5}>5 digits</option>
                                                <option value={6}>6 digits</option>
                                                <option value={8}>8 digits</option>
                                            </select>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                )}

                {activeTab === 'accounts' && (
                    <Card title="Account Defaults">
                        <p className="text-sm text-neutral-600 mb-6">
                            Configure default Chart of Accounts mappings used by AR, AP, inventory, and settlement flows.
                        </p>
                        <div className="space-y-4">
                            {Object.entries(ACCOUNT_DEFAULT_SPECS).map(([key, spec]) => {
                                const options = chartOfAccounts.filter((account) => (
                                    account.isActive &&
                                    account.isPostable &&
                                    (spec.allowedTypes as readonly string[]).includes(account.type)
                                ));

                                return (
                                    <div key={key} className="grid grid-cols-12 gap-3 items-start pb-4 border-b border-neutral-100 last:border-0 last:pb-0">
                                        <div className="col-span-4">
                                            <div className="text-sm font-semibold text-neutral-700">{spec.label}</div>
                                            <div className="text-xs text-neutral-500 mt-1">{spec.description}</div>
                                        </div>
                                        <div className="col-span-8">
                                            <label className="form-label">Default Account</label>
                                            <select
                                                className="block w-full px-3 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                                                value={(accountDefaults as Record<string, string>)[key] || ''}
                                                onChange={(e) => setAccountDefaults((prev) => ({ ...prev, [key as AccountDefaultKey]: e.target.value }))}
                                            >
                                                <option value="">Auto-detect from COA</option>
                                                {options.map((account) => (
                                                    <option key={account.id} value={account.id}>
                                                        {account.code} - {account.name}
                                                    </option>
                                                ))}
                                            </select>
                                            <div className="text-xs text-neutral-500 mt-1">
                                                Allowed types: {spec.allowedTypes.join(', ')}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="settings-save-wrap">
                            <Button text="Save Changes" variant="primary" icon={<Save size={16} />} onClick={() => saveSection('accounts')} />
                        </div>
                    </Card>
                )}

                {activeTab === 'security' && (
                    <SecurityRolesTab
                        securitySettings={securitySettings}
                        setSecuritySettings={setSecuritySettings}
                        onSave={() => saveSection('security')}
                    />
                )}

                {activeTab === 'notifications' && (
                    <Card title="Notifications">
                        <p className="settings-muted">Configure finance-related alerts and email routing.</p>
                        <div className="mb-4">
                            <label className="form-label">Finance Notification Email</label>
                            <Input
                                type="email"
                                value={notificationSettings.financeEmail}
                                onChange={(e) => setNotificationSettings((prev) => ({ ...prev, financeEmail: e.target.value }))}
                            />
                        </div>
                        <div className="mb-4">
                            <label className="form-label settings-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={notificationSettings.invoiceReminders}
                                    onChange={(e) => setNotificationSettings((prev) => ({ ...prev, invoiceReminders: e.target.checked }))}
                                    className="settings-checkbox-input"
                                />
                                <span className="settings-label-strong">Send invoice due reminders</span>
                            </label>
                        </div>
                        <div className="mb-4">
                            <label className="form-label settings-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={notificationSettings.paymentAlerts}
                                    onChange={(e) => setNotificationSettings((prev) => ({ ...prev, paymentAlerts: e.target.checked }))}
                                    className="settings-checkbox-input"
                                />
                                <span className="settings-label-strong">Send payment posted alerts</span>
                            </label>
                        </div>
                        <div className="mb-4">
                            <label className="form-label settings-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={notificationSettings.dailySummary}
                                    onChange={(e) => setNotificationSettings((prev) => ({ ...prev, dailySummary: e.target.checked }))}
                                    className="settings-checkbox-input"
                                />
                                <span className="settings-label-strong">Send daily summary digest</span>
                            </label>
                        </div>
                        <div className="settings-save-wrap">
                            <Button text="Save Changes" variant="primary" icon={<Save size={16} />} onClick={() => saveSection('notifications')} />
                        </div>
                    </Card>
                )}

                {activeTab === 'audit' && (
                    <Card title="Audit Log">
                        <p className="settings-muted">Riwayat seluruh perubahan data — siapa mengubah apa dan kapan.</p>
                        <AuditLogPanel />
                    </Card>
                )}

                {activeTab === 'migration' && (
                    <Card title="Migrasi Data">
                        <p className="settings-muted">Pindahkan data dari localStorage (versi lama) ke database PostgreSQL.</p>
                        <DataMigrationPanel />
                    </Card>
                )}

                {activeTab === 'email-templates' && (
                    <EmailTemplates />
                )}

                {activeTab === 'csv-import' && (
                    <Card title="CSV Import">
                        <p className="settings-muted mb-4">Bulk-import customers, vendors, items, or chart of accounts from a CSV file. Download the template, fill in your data, then upload.</p>
                        <CsvImportPanel />
                    </Card>
                )}
            </div>
        </div>
    );
};

export default Settings;

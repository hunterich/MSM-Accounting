import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Input from '../../components/UI/Input';
import { Save, Briefcase, Building2, User, Bell, Hash, Mail, ToggleLeft, Lock, ClipboardCheck, Printer } from 'lucide-react';
import InvoicePrintTemplate from '../../components/print/InvoicePrintTemplate';
import EmailTemplates from './EmailTemplates';
import Companies from './Companies';
import { useAuthStore } from '../../stores/useAuthStore';
import { useSettingsStore, DEFAULT_DOCUMENT_NUMBERING } from '../../stores/useSettingsStore';
import { useChartOfAccounts } from '../../hooks/useGL';
import { useAccountDefaults, useOrganizationSettings, useUpdateOrganizationSettings } from '../../hooks/useOrganizationSettings';
import { ACCOUNT_DEFAULT_SPECS, DEFAULT_ACCOUNT_DEFAULTS } from '../../../lib/account-defaults';
import type { AccountDefaultKey } from '../../../lib/account-defaults';
import type { LucideIcon } from 'lucide-react';

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

interface MenuGroup {
    label: string;
    items: MenuItem[];
}

// Grouped settings navigation. Data-management tools (audit log, migration,
// CSV import, backup) deliberately live on the separate /tools page — this
// rail is configuration only.
const MENU_GROUPS: MenuGroup[] = [
    {
        label: 'Organization',
        items: [
            { id: 'general', label: 'Company Info', icon: Briefcase },
            // 'companies' is ADMIN-only — filtered out per-user inside the component.
            { id: 'companies', label: 'Companies', icon: Building2 },
            { id: 'accounts', label: 'Account Defaults', icon: Briefcase },
            { id: 'numbering', label: 'Document Numbering', icon: Hash },
            { id: 'features', label: 'Features', icon: ToggleLeft },
        ],
    },
    {
        label: 'Sales & purchasing',
        items: [
            { id: 'customers', label: 'Customers & Sales', icon: User },
            { id: 'restrictions', label: 'Restrictions', icon: Lock },
            { id: 'approvals', label: 'Approval Rules', icon: ClipboardCheck },
        ],
    },
    {
        label: 'Branding & templates',
        items: [
            { id: 'print', label: 'Print & Branding', icon: Printer },
            { id: 'email-templates', label: 'Email Templates', icon: Mail },
        ],
    },
    {
        label: 'Notifications',
        items: [
            { id: 'notifications', label: 'Notifications', icon: Bell },
        ],
    },
];

const ALL_MENU_ITEMS: MenuItem[] = MENU_GROUPS.flatMap((g) => g.items);
const VALID_TAB_IDS = new Set(ALL_MENU_ITEMS.map((i) => i.id));

const Settings = () => {
    // Active tab is driven by the ?tab= query param so it's deep-linkable and
    // bookmarkable. Defaults to Company Info; unknown ids fall back to it too.
    const [searchParams, setSearchParams] = useSearchParams();
    // Companies (multi-company management) is an owner capability — only
    // administrators see the tab, and deep links fall back for everyone else.
    const roleType = useAuthStore((s) => s.roleType);
    const isAdmin = roleType === 'ADMIN';
    const menuGroups = isAdmin
        ? MENU_GROUPS
        : MENU_GROUPS
            .map((group) => ({ ...group, items: group.items.filter((item) => item.id !== 'companies') }))
            .filter((group) => group.items.length > 0);
    const rawTab = searchParams.get('tab') || 'general';
    const activeTab = VALID_TAB_IDS.has(rawTab) && (rawTab !== 'companies' || isAdmin) ? rawTab : 'general';
    const setActiveTab = (id: string) => setSearchParams(id === 'general' ? {} : { tab: id });
    const storeCompanyInfo = useSettingsStore(s => s.companyInfo);
    const storeTaxSettings = useSettingsStore(s => s.taxSettings);
    const storeCustomerCreditSettings = useSettingsStore(s => s.customerCreditSettings);
    const storeSalesPolicy = useSettingsStore(s => s.salesPolicy);
    const storeFeatures = useSettingsStore(s => s.features);
    const storeApprovalRequirements = useSettingsStore(s => s.approvalRequirements);
    const storeAccountDefaults = useSettingsStore(s => s.accountDefaults ?? DEFAULT_ACCOUNT_DEFAULTS);
    const storePrintSettings = useSettingsStore(s => s.printSettings);
    const updatePrintSettings = useSettingsStore(s => s.updatePrintSettings);
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
    const { data: serverOrgSettings } = useOrganizationSettings();
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
    const [requireDistinctApproverForAdmins, setRequireDistinctApproverForAdmins] = useState(false);
    const [accountDefaults, setAccountDefaults] = useState(storeAccountDefaults);
    const [printForm, setPrintForm] = useState(storePrintSettings);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);
    // Draft copy of document numbering — edits stay local until Save, so this
    // tab behaves like every other tab instead of writing on each keystroke.
    const [numberingForm, setNumberingForm] = useState(documentNumbering);
    useEffect(() => { setNumberingForm(documentNumbering); }, [documentNumbering]);

    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) { window.alert('Please choose an image file (PNG or JPG).'); return; }
        if (file.size > 500 * 1024) { window.alert('Logo is larger than 500 KB. Please use a smaller image.'); return; }
        const reader = new FileReader();
        reader.onload = () => setLogoPreview(typeof reader.result === 'string' ? reader.result : null);
        reader.readAsDataURL(file);
    };

    // Keep the Print tab form in sync once org-backed print settings hydrate.
    useEffect(() => { setPrintForm(storePrintSettings); }, [storePrintSettings]);

    // Hydrate from server-of-truth (DB) when org settings load. Falls back to
    // Zustand cache for first paint to avoid flicker. Server values overwrite
    // local state on every fetch.
    useEffect(() => {
      if (!serverAccountDefaults) return;
      if (Object.keys(serverAccountDefaults).length === 0) return;
      setAccountDefaults((prev) => ({ ...prev, ...serverAccountDefaults }));
    }, [serverAccountDefaults]);

    // Seed approval settings from the server (DB is the source of truth).
    useEffect(() => {
      if (!serverOrgSettings) return;
      setApprovalRequirements((prev) => ({ ...prev, ...serverOrgSettings.approvalRequirements }));
      setRequireDistinctApproverForAdmins(serverOrgSettings.requireDistinctApproverForAdmins);
    }, [serverOrgSettings]);

    // Seed the remaining tabs from the server ONCE (DB is the source of truth).
    // Guarded so a post-save query invalidation or a background refetch can't
    // clobber unsaved edits the user has typed into another tab.
    const hydratedFromServer = useRef(false);
    useEffect(() => {
      if (!serverOrgSettings || hydratedFromServer.current) return;
      hydratedFromServer.current = true;
      const s = serverOrgSettings;
      setTaxData({ enabled: s.taxEnabled, defaultRate: s.taxDefaultRate, inclusiveByDefault: s.taxInclusiveByDefault });
      setCreditLimitSettings({
        defaultLimit: String(s.defaultCreditLimit),
        defaultPaymentTerms: String(s.defaultPaymentTerms),
        enforceLimit: s.enforceCreditLimit,
      });
      setSalesPolicy(s.salesPolicy);
      setFeatures((prev) => ({ ...prev, ...s.features }));
      setNumberingForm((prev) => ({ ...prev, ...s.documentNumbering }));
      setNotificationSettings({
        financeEmail: s.financeEmail || '',
        invoiceReminders: s.invoiceReminders,
        paymentAlerts: s.paymentAlerts,
        dailySummary: s.dailySummary,
      });
    }, [serverOrgSettings]);
    const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>({
        financeEmail: 'finance@msm-accounting.local',
        invoiceReminders: true,
        paymentAlerts: true,
        dailySummary: false
    });
    const [lastSavedTab, setLastSavedTab] = useState('');

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
            if (taxData.enabled && (isNaN(Number(taxData.defaultRate)) || Number(taxData.defaultRate) < 0 || Number(taxData.defaultRate) > 100)) {
                window.alert('Tax rate must be between 0 and 100.');
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
                    taxEnabled: taxData.enabled,
                    taxDefaultRate: taxData.defaultRate,
                    taxInclusiveByDefault: taxData.inclusiveByDefault,
                } as Parameters<typeof updateOrgSettings.mutateAsync>[0]);
            } catch (e) {
                window.alert(`Failed to save company info: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
            updateCompanyInfo(generalSettings);
            updateTaxSettings(taxData);
        }

        if (sectionId === 'customers') {
            const defaultLimit = Number(creditLimitSettings.defaultLimit);
            const defaultPaymentTerms = Number(creditLimitSettings.defaultPaymentTerms);
            if (isNaN(defaultLimit) || defaultLimit < 0) { window.alert('Default credit limit must be a non-negative number.'); return; }
            if (isNaN(defaultPaymentTerms) || defaultPaymentTerms < 0) { window.alert('Default credit terms must be a non-negative number of days.'); return; }
            try {
                await updateOrgSettings.mutateAsync({
                    defaultCreditLimit: defaultLimit,
                    defaultPaymentTerms,
                    enforceCreditLimit: creditLimitSettings.enforceLimit,
                } as Parameters<typeof updateOrgSettings.mutateAsync>[0]);
            } catch (e) {
                window.alert(`Failed to save credit settings: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
            updateCustomerCreditSettings({ defaultLimit, defaultPaymentTerms, enforceLimit: creditLimitSettings.enforceLimit });
        }

        if (sectionId === 'features') {
            try {
                await updateOrgSettings.mutateAsync({ features: features as unknown as Record<string, boolean> } as Parameters<typeof updateOrgSettings.mutateAsync>[0]);
            } catch (e) {
                window.alert(`Failed to save features: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
            updateFeatures(features);
        }

        if (sectionId === 'restrictions') {
            try {
                await updateOrgSettings.mutateAsync({ salesPolicy } as Parameters<typeof updateOrgSettings.mutateAsync>[0]);
            } catch (e) {
                window.alert(`Failed to save sales policies: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
            updateSalesPolicy(salesPolicy);
        }

        if (sectionId === 'approvals') {
            try {
                await updateOrgSettings.mutateAsync({
                    approvalRequirements,
                    requireDistinctApproverForAdmins,
                });
                updateApprovalRequirements(approvalRequirements);
            } catch (e) {
                window.alert(`Failed to save approval settings: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
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

        if (sectionId === 'print') {
            // Print settings live on the org (DB is source of truth, shared across
            // devices), then mirror into the local store for instant rendering.
            try {
                const body = { printSettings: printForm, ...(logoPreview ? { logoUrl: logoPreview } : {}) };
                await updateOrgSettings.mutateAsync(body as Parameters<typeof updateOrgSettings.mutateAsync>[0]);
                updatePrintSettings(printForm);
                if (logoPreview) { updateCompanyInfo({ logoUrl: logoPreview }); setLogoPreview(null); }
            } catch (e) {
                window.alert(`Failed to save print settings: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
        }

        if (sectionId === 'notifications') {
            const requiresEmail = notificationSettings.invoiceReminders || notificationSettings.paymentAlerts || notificationSettings.dailySummary;
            if (requiresEmail && !notificationSettings.financeEmail.includes('@')) { window.alert('Enter a valid finance notification email.'); return; }
            try {
                await updateOrgSettings.mutateAsync({
                    financeEmail: notificationSettings.financeEmail,
                    invoiceReminders: notificationSettings.invoiceReminders,
                    paymentAlerts: notificationSettings.paymentAlerts,
                    dailySummary: notificationSettings.dailySummary,
                } as Parameters<typeof updateOrgSettings.mutateAsync>[0]);
            } catch (e) {
                window.alert(`Failed to save notifications: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
        }

        if (sectionId === 'numbering') {
            try {
                await updateOrgSettings.mutateAsync({ documentNumbering: numberingForm } as Parameters<typeof updateOrgSettings.mutateAsync>[0]);
            } catch (e) {
                window.alert(`Failed to save document numbering: ${e instanceof Error ? e.message : 'Unknown error'}`);
                return;
            }
            Object.entries(numberingForm).forEach(([k, v]) => updateDocumentNumbering(k, v));
        }

        setLastSavedTab(sectionId);
    };

    return (
        <div className="container settings-module settings-layout">

            {/* Sidebar Navigation */}
            <div>
                <h2 className="settings-title">Settings</h2>
                <div className="settings-nav-list">
                    {menuGroups.map(group => (
                        <React.Fragment key={group.label}>
                            <div className="settings-nav-group-label">{group.label}</div>
                            {group.items.map(item => {
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
                        </React.Fragment>
                    ))}
                </div>
            </div>

            {/* Content Area */}
            <div>
                <div className="settings-content-title-wrap">
                    <h1 className="settings-content-title">
                        {ALL_MENU_ITEMS.find(i => i.id === activeTab)?.label || 'Settings'}
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

                        <div className="mb-4">
                            <label className="form-label settings-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={creditLimitSettings.enforceLimit}
                                    onChange={(e) => setCreditLimitSettings({ ...creditLimitSettings, enforceLimit: e.target.checked })}
                                    className="settings-checkbox-input"
                                />
                                <span className="settings-label-strong">Enforce credit limit on invoices</span>
                            </label>
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

                        <h3 className="settings-section-title mt-4">Sales Policies</h3>
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

                        <h3 className="settings-section-title mt-6">Admin Approver Policy</h3>
                        <div className="mb-3">
                            <label className="form-label settings-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={requireDistinctApproverForAdmins}
                                    onChange={(e) => setRequireDistinctApproverForAdmins(e.target.checked)}
                                    className="settings-checkbox-input"
                                />
                                <span className="settings-label-strong">Require a different approver even for admins</span>
                            </label>
                            <div className="settings-help-text ml-6">
                                By default, admins may approve their own documents. Turn this on to require someone else to approve, even for admin users.
                            </div>
                        </div>

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
                                const cfg = numberingForm[key] || {};
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
                                                onChange={(e) => setNumberingForm((prev) => ({ ...prev, [key]: { ...prev[key], prefix: e.target.value.toUpperCase() } }))}
                                                placeholder="e.g. INV"
                                                inputClassName="font-mono uppercase"
                                            />
                                        </div>
                                        <div className="col-span-3">
                                            <label className="form-label">Reset Period</label>
                                            <select
                                                className="block w-full px-3 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                                                value={cfg.resetPeriod || 'monthly'}
                                                onChange={(e) => setNumberingForm((prev) => ({ ...prev, [key]: { ...prev[key], resetPeriod: e.target.value } }))}
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
                                                onChange={(e) => setNumberingForm((prev) => ({ ...prev, [key]: { ...prev[key], seqLength: Number(e.target.value) } }))}
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
                        <div className="settings-save-wrap">
                            <Button text="Save Changes" variant="primary" icon={<Save size={16} />} onClick={() => saveSection('numbering')} />
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

                {activeTab === 'print' && (
                    <Card title="Print & Branding">
                        <p className="settings-muted">Customize how printed documents (invoices, receipts, delivery notes, etc.) look. Changes preview live and apply to every document.</p>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* ── Controls ─────────────────────────────────── */}
                            <div className="space-y-4">
                                <div>
                                    <label className="form-label">Company logo</label>
                                    <div className="flex items-center gap-3">
                                        <div className="h-12 w-12 rounded border border-neutral-300 bg-neutral-50 flex items-center justify-center overflow-hidden">
                                            {(logoPreview ?? storeCompanyInfo.logoUrl)
                                                ? <img src={logoPreview ?? storeCompanyInfo.logoUrl} alt="Logo" className="max-h-12 max-w-12 object-contain" />
                                                : <span className="text-neutral-400 text-xs">None</span>}
                                        </div>
                                        <label className="inline-flex items-center px-3 h-10 rounded-md border border-neutral-300 bg-neutral-0 text-sm font-medium cursor-pointer hover:bg-neutral-100">
                                            Upload logo…
                                            <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleLogoUpload} />
                                        </label>
                                    </div>
                                    <p className="settings-muted mt-1">PNG or JPG, up to 500&nbsp;KB. Saved with this book.</p>
                                </div>
                                <div>
                                    <label className="form-label">Brand accent color</label>
                                    <div className="flex items-center gap-3">
                                        <input type="color" value={printForm.accentColor} onChange={(e) => setPrintForm((p) => ({ ...p, accentColor: e.target.value }))} className="h-10 w-14 rounded border border-neutral-300 bg-neutral-0 p-1" />
                                        <Input value={printForm.accentColor} onChange={(e) => setPrintForm((p) => ({ ...p, accentColor: e.target.value }))} />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="form-label">Density</label>
                                        <select className="block w-full px-3 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0" value={printForm.density} onChange={(e) => setPrintForm((p) => ({ ...p, density: e.target.value as typeof p.density }))}>
                                            <option value="compact">Compact</option>
                                            <option value="comfortable">Comfortable</option>
                                            <option value="spacious">Spacious</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="form-label">Default paper size</label>
                                        <select className="block w-full px-3 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0" value={printForm.defaultPaperSize} onChange={(e) => setPrintForm((p) => ({ ...p, defaultPaperSize: e.target.value as typeof p.defaultPaperSize }))}>
                                            <option value="A4">A4</option>
                                            <option value="A5">A5</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <label className="settings-checkbox-label"><input type="checkbox" className="settings-checkbox-input" checked={printForm.showLogo} onChange={(e) => setPrintForm((p) => ({ ...p, showLogo: e.target.checked }))} /><span className="settings-label-strong">Show logo</span></label>
                                    <label className="settings-checkbox-label"><input type="checkbox" className="settings-checkbox-input" checked={printForm.showLetterhead} onChange={(e) => setPrintForm((p) => ({ ...p, showLetterhead: e.target.checked }))} /><span className="settings-label-strong">Letterhead band</span></label>
                                    <label className="settings-checkbox-label"><input type="checkbox" className="settings-checkbox-input" checked={printForm.showUnitColumn} onChange={(e) => setPrintForm((p) => ({ ...p, showUnitColumn: e.target.checked }))} /><span className="settings-label-strong">Unit column</span></label>
                                    <label className="settings-checkbox-label"><input type="checkbox" className="settings-checkbox-input" checked={printForm.showDiscountColumn} onChange={(e) => setPrintForm((p) => ({ ...p, showDiscountColumn: e.target.checked }))} /><span className="settings-label-strong">Discount column</span></label>
                                    <label className="settings-checkbox-label"><input type="checkbox" className="settings-checkbox-input" checked={printForm.showSignature} onChange={(e) => setPrintForm((p) => ({ ...p, showSignature: e.target.checked }))} /><span className="settings-label-strong">Signature block</span></label>
                                </div>

                                {printForm.showSignature && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="form-label">Signature label</label>
                                            <Input value={printForm.signatureLabel} placeholder="Hormat kami," onChange={(e) => setPrintForm((p) => ({ ...p, signatureLabel: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label className="form-label">Signer name</label>
                                            <Input value={printForm.signerName} placeholder="(optional)" onChange={(e) => setPrintForm((p) => ({ ...p, signerName: e.target.value }))} />
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <label className="form-label">Terms &amp; conditions</label>
                                    <textarea className="block w-full px-3 py-2 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0" rows={2} value={printForm.termsText} placeholder="e.g. Pembayaran dalam 30 hari. Barang yang sudah dibeli tidak dapat dikembalikan." onChange={(e) => setPrintForm((p) => ({ ...p, termsText: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="form-label">Footer line</label>
                                    <Input value={printForm.footerText} placeholder="e.g. Terima kasih atas kepercayaan Anda." onChange={(e) => setPrintForm((p) => ({ ...p, footerText: e.target.value }))} />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <label className="settings-checkbox-label"><input type="checkbox" className="settings-checkbox-input" checked={printForm.showTerbilang} onChange={(e) => setPrintForm((p) => ({ ...p, showTerbilang: e.target.checked }))} /><span className="settings-label-strong">Terbilang</span></label>
                                    <label className="settings-checkbox-label"><input type="checkbox" className="settings-checkbox-input" checked={printForm.showBankDetails} onChange={(e) => setPrintForm((p) => ({ ...p, showBankDetails: e.target.checked }))} /><span className="settings-label-strong">Bank / payment block</span></label>
                                </div>

                                {printForm.showBankDetails && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="form-label">Bank</label>
                                            <Input value={printForm.bankName} placeholder="e.g. BCA" onChange={(e) => setPrintForm((p) => ({ ...p, bankName: e.target.value }))} />
                                        </div>
                                        <div>
                                            <label className="form-label">Account no.</label>
                                            <Input value={printForm.bankAccountNo} placeholder="e.g. 1234567890" onChange={(e) => setPrintForm((p) => ({ ...p, bankAccountNo: e.target.value }))} />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="form-label">Account name</label>
                                            <Input value={printForm.bankAccountName} placeholder="e.g. PT. Murni Sukses Mandiri" onChange={(e) => setPrintForm((p) => ({ ...p, bankAccountName: e.target.value }))} />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="form-label">Payment note (optional)</label>
                                            <Input value={printForm.paymentNote} placeholder="e.g. Mohon transfer sesuai Sisa Tagihan." onChange={(e) => setPrintForm((p) => ({ ...p, paymentNote: e.target.value }))} />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* ── Live preview ─────────────────────────────── */}
                            <div>
                                <div className="form-label mb-2">Live preview</div>
                                <div style={{ position: 'relative', width: '100%', height: 560, overflow: 'hidden', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f3f4f6' }}>
                                    <div style={{ position: 'absolute', top: 12, left: 12, width: '210mm', transform: 'scale(0.46)', transformOrigin: 'top left', boxShadow: '0 1px 6px rgba(0,0,0,0.12)' }}>
                                        <InvoicePrintTemplate
                                            invoice={{ number: 'INV-2026-00001', customerName: 'PT. Contoh Pelanggan', issueDate: '2026-06-12', dueDate: '2026-07-12', status: 'Unpaid', notes: 'Terima kasih atas kepercayaan Anda.' }}
                                            lineItems={[
                                                { description: 'Jasa Konsultasi', qty: 2, unit: 'JAM', price: 500000, discount: 0 },
                                                { description: 'Lisensi Software', qty: 1, unit: 'PCS', price: 1500000, discount: 10 },
                                            ]}
                                            company={{ ...storeCompanyInfo, logoUrl: logoPreview ?? storeCompanyInfo.logoUrl } as unknown as Record<string, unknown>}
                                            taxRate={storeTaxSettings.defaultRate}
                                            options={printForm}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="settings-save-wrap">
                            <Button text="Save Changes" variant="primary" icon={<Save size={16} />} onClick={() => saveSection('print')} />
                        </div>
                    </Card>
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

                {activeTab === 'email-templates' && (
                    <EmailTemplates />
                )}

                {activeTab === 'companies' && (
                    <Companies />
                )}
            </div>
        </div>
    );
};

export default Settings;

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_WIDGET_IDS } from '../config/dashboardWidgets';
import {
    DEFAULT_ACCOUNT_DEFAULTS,
    type AccountDefaultsConfig,
} from '../../lib/account-defaults';

interface DocNumberingConfig {
    prefix:      string;
    resetPeriod: string;
    seqLength:   number;
}

interface CompanyInfo {
    companyName: string;
    address:     string;
    phone:       string;
    email:       string;
    npwp:        string;
    logoUrl:     string;
    timezone:    string;
    locale:      string;
}

interface TaxSettings {
    enabled:            boolean;
    defaultRate:        number;
    inclusiveByDefault: boolean;
}

interface CustomerCreditSettings {
    defaultLimit:        number;
    defaultPaymentTerms: number;
    enforceLimit:        boolean;
}

export interface SalesPolicySettings {
    blockSellBelowCost:    boolean;
    requireSalesOrder:     boolean;
}

/**
 * Org-level feature flags. Each toggle hides the corresponding sidebar item
 * (and its routes for users) when false. Defaults to all-on so existing orgs
 * keep their full UI on upgrade.
 */
export interface FeatureFlags {
    // Sales
    salesOrders:        boolean;
    salesReturns:       boolean;
    recurringInvoices:  boolean;
    subscriptions:      boolean;
    deliveryNotes:      boolean;
    customerCategories: boolean;
    approvals:          boolean;
    shopIntegrations:   boolean;
    // Purchases
    purchaseOrders:     boolean;
    vendorCategories:   boolean;
    // Inventory / Other
    itemCategories:     boolean;
    fixedAssets:        boolean;
    hrPayroll:          boolean;
}

/**
 * Per-module flag for whether create/edit operations require approval before
 * they take effect. Phase 1: configuration only — actual save-time enforcement
 * lives in each module's form (follow-up).
 */
export interface ApprovalRequirements {
    ar_sales_orders: boolean;
    ar_invoices:     boolean;
    ar_payments:     boolean;
    ar_credits:      boolean;
    ap_pos:          boolean;
    ap_bills:        boolean;
    ap_payments:     boolean;
    ap_debits:       boolean;
    inv_adj:         boolean;
    hr_payroll:      boolean;
}

interface SettingsStore {
    companyInfo:              CompanyInfo;
    taxSettings:              TaxSettings;
    customerCreditSettings:   CustomerCreditSettings;
    salesPolicy:              SalesPolicySettings;
    features:                 FeatureFlags;
    approvalRequirements:     ApprovalRequirements;
    accountDefaults:          AccountDefaultsConfig;
    documentNumbering:        Record<string, DocNumberingConfig>;
    dashboardConfig:          Record<string, string[]>;
    setCompanyInfo:           (fields: Partial<CompanyInfo>) => void;
    updateCompanyInfo:        (updates: Partial<CompanyInfo>) => void;
    updateTaxSettings:        (updates: Partial<TaxSettings>) => void;
    updateCustomerCreditSettings:(updates: Partial<CustomerCreditSettings>) => void;
    updateSalesPolicy:        (updates: Partial<SalesPolicySettings>) => void;
    updateFeatures:           (updates: Partial<FeatureFlags>) => void;
    updateApprovalRequirements:(updates: Partial<ApprovalRequirements>) => void;
    updateAccountDefaults:    (updates: Partial<AccountDefaultsConfig>) => void;
    updateDocumentNumbering:  (docType: string, updates: Partial<DocNumberingConfig>) => void;
    getDashboardWidgets:      (userId: string) => string[];
    setDashboardWidgets:      (userId: string, widgetIds: string[]) => void;
}

export const DEFAULT_DOCUMENT_NUMBERING = {
    ar_invoice:  { prefix: 'INV',  resetPeriod: 'monthly', seqLength: 6 },
    ap_bill:     { prefix: 'BILL', resetPeriod: 'monthly', seqLength: 6 },
    so_order:    { prefix: 'SO',   resetPeriod: 'monthly', seqLength: 6 },
    po_order:    { prefix: 'PO',   resetPeriod: 'monthly', seqLength: 6 },
    ar_payment:  { prefix: 'PAY',  resetPeriod: 'never',   seqLength: 6 },
    ap_payment:  { prefix: 'VPAY', resetPeriod: 'never',   seqLength: 6 },
};

const DEFAULT_COMPANY_INFO = {
    companyName: 'PT. Internal Accounting',
    address: '',
    phone: '',
    email: '',
    npwp: '',
    logoUrl: '',
    timezone: 'Asia/Jakarta',
    locale: 'id-ID'
};

const DEFAULT_TAX_SETTINGS = {
    enabled: true,
    defaultRate: 11, // PPN 11%
    inclusiveByDefault: false
};

const DEFAULT_CUSTOMER_CREDIT_SETTINGS = {
    defaultLimit: 5000,
    defaultPaymentTerms: 0,
    enforceLimit: true,
};

const DEFAULT_SALES_POLICY: SalesPolicySettings = {
    blockSellBelowCost: false,
    requireSalesOrder: false,
};

const DEFAULT_FEATURES: FeatureFlags = {
    salesOrders: true,
    salesReturns: true,
    recurringInvoices: true,
    subscriptions: true,
    deliveryNotes: true,
    customerCategories: true,
    approvals: true,
    shopIntegrations: true,
    purchaseOrders: true,
    vendorCategories: true,
    itemCategories: true,
    fixedAssets: true,
    hrPayroll: true,
};

const DEFAULT_APPROVAL_REQUIREMENTS: ApprovalRequirements = {
    ar_sales_orders: false,
    ar_invoices: false,
    ar_payments: false,
    ar_credits: false,
    ap_pos: false,
    ap_bills: false,
    ap_payments: false,
    ap_debits: false,
    inv_adj: false,
    hr_payroll: false,
};

interface PersistedSettingsState {
    companyInfo?: Partial<CompanyInfo>;
    taxSettings?: Partial<TaxSettings>;
    customerCreditSettings?: Partial<CustomerCreditSettings>;
    salesPolicy?: Partial<SalesPolicySettings>;
    features?: Partial<FeatureFlags>;
    approvalRequirements?: Partial<ApprovalRequirements>;
    accountDefaults?: Partial<AccountDefaultsConfig>;
    documentNumbering?: Record<string, Partial<DocNumberingConfig>>;
    dashboardConfig?: Record<string, string[]>;
}

export const useSettingsStore = create<SettingsStore>()(
    persist(
        (set, get) => ({
            companyInfo: DEFAULT_COMPANY_INFO,
            taxSettings: DEFAULT_TAX_SETTINGS,
            customerCreditSettings: DEFAULT_CUSTOMER_CREDIT_SETTINGS,
            salesPolicy: DEFAULT_SALES_POLICY,
            features: DEFAULT_FEATURES,
            approvalRequirements: DEFAULT_APPROVAL_REQUIREMENTS,
            accountDefaults: DEFAULT_ACCOUNT_DEFAULTS,
            documentNumbering: DEFAULT_DOCUMENT_NUMBERING,
            dashboardConfig: {}, // Record<userId, widgetId[]>

            setCompanyInfo: (fields) => {
                set((state) => ({
                    companyInfo: { ...state.companyInfo, ...fields }
                }));
            },
            updateCompanyInfo: (updates) => {
                set((state) => ({
                    companyInfo: { ...state.companyInfo, ...updates }
                }));
            },
            updateTaxSettings: (updates) => {
                set((state) => ({
                    taxSettings: { ...state.taxSettings, ...updates }
                }));
            },
            updateCustomerCreditSettings: (updates) => {
                set((state) => ({
                    customerCreditSettings: { ...state.customerCreditSettings, ...updates }
                }));
            },
            updateSalesPolicy: (updates) => {
                set((state) => ({
                    salesPolicy: { ...state.salesPolicy, ...updates }
                }));
            },
            updateFeatures: (updates) => {
                set((state) => ({
                    features: { ...state.features, ...updates }
                }));
            },
            updateApprovalRequirements: (updates) => {
                set((state) => ({
                    approvalRequirements: { ...state.approvalRequirements, ...updates }
                }));
            },
            updateAccountDefaults: (updates) => {
                set((state) => ({
                    accountDefaults: { ...state.accountDefaults, ...updates }
                }));
            },
            updateDocumentNumbering: (docType, updates) => set(state => ({
                documentNumbering: {
                    ...state.documentNumbering,
                    [docType]: { ...state.documentNumbering[docType], ...updates }
                }
            })),
            getDashboardWidgets: (userId) => {
                return get().dashboardConfig[userId] ?? DEFAULT_WIDGET_IDS;
            },
            setDashboardWidgets: (userId, widgetIds) => {
                set((state) => ({
                    dashboardConfig: { ...state.dashboardConfig, [userId]: widgetIds },
                }));
            },
        }),
        {
            name: 'msm-settings',
            version: 8,
            migrate: (persistedState) => ({
                ...(persistedState as PersistedSettingsState | undefined),
                companyInfo: {
                    ...DEFAULT_COMPANY_INFO,
                    ...((persistedState as PersistedSettingsState | undefined)?.companyInfo || {}),
                },
                taxSettings: {
                    ...DEFAULT_TAX_SETTINGS,
                    ...((persistedState as PersistedSettingsState | undefined)?.taxSettings || {}),
                },
                customerCreditSettings: {
                    ...DEFAULT_CUSTOMER_CREDIT_SETTINGS,
                    ...((persistedState as PersistedSettingsState | undefined)?.customerCreditSettings || {}),
                },
                salesPolicy: {
                    ...DEFAULT_SALES_POLICY,
                    ...((persistedState as PersistedSettingsState | undefined)?.salesPolicy || {}),
                },
                features: {
                    ...DEFAULT_FEATURES,
                    ...((persistedState as PersistedSettingsState | undefined)?.features || {}),
                },
                approvalRequirements: {
                    ...DEFAULT_APPROVAL_REQUIREMENTS,
                    ...((persistedState as PersistedSettingsState | undefined)?.approvalRequirements || {}),
                },
                accountDefaults: {
                    ...DEFAULT_ACCOUNT_DEFAULTS,
                    ...((persistedState as PersistedSettingsState | undefined)?.accountDefaults || {}),
                },
                documentNumbering: {
                    ...DEFAULT_DOCUMENT_NUMBERING,
                    ...((persistedState as PersistedSettingsState | undefined)?.documentNumbering || {}),
                },
            }),
        }
    )
);

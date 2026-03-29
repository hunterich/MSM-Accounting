import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_WIDGET_IDS } from '../config/dashboardWidgets';

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

interface SettingsStore {
    companyInfo:              CompanyInfo;
    taxSettings:              TaxSettings;
    customerCreditSettings:   CustomerCreditSettings;
    documentNumbering:        Record<string, DocNumberingConfig>;
    dashboardConfig:          Record<string, string[]>;
    setCompanyInfo:           (fields: Partial<CompanyInfo>) => void;
    updateCompanyInfo:        (updates: Partial<CompanyInfo>) => void;
    updateTaxSettings:        (updates: Partial<TaxSettings>) => void;
    updateCustomerCreditSettings:(updates: Partial<CustomerCreditSettings>) => void;
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

interface PersistedSettingsState {
    companyInfo?: Partial<CompanyInfo>;
    taxSettings?: Partial<TaxSettings>;
    customerCreditSettings?: Partial<CustomerCreditSettings>;
    documentNumbering?: Record<string, Partial<DocNumberingConfig>>;
    dashboardConfig?: Record<string, string[]>;
}

export const useSettingsStore = create<SettingsStore>()(
    persist(
        (set, get) => ({
            companyInfo: DEFAULT_COMPANY_INFO,
            taxSettings: DEFAULT_TAX_SETTINGS,
            customerCreditSettings: DEFAULT_CUSTOMER_CREDIT_SETTINGS,
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
            version: 5,
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
                documentNumbering: {
                    ...DEFAULT_DOCUMENT_NUMBERING,
                    ...((persistedState as PersistedSettingsState | undefined)?.documentNumbering || {}),
                },
            }),
        }
    )
);

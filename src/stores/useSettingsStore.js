import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_WIDGET_IDS } from '../config/dashboardWidgets';

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

export const useSettingsStore = create(
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
                ...persistedState,
                companyInfo: {
                    ...DEFAULT_COMPANY_INFO,
                    ...(persistedState?.companyInfo || {}),
                },
                taxSettings: {
                    ...DEFAULT_TAX_SETTINGS,
                    ...(persistedState?.taxSettings || {}),
                },
                customerCreditSettings: {
                    ...DEFAULT_CUSTOMER_CREDIT_SETTINGS,
                    ...(persistedState?.customerCreditSettings || {}),
                },
                documentNumbering: {
                    ...DEFAULT_DOCUMENT_NUMBERING,
                    ...(persistedState?.documentNumbering || {}),
                },
            }),
        }
    )
);

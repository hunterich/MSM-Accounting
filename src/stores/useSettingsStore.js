import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_WIDGET_IDS } from '../config/dashboardWidgets';

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

export const useSettingsStore = create(
    persist(
        (set, get) => ({
            companyInfo: DEFAULT_COMPANY_INFO,
            taxSettings: DEFAULT_TAX_SETTINGS,
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
            version: 3,
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
            }),
        }
    )
);

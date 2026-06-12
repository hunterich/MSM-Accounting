import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import type { OrganizationSettings, RawOrganizationSettings } from '../types';
import { useSettingsStore } from '../stores/useSettingsStore';

export const ORG_SETTINGS_KEY = ['organizationSettings'] as const;

function normalizeOrganizationSettings(raw: RawOrganizationSettings & { needsInventoryValuationSetup?: boolean }): OrganizationSettings {
  const rawDefaults = raw.accountDefaults;
  const accountDefaults: Record<string, string> = {};
  if (rawDefaults && typeof rawDefaults === 'object') {
    for (const [k, v] of Object.entries(rawDefaults)) {
      if (typeof v === 'string' && v.length > 0) accountDefaults[k] = v;
    }
  }
  return {
    id: raw.id,
    legalName: raw.legalName || '',
    displayName: raw.displayName || '',
    npwp: raw.npwp || '',
    isPkp: raw.isPkp === true,
    baseCurrency: raw.baseCurrency || 'IDR',
    timezone: raw.timezone || 'Asia/Jakarta',
    locale: raw.locale || 'id-ID',
    address: raw.address || '',
    phone: raw.phone || '',
    companyEmail: raw.companyEmail || '',
    logoUrl: raw.logoUrl || '',
    fiscalYearStart: raw.fiscalYearStart ? String(raw.fiscalYearStart).slice(0, 10) : '',
    costingMethod: raw.costingMethod || '',
    costingMethodSetAt: raw.costingMethodSetAt ? String(raw.costingMethodSetAt) : '',
    costingMethodSetById: raw.costingMethodSetById || '',
    costingMethodEffectiveDate: raw.costingMethodEffectiveDate ? String(raw.costingMethodEffectiveDate).slice(0, 10) : '',
    accountDefaults,
    needsInventoryValuationSetup: raw.needsInventoryValuationSetup === true || !raw.costingMethod,
  };
}

export function useOrganizationSettings() {
  return useQuery({
    queryKey: ORG_SETTINGS_KEY,
    queryFn: () => api.get<RawOrganizationSettings & { needsInventoryValuationSetup?: boolean }>('/api/v1/organization/settings'),
    select: normalizeOrganizationSettings,
    staleTime: 30_000,
  });
}

export function useUpdateOrganizationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<OrganizationSettings> & { costingMethod?: OrganizationSettings['costingMethod'] }) =>
      api.put<RawOrganizationSettings & { needsInventoryValuationSetup?: boolean }>('/api/v1/organization/settings', body),
    onSuccess: (data) => {
      qc.setQueryData(ORG_SETTINGS_KEY, normalizeOrganizationSettings(data));
      qc.invalidateQueries({ queryKey: ORG_SETTINGS_KEY });
    },
  });
}

/**
 * Hydrates the local settings store's `companyInfo` from the organization
 * record so the print header (and Settings form) reflect the database — the
 * org is the source of truth, consistent across devices. Call once inside the
 * authenticated tree; pass `enabled` to defer the fetch until logged in.
 */
export function useHydrateCompanyInfoFromOrg(enabled = true) {
  const setCompanyInfo = useSettingsStore((s) => s.setCompanyInfo);
  const { data } = useQuery({
    queryKey: ORG_SETTINGS_KEY,
    queryFn: () => api.get<RawOrganizationSettings & { needsInventoryValuationSetup?: boolean }>('/api/v1/organization/settings'),
    select: normalizeOrganizationSettings,
    enabled,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!data) return;
    setCompanyInfo({
      companyName: data.displayName,
      npwp: data.npwp,
      address: data.address,
      phone: data.phone,
      email: data.companyEmail,
      logoUrl: data.logoUrl,
      timezone: data.timezone,
      locale: data.locale,
    });
  }, [data, setCompanyInfo]);
}

/** Convenience hook returning just the org's account-defaults map. */
export function useAccountDefaults() {
  const q = useOrganizationSettings();
  return { ...q, data: q.data?.accountDefaults ?? {} };
}

/** Convenience alias focused on costing-method updates. */
export function useUpdateCostingMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { costingMethod: 'FIFO' | 'WEIGHTED_AVERAGE'; costingMethodEffectiveDate: string }) =>
      api.put<RawOrganizationSettings & { needsInventoryValuationSetup?: boolean }>('/api/v1/organization/settings', body),
    onSuccess: (data) => {
      qc.setQueryData(ORG_SETTINGS_KEY, normalizeOrganizationSettings(data));
      qc.invalidateQueries({ queryKey: ORG_SETTINGS_KEY });
    },
  });
}

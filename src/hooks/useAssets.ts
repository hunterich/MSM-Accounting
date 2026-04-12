import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import type { ListResponse } from '../types';

// ── Query Keys ───────────────────────────────────────────────────────────────

export const ASSET_KEYS = {
  categories: ['assetCategories'] as const,
  category: (id: string) => ['assetCategories', id] as const,
  assets: ['assets'] as const,
  asset: (id: string) => ['assets', id] as const,
  depreciationHistory: (assetId: string) => ['assetDepreciation', assetId] as const,
};

// ── Raw API types ────────────────────────────────────────────────────────────

interface RawAssetCategory {
  id: string;
  name: string;
  depreciationMethod: string;
  usefulLifeMonths: number;
  salvagePercent: number | string;
  assetAccountId?: string | null;
  depExpenseAccountId?: string | null;
  accumDepAccountId?: string | null;
  _count?: { assets: number };
}

interface RawAsset {
  id: string;
  assetNo: string;
  name: string;
  description?: string | null;
  categoryId: string;
  category?: { id: string; name: string } | null;
  acquisitionDate: string;
  acquisitionCost: number | string;
  depreciationMethod: string;
  usefulLifeMonths: number;
  salvageValue: number | string;
  accumulatedDepreciation: number | string;
  bookValue: number | string;
  status: string;
  location?: string | null;
  custodian?: string | null;
  department?: string | null;
  serialNumber?: string | null;
  vendor?: string | null;
  lastDepreciationDate?: string | null;
  disposalDate?: string | null;
  disposalAmount?: number | string | null;
  disposalMethod?: string | null;
  disposalNotes?: string | null;
  disposalGainLoss?: number | string | null;
  depreciationEntries?: RawDepreciationEntry[];
}

interface RawDepreciationEntry {
  id: string;
  assetId: string;
  date: string;
  month: number;
  year: number;
  amount: number | string;
  accumulatedTotal: number | string;
  bookValue: number | string;
  journalEntryId?: string | null;
}

// ── Normalized types ─────────────────────────────────────────────────────────

export interface AssetCategory {
  id: string;
  name: string;
  depreciationMethod: string;
  usefulLifeMonths: number;
  salvagePercent: number;
  assetAccountId: string;
  depExpenseAccountId: string;
  accumDepAccountId: string;
  assetCount: number;
}

export interface Asset {
  id: string;
  assetNo: string;
  name: string;
  description: string;
  categoryId: string;
  categoryName: string;
  acquisitionDate: string;
  acquisitionCost: number;
  depreciationMethod: string;
  usefulLifeMonths: number;
  salvageValue: number;
  accumulatedDepreciation: number;
  bookValue: number;
  status: string;
  location: string;
  custodian: string;
  department: string;
  serialNumber: string;
  vendor: string;
  lastDepreciationDate: string;
  disposalDate: string;
  disposalAmount: number;
  disposalMethod: string;
  disposalNotes: string;
  disposalGainLoss: number;
  depreciationEntries: DepreciationEntry[];
}

export interface DepreciationEntry {
  id: string;
  assetId: string;
  date: string;
  month: number;
  year: number;
  amount: number;
  accumulatedTotal: number;
  bookValue: number;
  journalEntryId: string;
}

// ── Normalizers ──────────────────────────────────────────────────────────────

function normalizeCategory(raw: RawAssetCategory): AssetCategory {
  return {
    id: raw.id,
    name: raw.name || '',
    depreciationMethod: raw.depreciationMethod || 'STRAIGHT_LINE',
    usefulLifeMonths: raw.usefulLifeMonths ?? 60,
    salvagePercent: Number(raw.salvagePercent ?? 0),
    assetAccountId: raw.assetAccountId || '',
    depExpenseAccountId: raw.depExpenseAccountId || '',
    accumDepAccountId: raw.accumDepAccountId || '',
    assetCount: raw._count?.assets ?? 0,
  };
}

function normalizeDepEntry(raw: RawDepreciationEntry): DepreciationEntry {
  return {
    id: raw.id,
    assetId: raw.assetId,
    date: raw.date ? String(raw.date).slice(0, 10) : '',
    month: raw.month,
    year: raw.year,
    amount: Number(raw.amount ?? 0),
    accumulatedTotal: Number(raw.accumulatedTotal ?? 0),
    bookValue: Number(raw.bookValue ?? 0),
    journalEntryId: raw.journalEntryId || '',
  };
}

function normalizeAsset(raw: RawAsset): Asset {
  return {
    id: raw.id,
    assetNo: raw.assetNo || '',
    name: raw.name || '',
    description: raw.description || '',
    categoryId: raw.categoryId || '',
    categoryName: raw.category?.name || '',
    acquisitionDate: raw.acquisitionDate ? String(raw.acquisitionDate).slice(0, 10) : '',
    acquisitionCost: Number(raw.acquisitionCost ?? 0),
    depreciationMethod: raw.depreciationMethod || 'STRAIGHT_LINE',
    usefulLifeMonths: raw.usefulLifeMonths ?? 60,
    salvageValue: Number(raw.salvageValue ?? 0),
    accumulatedDepreciation: Number(raw.accumulatedDepreciation ?? 0),
    bookValue: Number(raw.bookValue ?? 0),
    status: raw.status || 'DRAFT',
    location: raw.location || '',
    custodian: raw.custodian || '',
    department: raw.department || '',
    serialNumber: raw.serialNumber || '',
    vendor: raw.vendor || '',
    lastDepreciationDate: raw.lastDepreciationDate ? String(raw.lastDepreciationDate).slice(0, 10) : '',
    disposalDate: raw.disposalDate ? String(raw.disposalDate).slice(0, 10) : '',
    disposalAmount: Number(raw.disposalAmount ?? 0),
    disposalMethod: raw.disposalMethod || '',
    disposalNotes: raw.disposalNotes || '',
    disposalGainLoss: Number(raw.disposalGainLoss ?? 0),
    depreciationEntries: (raw.depreciationEntries || []).map(normalizeDepEntry),
  };
}

// ── Asset Categories ─────────────────────────────────────────────────────────

export function useAssetCategories() {
  return useQuery({
    queryKey: ASSET_KEYS.categories,
    queryFn: () => api.get<ListResponse<RawAssetCategory>>('/api/v1/asset-categories', { limit: 100 }),
    select: (res) => (res.data || []).map(normalizeCategory),
    staleTime: 30_000,
  });
}

export function useCreateAssetCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<AssetCategory>) => api.post('/api/v1/asset-categories', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ASSET_KEYS.categories }),
  });
}

export function useUpdateAssetCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<AssetCategory> & { id: string }) =>
      api.put(`/api/v1/asset-categories/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ASSET_KEYS.categories }),
  });
}

export function useDeleteAssetCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/asset-categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ASSET_KEYS.categories }),
  });
}

// ── Assets ───────────────────────────────────────────────────────────────────

export function useAssets(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: [...ASSET_KEYS.assets, filters],
    queryFn: () => api.get<ListResponse<RawAsset>>('/api/v1/assets', filters),
    select: (res) => ({
      ...res,
      data: (res.data || []).map(normalizeAsset),
    }),
    staleTime: 30_000,
  });
}

export function useAsset(id: string | undefined) {
  return useQuery({
    queryKey: ASSET_KEYS.asset(id ?? ''),
    queryFn: () => api.get<RawAsset>(`/api/v1/assets/${id}`),
    select: normalizeAsset,
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCreateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/api/v1/assets', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ASSET_KEYS.assets }),
  });
}

export function useUpdateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Record<string, unknown> & { id: string }) =>
      api.put(`/api/v1/assets/${id}`, body),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ASSET_KEYS.assets });
      qc.invalidateQueries({ queryKey: ASSET_KEYS.asset(vars.id) });
    },
  });
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/assets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ASSET_KEYS.assets }),
  });
}

// ── Asset Actions ────────────────────────────────────────────────────────────

export function useActivateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/assets/${id}/activate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ASSET_KEYS.assets });
    },
  });
}

export function useDisposeAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; disposalDate: string; disposalAmount: number; disposalMethod: string; notes?: string }) =>
      api.post(`/api/v1/assets/${id}/dispose`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ASSET_KEYS.assets });
    },
  });
}

// ── Depreciation ─────────────────────────────────────────────────────────────

export function useRunDepreciation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { month: number; year: number }) =>
      api.post('/api/v1/assets/depreciation/run', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ASSET_KEYS.assets });
    },
  });
}

export function useAssetDepreciationHistory(assetId: string | undefined) {
  return useQuery({
    queryKey: ASSET_KEYS.depreciationHistory(assetId ?? ''),
    queryFn: () => api.get<RawAsset>(`/api/v1/assets/${assetId}`).then((raw) =>
      (raw.depreciationEntries || []).map(normalizeDepEntry),
    ),
    enabled: Boolean(assetId),
    staleTime: 30_000,
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import type {
  ListResponse,
  RawEcommerceConnection,
  EcommerceConnection,
  EcommercePlatform,
  ConnectionStatus,
  ImportStatusFilter,
  ShopMappings,
} from '../types';

export const INTEGRATION_KEYS = {
  connections: (filters?: Record<string, unknown>) => ['ecommerceConnections', filters ?? {}] as const,
  connection: (id: string) => ['ecommerceConnections', id] as const,
};

const PLATFORM_DOWN: Record<string, EcommercePlatform> = {
  SHOPEE: 'Shopee',
  TIKTOK: 'TikTok',
  TOKOPEDIA: 'Tokopedia',
  LAZADA: 'Lazada',
  OTHER: 'Other',
};

const PLATFORM_UP: Record<string, string> = {
  Shopee: 'SHOPEE',
  TikTok: 'TIKTOK',
  Tokopedia: 'TOKOPEDIA',
  Lazada: 'LAZADA',
  Other: 'OTHER',
};

const STATUS_DOWN: Record<string, ConnectionStatus> = {
  ACTIVE: 'Active',
  SYNCING: 'Syncing',
  INACTIVE: 'Inactive',
};

const STATUS_UP: Record<string, string> = {
  Active: 'ACTIVE',
  Syncing: 'SYNCING',
  Inactive: 'INACTIVE',
};

const FILTER_DOWN: Record<string, ImportStatusFilter> = {
  Selesai: 'Selesai',
  All: 'All',
};

function normalizeConnection(raw: RawEcommerceConnection): EcommerceConnection {
  const customerId = raw.customerId || raw.customer?.id || '';
  const holdingAccountId = raw.holdingAccountId || raw.holdingAccount?.id || '';

  return {
    id: raw.id,
    platform: PLATFORM_DOWN[raw.platform ?? ''] ?? 'Other',
    name: raw.shopName || '',
    customerId,
    customer: customerId,
    customerName: raw.customer?.name || '',
    holdingAccountId,
    holdingAccount: holdingAccountId,
    holdingAccountName: raw.holdingAccount?.name || '',
    status: STATUS_DOWN[raw.status ?? ''] ?? 'Active',
    importStatusFilter: FILTER_DOWN[raw.importStatusFilter ?? ''] ?? 'Selesai',
    salesTypeId: raw.salesTypeId ?? null,
    itemMappings: raw.itemMappings && typeof raw.itemMappings === 'object' ? raw.itemMappings : {},
    mappings: raw.mappings && typeof raw.mappings === 'object' ? raw.mappings : null,
  };
}

type ConnectionPayload = {
  platform?: EcommercePlatform;
  name?: string;
  customerId?: string;
  holdingAccountId?: string;
  status?: ConnectionStatus;
  importStatusFilter?: ImportStatusFilter;
  salesTypeId?: string | null;
  itemMappings?: Record<string, string>;
  mappings?: ShopMappings | null;
};

function serializeConnectionPayload(body: ConnectionPayload) {
  return {
    ...(body.platform && { platform: PLATFORM_UP[body.platform] ?? body.platform }),
    ...(body.name !== undefined && { shopName: body.name }),
    ...(body.customerId !== undefined && { customerId: body.customerId || null }),
    ...(body.holdingAccountId !== undefined && { holdingAccountId: body.holdingAccountId || null }),
    ...(body.status && { status: STATUS_UP[body.status] ?? body.status }),
    ...(body.importStatusFilter && { importStatusFilter: body.importStatusFilter }),
    ...(body.salesTypeId !== undefined && { salesTypeId: body.salesTypeId || null }),
    ...(body.itemMappings !== undefined && { itemMappings: body.itemMappings }),
    ...(body.mappings !== undefined && { mappings: body.mappings }),
  };
}

export function useEcommerceConnections(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: INTEGRATION_KEYS.connections(filters),
    queryFn: () => api.get<ListResponse<RawEcommerceConnection>>('/api/v1/integrations', filters),
    select: (res) => ({
      ...res,
      data: (res.data || []).map(normalizeConnection),
    }),
    staleTime: 30_000,
  });
}

export function useCreateEcommerceConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ConnectionPayload) =>
      api.post<RawEcommerceConnection>('/api/v1/integrations', serializeConnectionPayload(body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ecommerceConnections'] }),
  });
}

export function useUpdateEcommerceConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ConnectionPayload & { id: string }) =>
      api.put<RawEcommerceConnection>(`/api/v1/integrations/${id}`, serializeConnectionPayload(body)),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['ecommerceConnections'] });
      qc.invalidateQueries({ queryKey: INTEGRATION_KEYS.connection(vars.id) });
    },
  });
}

export function useDeleteEcommerceConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/integrations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ecommerceConnections'] }),
  });
}

export interface MarketplaceImportPayload {
  orders: Array<{
    orderNo: string;
    issueDate: string;
    lines: Array<{
      itemId: string;
      description: string;
      sku: string;
      quantity: number;
      unitPrice: number;
    }>;
  }>;
  options: { customerId?: string; recordPayment: boolean };
}

export interface MarketplaceImportResult {
  created: number;
  skipped: number;
  failed: Array<{ orderNo: string; reason: string }>;
}

export function useImportMarketplaceOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ connectionId, ...body }: MarketplaceImportPayload & { connectionId: string }) =>
      api.post<MarketplaceImportResult>(`/api/v1/integrations/${connectionId}/import`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['arInvoices'] });
      qc.invalidateQueries({ queryKey: ['arPayments'] });
    },
  });
}

export interface SettlementImportPayload {
  orders: Array<{ orderId: string; netReleased: number; charges: Record<string, number> }>;
}
export interface SettlementImportResult {
  posted: number;
  alreadySettled: number;
  skipped: Array<{ orderId: string; netReleased: number }>;
  failed: Array<{ orderId: string; reason: string }>;
}

export function useImportSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ connectionId, ...body }: SettlementImportPayload & { connectionId: string }) =>
      api.post<SettlementImportResult>(`/api/v1/integrations/${connectionId}/settlement-import`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['arPayments'] });
      qc.invalidateQueries({ queryKey: ['bankTransactions'] });
    },
  });
}

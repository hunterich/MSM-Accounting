import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/src/api/apiClient';
import type { CatalogItem } from '../state/cart';
import type { SaleLineInput } from '@/lib/pos/pricing';

export interface PosRegister { id: string; code: string; name: string; warehouseId: string | null }
export interface CatalogRow extends CatalogItem { drugClass: string; requiresBatchTracking: boolean; qtyAvailable: number; earliestExpiry: string | null }
export interface OpenShiftResult { id: string; status: 'OPEN' }
export interface CloseShiftResult {
  status: 'CLOSED'; expectedCash: number; cashVariance: number;
  zReport: { totalSales: number; saleCount: number; cashCollected: number };
}
export interface PostSaleResult { posSaleId: string; salesInvoiceId: string; totalAmount: number; change: number }
export interface OpenShiftRow { id: string; registerId: string; openedAt: string; openingFloat: number }

export function useRegisters() {
  return useQuery({ queryKey: ['pos', 'registers'], queryFn: () => api.get<PosRegister[]>('/api/v1/pos/registers') });
}

export function useOpenShifts() {
  return useQuery({ queryKey: ['pos', 'openShifts'], queryFn: () => api.get<OpenShiftRow[]>('/api/v1/pos/shifts') });
}

export function useCatalog(enabled: boolean) {
  return useQuery({
    queryKey: ['pos', 'catalog'],
    queryFn: () => api.get<CatalogRow[]>('/api/v1/pos/catalog'),
    enabled,
    staleTime: 60_000,
  });
}

export function useOpenShift() {
  return useMutation({
    mutationFn: (body: { registerId: string; openingFloat: number }) =>
      api.post<OpenShiftResult>('/api/v1/pos/shifts', body),
  });
}

export function useCloseShift() {
  return useMutation({
    mutationFn: ({ shiftId, countedCash }: { shiftId: string; countedCash: number }) =>
      api.post<CloseShiftResult>(`/api/v1/pos/shifts/${shiftId}/close`, { countedCash }),
  });
}

export function usePostSale() {
  return useMutation({
    mutationFn: (body: { clientSaleId: string; registerId: string; shiftId: string; lines: SaleLineInput[]; tenders: { method: 'CASH'; amount: number }[] }) =>
      api.post<PostSaleResult>('/api/v1/pos/sales', body),
  });
}

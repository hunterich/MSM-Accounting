import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';

export type PerfStatus = 'green' | 'amber' | 'red' | null;

export interface PerfRow {
  employeeId: string | null;
  name: string;
  target: number;
  hasTarget: boolean;
  sold: number;
  remaining: number;
  pct: number | null;
  status: PerfStatus;
}

export interface SalesPerformanceResponse {
  month: string;
  rows: PerfRow[];
  totals: { target: number; sold: number };
}

export interface TargetRow {
  employeeId: string;
  name: string;
  targetAmount: number | null;
}

export interface TargetsResponse {
  month: string;
  targets: TargetRow[];
}

export function useSalesPerformance(month: string) {
  return useQuery({
    queryKey: ['pos-sales-performance', month],
    queryFn: () => api.get<SalesPerformanceResponse>('/api/v1/pos/reports/sales-performance', { month }),
    enabled: /^\d{4}-\d{2}$/.test(month),
  });
}

export function usePosTargets(month: string) {
  return useQuery({
    queryKey: ['pos-targets', month],
    queryFn: () => api.get<TargetsResponse>('/api/v1/pos/targets', { month }),
    enabled: /^\d{4}-\d{2}$/.test(month),
  });
}

export function useSavePosTargets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { month: string; targets: { employeeId: string; targetAmount: number | null }[] }) =>
      api.put<{ ok: boolean }>('/api/v1/pos/targets', payload),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['pos-targets', vars.month] });
      qc.invalidateQueries({ queryKey: ['pos-sales-performance', vars.month] });
    },
  });
}

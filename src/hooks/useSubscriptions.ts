import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';

// ── Keys ─────────────────────────────────────────────────────────────────────

export const SUB_KEYS = {
  plans: ['subscriptionPlans'] as const,
  plan: (id: string) => ['subscriptionPlans', id] as const,
  subscriptions: ['subscriptions'] as const,
  subscription: (id: string) => ['subscriptions', id] as const,
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  interval: 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';
  trialDays: number;
  features: string | string[];
  isActive: boolean;
  // Allow shared `Table` component to accept this row type.
  [key: string]: unknown;
}

export interface Subscription {
  id: string;
  customerId: string;
  planId: string;
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  startDate: string;
  trialEndDate?: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextInvoiceDate?: string;
  cancelledAt?: string | null;
  customer?: { id: string; name: string; code: string };
  plan?: SubscriptionPlan;
  // Allow shared `Table` component to accept this row type.
  [key: string]: unknown;
}

// ── Plans ────────────────────────────────────────────────────────────────────

export function useSubscriptionPlans() {
  return useQuery({
    queryKey: SUB_KEYS.plans,
    queryFn: () => api.get<{ data: SubscriptionPlan[]; total: number }>('/api/v1/subscription-plans'),
    staleTime: 30_000,
  });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<SubscriptionPlan>) => api.post('/api/v1/subscription-plans', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: SUB_KEYS.plans }),
  });
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...updates }: Partial<SubscriptionPlan> & { id: string }) =>
      api.put(`/api/v1/subscription-plans/${id}`, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: SUB_KEYS.plans }),
  });
}

export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/subscription-plans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: SUB_KEYS.plans }),
  });
}

// ── Subscriptions ────────────────────────────────────────────────────────────

export function useSubscriptions(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: [...SUB_KEYS.subscriptions, filters],
    queryFn: () => api.get<{ data: Subscription[]; total: number }>('/api/v1/subscriptions', filters),
    staleTime: 30_000,
  });
}

export function useSubscription(id: string | undefined) {
  return useQuery({
    queryKey: SUB_KEYS.subscription(id ?? ''),
    queryFn: () => api.get<Subscription>(`/api/v1/subscriptions/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCreateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { customerId: string; planId: string; startDate?: string }) =>
      api.post('/api/v1/subscriptions', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: SUB_KEYS.subscriptions }),
  });
}

export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/subscriptions/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: SUB_KEYS.subscriptions }),
  });
}

export function useGenerateSubscriptionInvoices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/v1/subscriptions/generate-invoices'),
    onSuccess: () => qc.invalidateQueries({ queryKey: SUB_KEYS.subscriptions }),
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import type { MigrationEntity } from '../utils/migrationFields';

export type MigrationBatchStatus = 'DRAFT' | 'STAGED' | 'RECONCILED' | 'COMMITTED' | 'ROLLED_BACK';

export interface MigrationBatch {
  id: string;
  status: MigrationBatchStatus;
  cutoverDate?: string;
  [key: string]: unknown;
}

export interface StageResult {
  staged: number;
  errors: { row: number; message: string }[];
}

export interface ReconcileCheck {
  name: string;
  ok: boolean;
  message?: string;
  [key: string]: unknown;
}

export interface ReconcileResult {
  ok: boolean;
  checks: ReconcileCheck[];
}

export interface CommitResult {
  committed: boolean;
  reconcile: ReconcileResult;
}

export interface RollbackResult {
  rolledBack: boolean;
  reason?: string;
}

export interface MigrationRow {
  [key: string]: string | number | boolean | undefined | null;
}

/**
 * Raw request functions over the Plan 1 migration batch endpoints
 * (`/api/v1/migration/batches`). Exported standalone so they can be
 * unit-tested without React-Query; the hooks below just wrap these.
 */
export const migrationApi = {
  create: (cutoverDate: string) =>
    api.post<MigrationBatch>('/api/v1/migration/batches', { cutoverDate }),

  list: () =>
    api.get<MigrationBatch[]>('/api/v1/migration/batches'),

  get: (id: string) =>
    api.get<MigrationBatch>(`/api/v1/migration/batches/${id}`),

  stage: (id: string, entity: MigrationEntity, rows: MigrationRow[]) =>
    api.post<StageResult>(`/api/v1/migration/batches/${id}/stage`, { entity, rows }),

  reconcile: (id: string) =>
    api.get<ReconcileResult>(`/api/v1/migration/batches/${id}/reconcile`),

  commit: (id: string) =>
    api.post<CommitResult>(`/api/v1/migration/batches/${id}/commit`, {}),

  rollback: (id: string) =>
    api.post<RollbackResult>(`/api/v1/migration/batches/${id}/rollback`, {}),
};

export const MIGRATION_KEYS = {
  all: ['migration', 'batches'] as const,
  list: () => [...MIGRATION_KEYS.all],
  one: (id: string) => [...MIGRATION_KEYS.all, id],
  reconcile: (id: string) => [...MIGRATION_KEYS.all, id, 'reconcile'],
};

export function useBatches() {
  return useQuery({
    queryKey: MIGRATION_KEYS.list(),
    queryFn: () => migrationApi.list(),
    staleTime: 30_000,
  });
}

export function useBatch(id?: string) {
  return useQuery({
    queryKey: MIGRATION_KEYS.one(id ?? ''),
    queryFn: () => migrationApi.get(id as string),
    enabled: !!id,
    staleTime: 10_000,
  });
}

export function useCreateBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cutoverDate: string) => migrationApi.create(cutoverDate),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MIGRATION_KEYS.all });
    },
  });
}

export function useStageEntity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entity, rows }: { entity: MigrationEntity; rows: MigrationRow[] }) =>
      migrationApi.stage(id, entity, rows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MIGRATION_KEYS.one(id) });
      qc.invalidateQueries({ queryKey: MIGRATION_KEYS.reconcile(id) });
    },
  });
}

/**
 * Reconcile checks are triggered explicitly (Reconcile step of the wizard),
 * not fetched eagerly on mount — so this is `enabled: !!id` for cache-key
 * scoping, but callers should invoke `refetch()` to actually run the check
 * rather than relying on automatic mount-fetch timing.
 */
export function useReconcile(id?: string) {
  return useQuery({
    queryKey: MIGRATION_KEYS.reconcile(id ?? ''),
    queryFn: () => migrationApi.reconcile(id as string),
    enabled: !!id,
    staleTime: 0,
  });
}

export function useCommitBatch(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => migrationApi.commit(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MIGRATION_KEYS.one(id) });
      qc.invalidateQueries({ queryKey: MIGRATION_KEYS.reconcile(id) });
    },
  });
}

export function useRollbackBatch(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => migrationApi.rollback(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MIGRATION_KEYS.all });
      qc.invalidateQueries({ queryKey: MIGRATION_KEYS.one(id) });
    },
  });
}

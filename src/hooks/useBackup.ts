import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';

export type FolderDestination = { label: string; path: string; enabled: boolean };
export type BackupSettings = {
  enabled: boolean;
  frequency: 'DAILY' | 'TWICE_DAILY' | 'WEEKLY';
  times: string[];
  retentionDailyCount: number;
  retentionMonthlyCount: number;
  canonicalDir: string | null;
  folderDestinations: FolderDestination[];
  downloadEnabled: boolean;
  pgToolsPathOverride: string | null;
  pgToolsOk: boolean;
  pgToolsMessage: string;
};
export type BackupRecord = {
  id: string;
  createdAt: string;
  type: 'AUTO' | 'MANUAL' | 'PRE_RESTORE_SAFETY';
  fileName: string;
  sizeBytes: number;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  destinations: { label: string; path: string; status: string; error?: string }[];
  error?: string | null;
};

export const BACKUP_KEYS = {
  settings: ['backup', 'settings'] as const,
  history: (page: number) => ['backup', 'history', page] as const,
};

export function useBackupSettings() {
  return useQuery({
    queryKey: BACKUP_KEYS.settings,
    queryFn: () => api.get<BackupSettings>('/api/v1/backup/settings'),
  });
}

export function useUpdateBackupSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<BackupSettings>) => api.put<BackupSettings>('/api/v1/backup/settings', body),
    onSuccess: (data) => qc.setQueryData(BACKUP_KEYS.settings, data),
  });
}

export function useBackupHistory(page = 1) {
  return useQuery({
    queryKey: BACKUP_KEYS.history(page),
    queryFn: () => api.get<{ data: BackupRecord[]; total: number }>('/api/v1/backup/history', { page }),
  });
}

export function useRunBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/v1/backup/run', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backup', 'history'] }),
  });
}

export function useRestoreBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/backup/${id}/restore`, { confirm: 'RESTORE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backup', 'history'] }),
  });
}

/**
 * Stream a backup file to the browser. Mirrors apiClient: tenant context is
 * derived server-side from the session cookie, so we only send credentials
 * (no x-org-id header).
 */
export async function downloadBackupFile(id: string, fileName: string): Promise<void> {
  const env = (import.meta as { env?: Record<string, string> }).env;
  const base =
    env?.VITE_API_URL ||
    (typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}:3000`
      : 'http://localhost:3000');
  const res = await fetch(`${base}/api/v1/backup/${id}/download`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import { useAuthStore } from '../stores/useAuthStore';

export type LoginAccount = {
  id: string;
  fullName: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  roleName: string;
};

export const USER_KEYS = {
  list: ['users', 'login-accounts'] as const,
};

export function useLoginAccounts(enabled = true) {
  return useQuery({
    queryKey: USER_KEYS.list,
    queryFn: () => api.get<{ data: LoginAccount[] }>('/api/v1/users'),
    enabled,
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ userId, newPassword }: { userId: string; newPassword: string }) =>
      api.post(`/api/v1/users/${userId}/reset-password`, { newPassword }),
  });
}

export function useChangeOwnPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.post('/api/v1/users/me/password', body),
    onSuccess: () => {
      useAuthStore.getState().clearMustChangePassword();
      qc.invalidateQueries({ queryKey: USER_KEYS.list });
    },
  });
}

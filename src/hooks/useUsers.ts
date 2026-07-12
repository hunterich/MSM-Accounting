import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import { useAuthStore } from '../stores/useAuthStore';
import { useInvalidateRbac } from './useRoles';

export type LoginAccount = {
  id: string;
  /** UserOrganization row id — the handle for remove-from-company (DELETE). */
  membershipId: string;
  fullName: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  roleName: string;
  roleType: string;
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

/**
 * Add an EXISTING user to the active company with a per-company role. Refetches
 * the users list AND the roles list (each role's active memberCount changes) on
 * success so both cards update immediately.
 */
export function useAddMembership() {
  const inv = useInvalidateRbac();
  return useMutation({
    mutationFn: (body: { email: string; roleId: string }) =>
      api.post('/api/v1/users/memberships', body),
    onSuccess: inv,
  });
}

/**
 * Remove a user from the active company (soft delete on the membership).
 * Refetches the users list AND the roles list (memberCount changes) on success.
 */
export function useRemoveMembership() {
  const inv = useInvalidateRbac();
  return useMutation({
    mutationFn: (membershipId: string) =>
      api.delete(`/api/v1/users/memberships/${membershipId}`),
    onSuccess: inv,
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

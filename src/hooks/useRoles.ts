import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import { useAuthStore } from '../stores/useAuthStore';
import { USER_KEYS } from './useUsers';

export const ROLES_KEY = ['roles'] as const;

export interface ApiPermissionRow {
  moduleKey: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}

export interface ApiRole {
  id: string;
  name: string;
  roleType: string;
  invoiceAccessScope: string;
  isActive: boolean;
  allowedDays: unknown;
  startTime: string | null;
  endTime: string | null;
  memberCount: number;
  permissions: ApiPermissionRow[];
}

export function useRoles() {
  return useQuery({
    queryKey: ROLES_KEY,
    queryFn: () => api.get<{ data: ApiRole[] }>('/api/v1/roles'),
    select: (r) => r.data,
    staleTime: 30_000,
  });
}

/**
 * Invalidates roles + users list, then refreshes the auth store session so
 * the current user picks up any permission changes immediately.
 * /api/v1/auth/me is fetched imperatively by useAuthStore.checkSession() —
 * it is not a React Query query — so we call checkSession() directly.
 *
 * Exported so membership mutations (useAddMembership/useRemoveMembership) share
 * the same invalidation set — an invite/removal changes each role's active
 * `memberCount`, so the Roles card must refetch too, not just the users list.
 */
export function useInvalidateRbac() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ROLES_KEY });
    qc.invalidateQueries({ queryKey: USER_KEYS.list });
    useAuthStore.getState().checkSession();
  };
}

export function useCreateRole() {
  const inv = useInvalidateRbac();
  return useMutation({
    mutationFn: (body: Partial<ApiRole>) => api.post('/api/v1/roles', body),
    onSuccess: inv,
  });
}

export function useUpdateRole() {
  const inv = useInvalidateRbac();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<ApiRole>) =>
      api.put(`/api/v1/roles/${id}`, body),
    onSuccess: inv,
  });
}

export function useDeleteRole() {
  const inv = useInvalidateRbac();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/roles/${id}`),
    onSuccess: inv,
  });
}

export function useAssignUserRole() {
  const inv = useInvalidateRbac();
  return useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
      api.put(`/api/v1/users/${userId}/role`, { roleId }),
    onSuccess: inv,
  });
}

export function useCreateUser() {
  const inv = useInvalidateRbac();
  return useMutation({
    mutationFn: (body: {
      fullName: string;
      email: string;
      roleId: string;
      password?: string;
    }) =>
      api.post<{ id: string; email: string; fullName: string; temporaryPassword?: string }>(
        '/api/v1/users',
        body,
      ),
    onSuccess: inv,
  });
}

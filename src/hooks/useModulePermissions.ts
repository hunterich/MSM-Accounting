import { useAuthStore } from '../stores/useAuthStore';
import { useAccessStore, type ExtraActionKey } from '../stores/useAccessStore';

export interface ModulePermissions {
  canView:   boolean;
  canCreate: boolean;
  canEdit:   boolean;
  canDelete: boolean;
}

export const useModulePermissions = (moduleKey: string): ModulePermissions => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasPermission = useAuthStore((state: any) => state.hasPermission);

  return {
    canView:   hasPermission(moduleKey, 'view'),
    canCreate: hasPermission(moduleKey, 'create'),
    canEdit:   hasPermission(moduleKey, 'edit'),
    canDelete: hasPermission(moduleKey, 'delete'),
  };
};

/**
 * Read an extra action flag (reprint, overridePrice, sellBelowCost,
 * invoiceWithoutSO, …) for the current user's role from the local
 * useAccessStore. Reactive: re-renders when the role permissions change.
 */
export const useExtraAction = (moduleKey: string, action: ExtraActionKey): boolean => {
  return useAccessStore((s) => {
    const role = s.roles.find((r) => r.id === s.users.find((u) => u.id === s.currentUserId)?.roleId);
    return role?.permissions?.[moduleKey]?.[action] === true;
  });
};

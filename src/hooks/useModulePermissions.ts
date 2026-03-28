import { useAuthStore } from '../stores/useAuthStore';

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

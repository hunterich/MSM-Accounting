import { useAuthStore } from '../stores/useAuthStore';

export const useModulePermissions = (moduleKey) => {
  const hasPermission = useAuthStore((state) => state.hasPermission);

  return {
    canView: hasPermission(moduleKey, 'view'),
    canCreate: hasPermission(moduleKey, 'create'),
    canEdit: hasPermission(moduleKey, 'edit'),
    canDelete: hasPermission(moduleKey, 'delete'),
  };
};

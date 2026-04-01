import { create } from 'zustand';

const API = import.meta.env?.VITE_API_URL || 'http://localhost:3000';

const EMPTY_SESSION = {
  user: null,
  org: null,
  roleType: null,
  invoiceAccessScope: 'ALL',
  permissions: [],
  isLoading: false,
  needsInventoryValuationSetup: false,
};

const normalizeModuleKey = (moduleKey) => String(moduleKey || '').trim().toLowerCase();

const getPermissionsFromResponse = (data = {}) => data.role?.permissions || data.permissions || [];

const getRoleTypeFromResponse = (data = {}) => data.role?.type || data.roleType || null;

const getInvoiceAccessScopeFromResponse = (data = {}) => data.role?.invoiceAccessScope || 'ALL';

export const hasModulePermission = (permissions, moduleKey, action = 'view') => {
  const normalizedModuleKey = normalizeModuleKey(moduleKey);
  if (!normalizedModuleKey || !action) return false;

  if (Array.isArray(permissions)) {
    const row = permissions.find((permission) => normalizeModuleKey(permission?.moduleKey) === normalizedModuleKey);
    if (!row) return false;

    const actionMap = {
      view: row.canView === true,
      create: row.canCreate === true,
      edit: row.canEdit === true,
      delete: row.canDelete === true,
    };

    return actionMap[action] === true;
  }

  if (permissions && typeof permissions === 'object') {
    return permissions[normalizedModuleKey]?.[action] === true;
  }

  return false;
};

export const useAuthStore = create((set, get) => ({
  user: null,
  org: null,
  roleType: null,
  invoiceAccessScope: 'ALL',
  permissions: [],
  isLoading: true,
  needsInventoryValuationSetup: false,

  hasPermission: (moduleKey, action = 'view') =>
    hasModulePermission(get().permissions, moduleKey, action),

  checkSession: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch(`${API}/api/v1/auth/me`, {
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        set({
          user: data.user,
          org: data.org,
          roleType: getRoleTypeFromResponse(data),
          invoiceAccessScope: getInvoiceAccessScopeFromResponse(data),
          permissions: getPermissionsFromResponse(data),
          needsInventoryValuationSetup: data.needsInventoryValuationSetup === true,
          isLoading: false,
        });
        return;
      }

      set(EMPTY_SESSION);
    } catch {
      set(EMPTY_SESSION);
    }
  },

  login: async (email, password) => {
    const res = await fetch(`${API}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? 'Login failed');
    }

    const data = await res.json();

    set({
      user: data.user,
      org: data.org,
      roleType: getRoleTypeFromResponse(data),
      invoiceAccessScope: getInvoiceAccessScopeFromResponse(data),
      permissions: getPermissionsFromResponse(data),
      needsInventoryValuationSetup: data.needsInventoryValuationSetup === true,
      isLoading: false,
    });

    return data;
  },

  loginWithGoogle: async (credential) => {
    const res = await fetch(`${API}/api/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
      credentials: 'include',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? 'Google login failed');
    }

    const data = await res.json();

    set({
      user: data.user,
      org: data.org,
      roleType: getRoleTypeFromResponse(data),
      invoiceAccessScope: getInvoiceAccessScopeFromResponse(data),
      permissions: getPermissionsFromResponse(data),
      needsInventoryValuationSetup: data.needsInventoryValuationSetup === true,
      isLoading: false,
    });

    return data;
  },

  logout: async () => {
    try {
      await fetch(`${API}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      set(EMPTY_SESSION);
    }
  },
}));

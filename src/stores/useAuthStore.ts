import { create } from 'zustand';

interface AuthUser {
    id:       string;
    fullName: string;
    email:    string;
    [key: string]: unknown;
}

interface AuthOrg {
    id:   string;
    name: string;
    [key: string]: unknown;
}

interface RolePermission {
    moduleKey:  string;
    canView:    boolean;
    canCreate:  boolean;
    canEdit:    boolean;
    canDelete:  boolean;
    [key: string]: unknown;
}

interface PermissionMatrixRow {
    view?: boolean;
    create?: boolean;
    edit?: boolean;
    delete?: boolean;
}

interface AuthRole {
    type?: string | null;
    invoiceAccessScope?: string | null;
    permissions?: RolePermission[] | Record<string, PermissionMatrixRow>;
}

interface AuthResponse {
    user?: AuthUser | null;
    org?: AuthOrg | null;
    role?: AuthRole | null;
    roleType?: string | null;
    permissions?: RolePermission[] | Record<string, PermissionMatrixRow>;
}

interface AuthStore {
    user:                AuthUser | null;
    org:                 AuthOrg | null;
    roleType:            string | null;
    invoiceAccessScope:  string;
    permissions:         RolePermission[];
    isLoading:           boolean;
    hasPermission:       (moduleKey: string, action?: 'view' | 'create' | 'edit' | 'delete') => boolean;
    checkSession:        () => Promise<void>;
    login:               (email: string, password: string) => Promise<unknown>;
    loginWithGoogle:     (credential: string) => Promise<unknown>;
    logout:              () => Promise<void>;
}

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const EMPTY_SESSION = {
  user: null,
  org: null,
  roleType: null,
  invoiceAccessScope: 'ALL',
  permissions: [],
  isLoading: false,
};

const normalizeModuleKey = (moduleKey: string) => String(moduleKey || '').trim().toLowerCase();

const getPermissionsFromResponse = (data: AuthResponse = {}): RolePermission[] => {
  const source = data.role?.permissions || data.permissions || [];

  if (Array.isArray(source)) {
    return source;
  }

  if (source && typeof source === 'object') {
    return Object.entries(source).map(([moduleKey, row]) => ({
      moduleKey,
      canView: row?.view === true,
      canCreate: row?.create === true,
      canEdit: row?.edit === true,
      canDelete: row?.delete === true,
    }));
  }

  return [];
};

const getRoleTypeFromResponse = (data: AuthResponse = {}): string | null => data.role?.type || data.roleType || null;

const getInvoiceAccessScopeFromResponse = (data: AuthResponse = {}): string => data.role?.invoiceAccessScope || 'ALL';

export const hasModulePermission = (
    permissions: RolePermission[] | Record<string, PermissionMatrixRow> | null | undefined,
    moduleKey: string,
    action: 'view' | 'create' | 'edit' | 'delete' = 'view'
) => {
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
    return (permissions as Record<string, PermissionMatrixRow>)[normalizedModuleKey]?.[action] === true;
  }

  return false;
};

export const useAuthStore = create<AuthStore>()((set, get) => ({
  user: null,
  org: null,
  roleType: null,
  invoiceAccessScope: 'ALL',
  permissions: [],
  isLoading: true,

  hasPermission: (moduleKey, action = 'view') =>
    hasModulePermission(get().permissions, moduleKey, action),

  checkSession: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch(`${API}/api/v1/auth/me`, {
        credentials: 'include',
      });

      if (res.ok) {
        const data: AuthResponse = await res.json();
        set({
          user: data.user,
          org: data.org,
          roleType: getRoleTypeFromResponse(data),
          invoiceAccessScope: getInvoiceAccessScopeFromResponse(data),
          permissions: getPermissionsFromResponse(data),
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
      const err = await res.json().catch((): { error?: string } => ({}));
      throw new Error(err.error ?? 'Login failed');
    }

    const data: AuthResponse = await res.json();

    set({
      user: data.user,
      org: data.org,
      roleType: getRoleTypeFromResponse(data),
      invoiceAccessScope: getInvoiceAccessScopeFromResponse(data),
      permissions: getPermissionsFromResponse(data),
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
      const err = await res.json().catch((): { error?: string } => ({}));
      throw new Error(err.error ?? 'Google login failed');
    }

    const data: AuthResponse = await res.json();

    set({
      user: data.user,
      org: data.org,
      roleType: getRoleTypeFromResponse(data),
      invoiceAccessScope: getInvoiceAccessScopeFromResponse(data),
      permissions: getPermissionsFromResponse(data),
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

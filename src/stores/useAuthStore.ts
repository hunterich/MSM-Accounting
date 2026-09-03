import { create } from 'zustand';
import { resolveApiBase } from '../lib/apiBase';
import { getActiveOrgId, clearActiveOrg } from '../lib/activeOrg';

interface AuthUser {
    id:       string;
    fullName: string;
    email:    string;
    [key: string]: unknown;
}

interface AuthOrg {
    id:   string;
    name: string;
    costingMethod?: string | null;
    costingMethodEffectiveDate?: string | null;
    [key: string]: unknown;
}

export interface OrgMembership {
    orgId:    string;
    name:     string;
    roleType: string;
}

interface RolePermission {
    moduleKey:  string;
    canView:    boolean;
    canCreate:  boolean;
    canEdit:    boolean;
    canDelete:  boolean;
    canApprove?: boolean;
    [key: string]: unknown;
}

interface AuthStore {
    user:                AuthUser | null;
    org:                 AuthOrg | null;
    roleType:            string | null;
    invoiceAccessScope:  string;
    permissions:         RolePermission[];
    memberships:         OrgMembership[];
    needsOrgSelection:   boolean;
    isLoading:           boolean;
    needsInventoryValuationSetup: boolean;
    mustChangePassword:  boolean;
    clearMustChangePassword: () => void;
    hasPermission:       (moduleKey: string, action?: PermissionAction) => boolean;
    updateOrganizationContext: (nextOrg: Partial<AuthOrg>, needsInventoryValuationSetup?: boolean) => void;
    checkSession:        () => Promise<void>;
    selectOrg:           (orgId: string) => void;
    login:               (email: string, password: string) => Promise<unknown>;
    loginWithGoogle:     (credential: string) => Promise<unknown>;
    logout:              () => Promise<void>;
}

type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'approve';

interface AuthResponseLike {
  user?: AuthUser | null;
  org?: AuthOrg | null;
  roleType?: string | null;
  permissions?: RolePermission[];
  memberships?: OrgMembership[];
  needsOrgSelection?: boolean;
  needsInventoryValuationSetup?: boolean;
  mustChangePassword?: boolean;
  role?: {
    type?: string | null;
    permissions?: RolePermission[];
    invoiceAccessScope?: string;
  };
}

const API = resolveApiBase();

const EMPTY_SESSION = {
  user: null,
  org: null,
  roleType: null,
  invoiceAccessScope: 'ALL',
  permissions: [],
  memberships: [] as OrgMembership[],
  needsOrgSelection: false,
  isLoading: false,
  needsInventoryValuationSetup: false,
  mustChangePassword: false,
};

const normalizeModuleKey = (moduleKey: string) => String(moduleKey || '').trim().toLowerCase();

const getPermissionsFromResponse = (data: AuthResponseLike = {}) => data.role?.permissions || data.permissions || [];

const getRoleTypeFromResponse = (data: AuthResponseLike = {}) => data.role?.type || data.roleType || null;

const getInvoiceAccessScopeFromResponse = (data: AuthResponseLike = {}) => data.role?.invoiceAccessScope || 'ALL';

const getMembershipsFromResponse = (data: AuthResponseLike = {}) =>
  Array.isArray(data.memberships) ? data.memberships : [];

export const hasModulePermission = (
  permissions: RolePermission[] | Record<string, Record<PermissionAction, boolean>>,
  moduleKey: string,
  action: PermissionAction = 'view'
) => {
  const normalizedModuleKey = normalizeModuleKey(moduleKey);
  if (!normalizedModuleKey || !action) return false;

  if (Array.isArray(permissions)) {
    const row = permissions.find((permission) => normalizeModuleKey(permission?.moduleKey) === normalizedModuleKey);
    if (!row) return false;

    const actionMap: Record<PermissionAction, boolean> = {
      view:    row.canView === true,
      create:  row.canCreate === true,
      edit:    row.canEdit === true,
      delete:  row.canDelete === true,
      approve: row.canApprove === true,
    };

    return actionMap[action] === true;
  }

  if (permissions && typeof permissions === 'object') {
    return permissions[normalizedModuleKey]?.[action] === true;
  }

  return false;
};

export const useAuthStore = create<AuthStore>()((set, get) => ({
  user: null,
  org: null,
  roleType: null,
  invoiceAccessScope: 'ALL',
  permissions: [],
  memberships: [],
  needsOrgSelection: false,
  isLoading: true,
  needsInventoryValuationSetup: false,
  mustChangePassword: false,

  clearMustChangePassword: () => set({ mustChangePassword: false }),

  // Mirror the server (lib/authz.ts `requirePermission`): an ADMIN role is
  // never gated by the permission matrix, so a module the matrix does not
  // list — or a row the seed forgot — cannot lock the administrator out of a
  // screen the API would happily serve.
  hasPermission: (moduleKey, action = 'view') =>
    get().roleType === 'ADMIN' || hasModulePermission(get().permissions, moduleKey, action),

  updateOrganizationContext: (nextOrg, needsInventoryValuationSetup = false) =>
    set((state) => ({
      org: state.org ? { ...state.org, ...nextOrg } : (nextOrg as AuthOrg),
      needsInventoryValuationSetup,
    })),

  checkSession: async () => {
    set({ isLoading: true });
    try {
      const activeOrg = getActiveOrgId();
      const res = await fetch(`${API}/api/v1/auth/me`, {
        credentials: 'include',
        headers: { ...(activeOrg ? { 'x-active-org': activeOrg } : {}) },
      });

      if (res.ok) {
        const data = await res.json();
        set({
          user: data.user,
          org: data.org,
          roleType: getRoleTypeFromResponse(data),
          invoiceAccessScope: getInvoiceAccessScopeFromResponse(data),
          permissions: getPermissionsFromResponse(data),
          memberships: getMembershipsFromResponse(data),
          needsOrgSelection: data.needsOrgSelection === true,
          needsInventoryValuationSetup: data.needsInventoryValuationSetup === true,
          mustChangePassword: data.mustChangePassword === true,
          isLoading: false,
        });
        return;
      }

      set(EMPTY_SESSION);
    } catch {
      set(EMPTY_SESSION);
    }
  },

  selectOrg: (orgId) => {
    // Hard reload through the ?org= handshake — the same mechanism as the
    // header switcher. The org pin is written only by the NEW document's
    // bootstrap (module-eval in activeOrg.ts): pre-setting it here would let
    // the still-live old page stamp the new org header on in-flight requests.
    // After reload the picker gate passes and every org-scoped persisted
    // store hydrates from the right per-company bucket (they hydrate
    // synchronously at import, so an in-place checkSession would leave them
    // on the ':default' bucket).
    window.location.assign(`/?org=${encodeURIComponent(orgId)}`);
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
      memberships: getMembershipsFromResponse(data),
      needsOrgSelection: data.needsOrgSelection === true,
      needsInventoryValuationSetup: data.needsInventoryValuationSetup === true,
      mustChangePassword: data.mustChangePassword === true,
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
      memberships: getMembershipsFromResponse(data),
      needsOrgSelection: data.needsOrgSelection === true,
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
      // Drop this tab's org pin so the next login here doesn't inherit the
      // previous user's active company.
      clearActiveOrg();
      set(EMPTY_SESSION);
    }
  },
}));

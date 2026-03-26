import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Module permission keys — these map to sidebar nav items and route groups.
 * Each key controls visibility of the corresponding sidebar icon + sub-items.
 *
 * Inspired by Accurate Online: Pengaturan → Akses Grup → Hak Akses
 */
export const MODULE_KEYS = {
    dashboard:     { label: 'Dashboard',             group: 'Dashboard' },
    gl_coa:        { label: 'Chart of Accounts',     group: 'General Ledger' },
    gl_journal:    { label: 'Journal Entries',        group: 'General Ledger' },
    ar_sales_orders:{ label: 'Sales Orders',          group: 'Accounts Receivable' },
    ar_invoices:   { label: 'Invoices',               group: 'Accounts Receivable' },
    ar_payments:   { label: 'Receive Payments',       group: 'Accounts Receivable' },
    ar_credits:    { label: 'Returns & Credits',      group: 'Accounts Receivable' },
    ar_customers:  { label: 'Customers & Categories', group: 'Accounts Receivable' },
    ap_pos:        { label: 'Purchase Orders',        group: 'Accounts Payable' },
    ap_bills:      { label: 'Purchase Bills',         group: 'Accounts Payable' },
    ap_payments:   { label: 'Send Payments',          group: 'Accounts Payable' },
    ap_debits:     { label: 'Returns & Debits',       group: 'Accounts Payable' },
    ap_vendors:    { label: 'Vendors',                group: 'Accounts Payable' },
    inv_items:      { label: 'Inventory Items',        group: 'Inventory' },
    inv_categories: { label: 'Item Categories',        group: 'Inventory' },
    inv_adj:        { label: 'Stock Adjustments',      group: 'Inventory' },
    hr_employees:  { label: 'Employees',              group: 'HR & Payroll' },
    hr_attendance: { label: 'Attendance',             group: 'HR & Payroll' },
    hr_payroll:    { label: 'Payroll Run',            group: 'HR & Payroll' },
    banking:       { label: 'Banking Registries',     group: 'Banking' },
    integrations:  { label: 'Integrations',           group: 'Integrations' },
    reports:       { label: 'Financial Reports',      group: 'Reports' },
    company:       { label: 'Company Setup',          group: 'Company' },
    settings:      { label: 'Application Settings',   group: 'Settings' },
};

/**
 * Maps each sidebar nav item to the permission keys it depends on.
 * A nav item is visible if the user has `view` permission on ANY of these keys.
 */
export const SIDEBAR_PERMISSION_MAP = {
    'Dashboard':           ['dashboard'],
    'General Ledger':      ['gl_coa', 'gl_journal'],
    'Accounts Receivable': ['ar_sales_orders', 'ar_invoices', 'ar_payments', 'ar_credits', 'ar_customers'],
    'Accounts Payable':    ['ap_pos', 'ap_bills', 'ap_payments', 'ap_debits', 'ap_vendors'],
    'Inventory':           ['inv_items', 'inv_categories', 'inv_adj'],
    'HR & Payroll':        ['hr_employees', 'hr_attendance', 'hr_payroll'],
    'Banking':             ['banking'],
    'Integrations':        ['integrations'],
    'Reports':             ['reports'],
    'Company Setup':       ['company'],
    'Settings':            ['settings'],
};

/**
 * Maps each sidebar sub-item path to a specific permission key.
 * Used to filter sub-items within a flyout.
 */
export const SUBITEM_PERMISSION_MAP = {
    '/':                      'dashboard',
    '/gl':                    'gl_coa',
    '/gl/journals':           'gl_journal',
    '/ar/invoices':           'ar_invoices',
    '/ar/sales-orders':       'ar_sales_orders',
    '/ar/payments':           'ar_payments',
    '/ar/credits':            'ar_credits',
    '/ar/customers':          'ar_customers',
    '/ar/categories':         'ar_customers',
    '/ap/pos':                'ap_pos',
    '/ap/bills':              'ap_bills',
    '/ap/payments':           'ap_payments',
    '/ap/debits':             'ap_debits',
    '/ap/vendors':            'ap_vendors',
    '/inventory':              'inv_items',
    '/inventory/items':        'inv_items',
    '/inventory/categories':   'inv_categories',
    '/inventory/adjustments':  'inv_adj',
    '/hr/employees':          'hr_employees',
    '/hr/attendance':         'hr_attendance',
    '/hr/payroll-run':        'hr_payroll',
    '/banking':               'banking',
    '/banking/transfer':      'banking',
    '/banking/expense':       'banking',
    '/banking/income':        'banking',
    '/banking/account':       'banking',
    '/integrations':          'integrations',
    '/reports':               'reports',
    '/company-setup':         'company',
    '/settings':              'settings',
};

/* ---------- helper: full-access permission object ---------- */
const allPermissions = () =>
    Object.keys(MODULE_KEYS).reduce((acc, key) => {
        acc[key] = { view: true, create: true, edit: true, delete: true };
        return acc;
    }, {});

const noPermissions = () =>
    Object.keys(MODULE_KEYS).reduce((acc, key) => {
        acc[key] = { view: false, create: false, edit: false, delete: false };
        return acc;
    }, {});

const VIEW_ONLY_PERMISSION = { view: true, create: false, edit: false, delete: false };
const FULL_PERMISSION = { view: true, create: true, edit: true, delete: true };
const EMPTY_PERMISSION = { view: false, create: false, edit: false, delete: false };

const isFullAccessMatrix = (permissions = {}) => {
    const rows = Object.values(permissions).filter((perm) => perm && typeof perm === 'object');
    if (rows.length === 0) return false;
    return rows.every((perm) => perm.view === true && perm.create === true && perm.edit === true && perm.delete === true);
};

const isViewOnlyMatrix = (permissions = {}) => {
    const rows = Object.values(permissions).filter((perm) => perm && typeof perm === 'object');
    if (rows.length === 0) return false;
    return rows.every((perm) => perm.view === true && perm.create !== true && perm.edit !== true && perm.delete !== true);
};

const missingPermissionTemplate = (role, permissions) => {
    const name = (role?.name || '').toLowerCase();
    const isAdminLike = role?.id === 'role_admin' || name.includes('admin') || isFullAccessMatrix(permissions);
    if (isAdminLike) return FULL_PERMISSION;

    const isViewerLike = role?.id === 'role_viewer' || name.includes('view') || isViewOnlyMatrix(permissions);
    if (isViewerLike) return VIEW_ONLY_PERMISSION;

    return EMPTY_PERMISSION;
};

const normalizeRolePermissions = (role) => {
    const current = role?.permissions || {};
    const fallback = missingPermissionTemplate(role, current);

    const normalized = Object.keys(MODULE_KEYS).reduce((acc, key) => {
        const existing = current[key];
        if (existing && typeof existing === 'object') {
            acc[key] = {
                view: existing.view === true,
                create: existing.create === true,
                edit: existing.edit === true,
                delete: existing.delete === true,
            };
            return acc;
        }

        acc[key] = { ...fallback };
        return acc;
    }, {});

    return { ...role, permissions: normalized };
};

const normalizeRoles = (roles) => {
    if (!Array.isArray(roles) || roles.length === 0) return defaultRoles;
    return roles.map((role) => normalizeRolePermissions(role));
};

/* ---------- default roles ---------- */
const defaultRoles = [
    {
        id: 'role_admin',
        name: 'Administrator',
        isActive: true,
        allowedDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        startTime: '00:00',
        endTime: '23:59',
        permissions: allPermissions(),
    },
    {
        id: 'role_staff',
        name: 'Accounting Staff',
        isActive: true,
        allowedDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        startTime: '08:00',
        endTime: '17:00',
        permissions: {
            ...noPermissions(),
            dashboard:    { view: true, create: false, edit: false, delete: false },
            gl_coa:       { view: true, create: false, edit: false, delete: false },
            gl_journal:   { view: true, create: true,  edit: false, delete: false },
            ar_invoices:  { view: true, create: true,  edit: true,  delete: false },
            ar_sales_orders: { view: true, create: true, edit: true, delete: false },
            ar_payments:  { view: true, create: true,  edit: true,  delete: false },
            ar_credits:   { view: true, create: true,  edit: true,  delete: false },
            ar_customers: { view: true, create: true,  edit: true,  delete: false },
            ap_bills:     { view: true, create: true,  edit: true,  delete: false },
            ap_payments:  { view: true, create: true,  edit: true,  delete: false },
            ap_vendors:   { view: true, create: true,  edit: true,  delete: false },
            inv_items:      { view: true, create: false, edit: false, delete: false },
            inv_categories: { view: true, create: true,  edit: true,  delete: false },
            banking:        { view: true, create: false, edit: false, delete: false },
            reports:      { view: true, create: false, edit: false, delete: false },
        },
    },
    {
        id: 'role_viewer',
        name: 'View Only',
        isActive: true,
        allowedDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        startTime: '08:00',
        endTime: '17:00',
        permissions: Object.keys(MODULE_KEYS).reduce((acc, key) => {
            acc[key] = { view: true, create: false, edit: false, delete: false };
            return acc;
        }, {}),
    },
];

/* ---------- default users ---------- */
const defaultUsers = [
    { id: 'u1', name: 'Admin User',  email: 'admin@msm.com', roleId: 'role_admin',  status: 'Active' },
    { id: 'u2', name: 'Staff User',  email: 'staff@msm.com', roleId: 'role_staff',  status: 'Active' },
    { id: 'u3', name: 'Viewer User', email: 'viewer@msm.com', roleId: 'role_viewer', status: 'Active' },
];

/* ================================================================
   Zustand Store
   ================================================================ */
export const useAccessStore = create(
    persist(
        (set, get) => ({
            /* ---- data ---- */
            roles: defaultRoles,
            users: defaultUsers,
            currentUserId: 'u1',          // default: Admin

            /* ---- current user helpers ---- */
            getCurrentUser: () => {
                const state = get();
                return state.users.find(u => u.id === state.currentUserId) || state.users[0];
            },
            getCurrentRole: () => {
                const state = get();
                const user = state.users.find(u => u.id === state.currentUserId) || state.users[0];
                return state.roles.find(r => r.id === user.roleId) || state.roles[0];
            },

            /* ---- permission check helpers ---- */
            /**
             * Check if current user has a specific permission.
             * e.g. hasPermission('ar_invoices', 'create')
             */
            hasPermission: (moduleKey, action) => {
                const role = get().getCurrentRole();
                if (!role || !role.permissions[moduleKey]) return false;
                return role.permissions[moduleKey][action] === true;
            },

            /**
             * Check if a sidebar nav item should be visible.
             * Returns true if user has `view` on ANY of the item's module keys.
             */
            canSeeSidebarItem: (navLabel) => {
                const role = get().getCurrentRole();
                const keys = SIDEBAR_PERMISSION_MAP[navLabel];
                if (!keys) return true; // unknown items are visible
                return keys.some(k => role.permissions[k]?.view === true);
            },

            /**
             * Check if a specific sub-item path should be visible.
             */
            canSeeSubItem: (path) => {
                const role = get().getCurrentRole();
                const key = SUBITEM_PERMISSION_MAP[path];
                if (!key) return true; // unknown paths are visible
                return role.permissions[key]?.view === true;
            },

            /* ---- mutations ---- */
            switchUser: (userId) => set({ currentUserId: userId }),

            addRole: (role) => set(state => ({ roles: [...state.roles, role] })),

            updateRole: (updatedRole) =>
                set(state => ({
                    roles: state.roles.map(r => r.id === updatedRole.id ? updatedRole : r),
                })),

            deleteRole: (roleId) =>
                set(state => ({
                    roles: state.roles.filter(r => r.id !== roleId),
                })),

            addUser: (user) =>
                set(state => ({
                    users: [...state.users, { ...user, id: `u${Date.now()}`, status: 'Active' }],
                })),

            updateUser: (updatedUser) =>
                set(state => ({
                    users: state.users.map(u => u.id === updatedUser.id ? updatedUser : u),
                })),

            deleteUser: (userId) =>
                set(state => ({
                    users: state.users.filter(u => u.id !== userId),
                })),

            /* ---- reset ---- */
            resetToDefaults: () => set({ roles: defaultRoles, users: defaultUsers, currentUserId: 'u1' }),
        }),
        {
            name: 'msm-access',
            version: 2,
            migrate: (persistedState) => {
                if (!persistedState || typeof persistedState !== 'object') {
                    return {
                        roles: defaultRoles,
                        users: defaultUsers,
                        currentUserId: 'u1',
                    };
                }

                const users = Array.isArray(persistedState.users) && persistedState.users.length > 0
                    ? persistedState.users
                    : defaultUsers;
                const currentUserId = persistedState.currentUserId || users[0]?.id || 'u1';

                return {
                    ...persistedState,
                    roles: normalizeRoles(persistedState.roles),
                    users,
                    currentUserId,
                };
            },
        }
    )
);

/* ---------- Export helpers for non-hook contexts ---------- */
export { allPermissions, noPermissions, MODULE_KEYS as moduleKeys };

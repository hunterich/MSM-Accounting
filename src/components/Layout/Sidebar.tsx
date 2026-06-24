import React, { useState, useMemo, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    BookOpen,
    Receipt,
    Truck,
    Wallet,
    Users,
    CheckSquare,
    ShoppingBag,
    ShoppingCart,
    Boxes,
    Package,
    PackageCheck,
    Landmark,
    BarChart3,
    Building2,
    Settings,
    ArrowRightLeft,
    ArrowUpRight,
    ArrowDownLeft,
    FileText,
    ChevronDown,
    Menu,
    X,
    ClipboardCheck,
    type LucideIcon,
} from 'lucide-react';
import { SIDEBAR_PERMISSION_MAP, SUBITEM_PERMISSION_MAP } from '../../stores/useAccessStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useSettingsStore, type FeatureFlags } from '../../stores/useSettingsStore';

interface SubItem {
    label: string;
    path: string;
    icon: LucideIcon;
    badgeKey?: string;
}
interface NavGroup {
    group: string;
    groupIcon: LucideIcon;
    items: SubItem[];
}

const NAV_GROUPS: NavGroup[] = [
    {
        group: 'Workspace',
        groupIcon: LayoutDashboard,
        items: [{ label: 'Dashboard', path: '/', icon: LayoutDashboard }],
    },
    {
        group: 'Sales',
        groupIcon: Receipt,
        items: [
            { label: 'Sales Orders',   path: '/ar/sales-orders',   icon: ShoppingBag },
            { label: 'Invoices',       path: '/ar/invoices',       icon: Receipt, badgeKey: 'overdue_invoices' },
            { label: 'Delivery Notes', path: '/ar/delivery-notes', icon: Truck },
            { label: 'Payments',       path: '/ar/payments',       icon: Wallet },
            { label: 'Returns & Credits', path: '/ar/credits',     icon: Receipt },
            { label: 'Recurring Billing', path: '/ar/recurring',   icon: Receipt },
            { label: 'Customers',      path: '/ar/customers',      icon: Users },
            { label: 'Customer Categories', path: '/ar/categories', icon: Users },
            { label: 'Approvals',      path: '/ar/approvals',      icon: CheckSquare, badgeKey: 'pending_approvals' },
            { label: 'Shop Integrations', path: '/integrations',   icon: Building2 },
        ],
    },
    {
        group: 'Purchases',
        groupIcon: ShoppingCart,
        items: [
            { label: 'Purchase Orders', path: '/ap/pos',      icon: ShoppingBag },
            { label: 'Receive Goods',   path: '/ap/receiving', icon: PackageCheck },
            { label: 'Bills',           path: '/ap/bills',    icon: Receipt, badgeKey: 'overdue_bills' },
            { label: 'Payments',        path: '/ap/payments', icon: Wallet },
            { label: 'Returns & Debits',path: '/ap/debits',   icon: Receipt },
            { label: 'Recurring Expenses', path: '/ap/recurring', icon: Receipt },
            { label: 'Vendors',         path: '/ap/vendors',  icon: Building2 },
            { label: 'Vendor Categories', path: '/ap/vendor-categories', icon: Building2 },
        ],
    },
    {
        group: 'Cash & Bank',
        groupIcon: Landmark,
        items: [
            { label: 'Payment',        path: '/banking/payment',        icon: ArrowUpRight },
            { label: 'Receive',        path: '/banking/receive',        icon: ArrowDownLeft },
            { label: 'Bank Transfer',  path: '/banking/transfer',       icon: ArrowRightLeft },
            { label: 'Bank Accounts',  path: '/banking',                icon: Wallet },
            { label: 'Reconciliation', path: '/banking/reconciliation', icon: CheckSquare },
        ],
    },
    {
        group: 'Inventory',
        groupIcon: Package,
        items: [
            { label: 'Items',            path: '/inventory/items',      icon: Package },
            { label: 'Item Categories',  path: '/inventory/categories', icon: Boxes },
            { label: 'Stock Counts',     path: '/inventory/counts',     icon: ClipboardCheck },
            { label: 'Stock Adjustments',path: '/inventory/adjustments',icon: PackageCheck },
        ],
    },
    {
        group: 'General Ledger',
        groupIcon: BookOpen,
        items: [
            { label: 'Chart of Accounts', path: '/gl',          icon: BookOpen },
            { label: 'Journal Entries',   path: '/gl/journals', icon: FileText },
        ],
    },
    {
        group: 'Reports',
        groupIcon: BarChart3,
        items: [
            { label: 'Reports', path: '/reports', icon: BarChart3 },
        ],
    },
    {
        group: 'Operations',
        groupIcon: Boxes,
        items: [
            { label: 'HR & Payroll',  path: '/hr',         icon: Users },
            { label: 'Assets',        path: '/assets',     icon: Building2 },
            { label: 'Settings',      path: '/settings',   icon: Settings },
        ],
    },
];

const PARENT_LABEL_FOR: Record<string, string> = {
    '/': 'Dashboard',
    '/gl': 'General Ledger',
    '/ar/sales-orders': 'Accounts Receivable', '/ar/invoices': 'Accounts Receivable',
    '/ar/delivery-notes': 'Accounts Receivable', '/ar/payments': 'Accounts Receivable',
    '/ar/credits': 'Accounts Receivable', '/ar/recurring': 'Accounts Receivable',
    '/ar/customers': 'Accounts Receivable',
    '/ar/categories': 'Accounts Receivable', '/ar/approvals': 'Accounts Receivable',
    '/integrations': 'Accounts Receivable',
    '/ap/pos': 'Accounts Payable', '/ap/receiving': 'Accounts Payable', '/ap/bills': 'Accounts Payable',
    '/ap/payments': 'Accounts Payable', '/ap/debits': 'Accounts Payable',
    '/ap/recurring': 'Accounts Payable',
    '/ap/vendors': 'Accounts Payable', '/ap/vendor-categories': 'Accounts Payable',
    '/inventory': 'Inventory',
    '/banking': 'Banking',
    '/hr': 'HR & Payroll',
    '/assets': 'Assets',
    '/reports': 'Reports',
    '/settings': 'Settings',
};

const COLLAPSED_KEY = 'msm.sidebar.collapsed';

/**
 * Maps a sidebar sub-item path to a feature flag in useSettingsStore.features.
 * When the flag is false, the item is hidden regardless of RBAC. Paths NOT in
 * this map are always feature-allowed (gated only by RBAC).
 */
const SUBITEM_FEATURE_MAP: Record<string, keyof FeatureFlags> = {
    '/ar/sales-orders':       'salesOrders',
    '/ar/credits':            'salesReturns',
    '/ar/recurring':          'recurringInvoices',
    '/ap/recurring':          'recurringExpenses',
    '/ar/delivery-notes':     'deliveryNotes',
    '/ar/categories':         'customerCategories',
    '/ar/approvals':          'approvals',
    '/integrations':          'shopIntegrations',
    '/ap/pos':                'purchaseOrders',
    '/ap/receiving':          'purchaseOrders',
    '/ap/vendor-categories':  'vendorCategories',
    '/inventory/categories':  'itemCategories',
    '/assets':                'fixedAssets',
    '/hr':                    'hrPayroll',
    '/hr/employees':          'hrPayroll',
    '/hr/attendance':         'hrPayroll',
    '/hr/payroll-run':        'hrPayroll',
};
const allGroupsCollapsed = (): Record<string, boolean> =>
    NAV_GROUPS.reduce<Record<string, boolean>>((acc, g) => { acc[g.group] = true; return acc; }, {});

const Sidebar = (): React.ReactElement => {
    const location = useLocation();
    const permissions = useAuthStore((s) => s.permissions);
    const hasPermission = useAuthStore((s) => s.hasPermission);
    const features = useSettingsStore((s) => s.features);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
        try {
            const raw = localStorage.getItem(COLLAPSED_KEY);
            return raw ? JSON.parse(raw) : allGroupsCollapsed();
        } catch { return allGroupsCollapsed(); }
    });
    // Rail flyout: which group's pop-out panel is open (desktop icon rail). Only one at a time.
    const [openGroup, setOpenGroup] = useState<string | null>(null);
    const railRef = useRef<HTMLElement | null>(null);
    // Trigger buttons by group, so we can restore focus to the trigger when its flyout closes.
    const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    const closeFlyout = (restoreGroup?: string): void => {
        setOpenGroup(null);
        if (restoreGroup) triggerRefs.current[restoreGroup]?.focus();
    };

    useEffect(() => {
        try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsedGroups)); } catch { /* noop */ }
    }, [collapsedGroups]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpenGroup(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // Close the rail flyout whenever the route changes (e.g. after clicking a flyout link).
    useEffect(() => { setOpenGroup(null); }, [location.pathname]);

    // Close the rail flyout on any click outside the rail.
    useEffect(() => {
        if (!openGroup) return;
        const onDown = (e: MouseEvent) => {
            if (railRef.current && !railRef.current.contains(e.target as Node)) setOpenGroup(null);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [openGroup]);

    const canSeeSubItem = (path: string): boolean => {
        // Feature-flag gate first — bail early if the org has the module off.
        const featureKey = SUBITEM_FEATURE_MAP[path];
        if (featureKey && features?.[featureKey] === false) return false;

        // RBAC check (unchanged).
        const key = SUBITEM_PERMISSION_MAP[path];
        if (!key) {
            const parent = PARENT_LABEL_FOR[path];
            const parentKeys = parent ? SIDEBAR_PERMISSION_MAP[parent] : null;
            if (parentKeys) return parentKeys.some((k) => hasPermission(k, 'view'));
            return true;
        }
        return hasPermission(key, 'view');
    };

    const visibleGroups = useMemo(
        () => NAV_GROUPS.map(g => ({
            ...g,
            items: g.items.filter(it => canSeeSubItem(it.path)),
        })).filter(g => g.items.length > 0),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [permissions, features],
    );

    const toggleGroup = (g: string) => setCollapsedGroups(s => {
        // Accordion behavior: expanding a group collapses the others. Collapsing
        // the open group leaves the rest collapsed (already are).
        const isCurrentlyCollapsed = s[g] !== false;
        if (isCurrentlyCollapsed) {
            const next = allGroupsCollapsed();
            next[g] = false;
            return next;
        }
        return { ...s, [g]: true };
    });

    const isItemActive = (path: string): boolean => {
        if (path === '/') return location.pathname === '/';
        if (path === '/gl') return location.pathname === '/gl';
        if (path === '/banking') return location.pathname === '/banking';
        return location.pathname.startsWith(path);
    };

    const isGroupActive = (g: NavGroup): boolean =>
        g.items.some(it => isItemActive(it.path));

    // ── Desktop icon rail: logo + one icon per group, hover tooltip, click flyout ──
    const RailBody = (
        <nav ref={railRef} className="sidebar-rail hidden md:flex" aria-label="Primary">
            <div className="sidebar-logo">
                <span className="sidebar-logo-text" aria-hidden="true">M</span>
            </div>

            <div className="sidebar-icons">
                {visibleGroups.map(g => {
                    const GroupIcon = g.groupIcon;
                    const groupActive = isGroupActive(g);
                    const isOpen = openGroup === g.group;
                    const single = g.items.length === 1;

                    return (
                        <div key={g.group} className="sidebar-icon-wrapper">
                            {single ? (
                                <NavLink
                                    to={g.items[0].path}
                                    end={g.items[0].path === '/'}
                                    className={`sidebar-icon-btn ${groupActive ? 'active' : ''}`}
                                    aria-label={g.group}
                                >
                                    <GroupIcon size={18} strokeWidth={1.8} />
                                </NavLink>
                            ) : (
                                <button
                                    type="button"
                                    ref={el => { triggerRefs.current[g.group] = el; }}
                                    className={`sidebar-icon-btn ${groupActive || isOpen ? 'active' : ''}`}
                                    onClick={() => setOpenGroup(prev => (prev === g.group ? null : g.group))}
                                    aria-label={g.group}
                                    aria-expanded={isOpen}
                                    aria-haspopup="true"
                                >
                                    <GroupIcon size={18} strokeWidth={1.8} />
                                </button>
                            )}

                            {!isOpen && <span className="sidebar-tooltip">{g.group}</span>}

                            {isOpen && !single && (
                                <div
                                    className="sidebar-flyout"
                                    aria-label={g.group}
                                    onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); closeFlyout(g.group); } }}
                                >
                                    <div className="sidebar-flyout-title">{g.group}</div>
                                    {g.items.map(it => {
                                        const ItemIcon = it.icon;
                                        const active = isItemActive(it.path);
                                        return (
                                            <NavLink
                                                key={it.path}
                                                to={it.path}
                                                end={it.path === '/'}
                                                className={`sidebar-flyout-item ${active ? 'active' : ''}`}
                                            >
                                                <ItemIcon size={16} strokeWidth={1.7} />
                                                <span>{it.label}</span>
                                            </NavLink>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <RailFooter />
        </nav>
    );

    const SidebarBody = (
        <nav className="w-[240px] h-full bg-[#0e1730] flex flex-col text-white flex-shrink-0" aria-label="Primary">
            <div className="h-[52px] px-4 flex items-center gap-2 border-b border-white/10 flex-shrink-0">
                <div className="w-7 h-7 rounded-md bg-primary-700 flex items-center justify-center font-bold text-sm">M</div>
                <div className="font-semibold text-[14px]">MSM Accounting</div>
            </div>

            <div className="flex-1 overflow-y-auto py-2 min-h-0">
                {visibleGroups.map(g => {
                    const collapsed = collapsedGroups[g.group];
                    return (
                        <div key={g.group} className="mb-1">
                            <button
                                type="button"
                                onClick={() => toggleGroup(g.group)}
                                className="w-full px-4 pt-3 pb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45 hover:text-white/70 transition-colors"
                            >
                                <span className={`inline-flex transition-transform ${collapsed ? '-rotate-90' : ''}`}>
                                    <ChevronDown size={10} />
                                </span>
                                <span>{g.group}</span>
                            </button>
                            {!collapsed && g.items.map(it => {
                                const Icon = it.icon;
                                const active = isItemActive(it.path);
                                return (
                                    <NavLink
                                        key={it.path}
                                        to={it.path}
                                        end={it.path === '/'}
                                        onClick={() => setMobileOpen(false)}
                                        className={({ isActive }) => {
                                            const a = isActive || active;
                                            return `relative w-full text-left pl-7 pr-3 py-1.5 flex items-center gap-2.5 text-[13px] transition-colors ${
                                                a ? 'bg-white/8 text-white font-medium' : 'text-white/70 hover:text-white hover:bg-white/5'
                                            }`;
                                        }}
                                    >
                                        {({ isActive }) => {
                                            const a = isActive || active;
                                            return (
                                                <>
                                                    {a && <span className="absolute left-0 top-1 bottom-1 w-[3px] bg-primary-400 rounded-r" />}
                                                    <span className={a ? 'text-primary-300' : 'text-white/55'}><Icon size={15} strokeWidth={1.6} /></span>
                                                    <span className="flex-1 truncate">{it.label}</span>
                                                </>
                                            );
                                        }}
                                    </NavLink>
                                );
                            })}
                        </div>
                    );
                })}
            </div>

            <UserFooter />
        </nav>
    );

    return (
        <>
            <div className="fixed top-0 left-0 right-0 h-14 bg-[#0e1730] flex md:hidden items-center px-4 z-50">
                <button type="button" onClick={() => setMobileOpen(true)} className="text-white p-1 mr-3" aria-label="Open menu">
                    <Menu size={24} />
                </button>
                <span className="text-white font-semibold text-base">MSM Accounting</span>
            </div>

            {mobileOpen && (
                <div className="fixed inset-0 z-[60] md:hidden">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
                    <div className="absolute top-0 left-0 h-full">
                        <div className="h-full flex flex-col bg-[#0e1730]">
                            <div className="flex items-center justify-between h-14 px-4 border-b border-white/10">
                                <span className="text-white font-semibold text-base">MSM Accounting</span>
                                <button type="button" onClick={() => setMobileOpen(false)} className="text-white p-1" aria-label="Close menu">
                                    <X size={22} />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto">{SidebarBody}</div>
                        </div>
                    </div>
                </div>
            )}

            {RailBody}
        </>
    );
};

function RailFooter(): React.ReactElement {
    const user = useAuthStore((s) => s.user);
    const roleType = useAuthStore((s) => s.roleType);
    const initials = (user?.fullName || user?.email || 'U')
        .split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
    return (
        <div className="sidebar-icon-wrapper" style={{ marginTop: 'auto', marginBottom: 4 }}>
            <NavLink to="/settings" className="sidebar-icon-btn" aria-label={user?.fullName || 'Account'}>
                <span className="sidebar-avatar">{initials}</span>
            </NavLink>
            <span className="sidebar-tooltip">{user?.fullName || user?.email || 'Account'}{roleType ? ` · ${roleType}` : ''}</span>
        </div>
    );
}

const UserFooter = (): React.ReactElement => {
    const user = useAuthStore((s) => s.user);
    const roleType = useAuthStore((s) => s.roleType);
    const initials = (user?.fullName || user?.email || 'U')
        .split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
    return (
        <div className="p-3 border-t border-white/10 flex items-center gap-2.5 flex-shrink-0">
            <div className="w-7 h-7 rounded-full bg-primary-600 flex items-center justify-center text-[11px] font-semibold flex-shrink-0">
                {initials}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium truncate">{user?.fullName || user?.email || 'Signed in'}</div>
                {roleType && <div className="text-[10px] text-white/50 truncate">{roleType}</div>}
            </div>
            <NavLink to="/settings" className="text-white/55 hover:text-white" aria-label="Settings">
                <Settings size={14} />
            </NavLink>
        </div>
    );
};

export default Sidebar;

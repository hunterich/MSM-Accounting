import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    BookOpen,
    ArrowDownLeft,
    ArrowUpRight,
    Package,
    Landmark,
    BarChart3,
    Settings,
    Users,
    Menu,
    X,
    type LucideIcon,
} from 'lucide-react';
import { SIDEBAR_PERMISSION_MAP, SUBITEM_PERMISSION_MAP } from '../../stores/useAccessStore';
import { useAuthStore } from '../../stores/useAuthStore';

interface SubItem {
    label: string;
    path: string;
}

interface NavItem {
    label: string;
    path: string;
    icon: LucideIcon;
    subItems: SubItem[];
}

const navItems: NavItem[] = [
    {
        label: 'Dashboard',
        path: '/',
        icon: LayoutDashboard,
        subItems: [
            { label: 'Overview', path: '/' }
        ]
    },
    {
        label: 'General Ledger',
        path: '/gl',
        icon: BookOpen,
        subItems: [
            { label: 'Chart of Accounts', path: '/gl' },
            { label: 'Journal Entries', path: '/gl/journals' }
        ]
    },
    {
        label: 'Accounts Receivable',
        path: '/ar',
        icon: ArrowDownLeft,
        subItems: [
            { label: 'Sales Orders', path: '/ar/sales-orders' },
            { label: 'Invoices', path: '/ar/invoices' },
            { label: 'Delivery Notes', path: '/ar/delivery-notes' },
            { label: 'Payments', path: '/ar/payments' },
            { label: 'Returns & Credits', path: '/ar/credits' },
            { label: 'Customers', path: '/ar/customers' },
            { label: 'Customer Categories', path: '/ar/categories' },
            { label: 'Shop Integrations', path: '/integrations' }
        ]
    },
    {
        label: 'Accounts Payable',
        path: '/ap',
        icon: ArrowUpRight,
        subItems: [
            { label: 'Purchase Orders', path: '/ap/pos' },
            { label: 'Bills', path: '/ap/bills' },
            { label: 'Payments', path: '/ap/payments' },
            { label: 'Returns & Debits', path: '/ap/debits' },
            { label: 'Vendors', path: '/ap/vendors' },
            { label: 'Vendor Categories', path: '/ap/vendor-categories' }
        ]
    },
    {
        label: 'Inventory',
        path: '/inventory',
        icon: Package,
        subItems: [
            { label: 'Items', path: '/inventory/items' },
            { label: 'Categories', path: '/inventory/categories' },
            { label: 'Adjustments', path: '/inventory/adjustments' },
            { label: 'Stock Valuation', path: '/inventory/valuation' }
        ]
    },
    {
        label: 'Banking',
        path: '/banking',
        icon: Landmark,
        subItems: [
            { label: 'Accounts & Transactions', path: '/banking' },
            { label: 'Transfer', path: '/banking/transfer' },
            { label: 'Record Expense', path: '/banking/expense' },
            { label: 'Record Income', path: '/banking/income' },
            { label: 'Add Account', path: '/banking/account' }
        ]
    },
    {
        label: 'HR & Payroll',
        path: '/hr',
        icon: Users,
        subItems: [
            { label: 'Employees', path: '/hr/employees' },
            { label: 'Attendance', path: '/hr/attendance' },
            { label: 'Payroll Run', path: '/hr/payroll-run' }
        ]
    },
    {
        label: 'Reports',
        path: '/reports',
        icon: BarChart3,
        subItems: [
            { label: 'All Reports', path: '/reports' }
        ]
    },
    {
        label: 'Settings',
        path: '/settings',
        icon: Settings,
        subItems: [
            { label: 'General Settings', path: '/settings' }
        ]
    },
];

interface SidebarIconProps {
    item: NavItem;
    isActive: boolean;
    onFlyoutOpen: (label: string) => void;
    onFlyoutClose: () => void;
    flyoutOpen: boolean;
}

const SidebarIcon = ({ item, isActive, onFlyoutOpen, onFlyoutClose, flyoutOpen }: SidebarIconProps): React.ReactElement => {
    const Icon = item.icon;

    const btnClass = `sidebar-icon-btn${isActive ? ' active' : ''}`;

    return (
        <div
            className="sidebar-icon-wrapper"
            onMouseEnter={() => onFlyoutOpen(item.label)}
            onMouseLeave={onFlyoutClose}
        >
            <button type="button" className={btnClass}>
                <Icon size={22} strokeWidth={1.6} />
            </button>
            {!flyoutOpen && <span className="sidebar-tooltip">{item.label}</span>}
            {flyoutOpen && (
                <div className="sidebar-flyout">
                    <div className="sidebar-flyout-title">{item.label}</div>
                    {item.subItems.map(sub => (
                        <NavLink
                            key={sub.path}
                            to={sub.path}
                            className={({ isActive: subActive }) =>
                                `sidebar-flyout-item${subActive ? ' active' : ''}`
                            }
                            end
                            onClick={onFlyoutClose}
                        >
                            {sub.label}
                        </NavLink>
                    ))}
                </div>
            )}
        </div>
    );
};

const Sidebar = (): React.ReactElement => {
    const location = useLocation();
    const [flyout, setFlyout] = useState<string | null>(null);
    const [mobileOpen, setMobileOpen] = useState(false);
    const hasPermission = useAuthStore((s) => s.hasPermission);

    const canSeeSidebarItem = (navLabel: string): boolean => {
        const keys = SIDEBAR_PERMISSION_MAP[navLabel];
        if (!keys) return true;
        return keys.some((key) => hasPermission(key, 'view'));
    };

    const canSeeSubItem = (path: string): boolean => {
        const key = SUBITEM_PERMISSION_MAP[path];
        if (!key) return true;
        return hasPermission(key, 'view');
    };

    // Filter nav items based on current user's role permissions
    const visibleNavItems = navItems
        .filter(item => canSeeSidebarItem(item.label))
        .map(item => ({
            ...item,
            subItems: item.subItems.filter(sub => canSeeSubItem(sub.path))
        }))
        // If all sub-items are filtered out, hide the parent too
        .filter(item => item.subItems.length > 0);

    const isItemActive = (item: NavItem): boolean => {
        if (location.pathname === item.path) return true;
        return item.subItems.some(sub => {
            if (sub.path === '/') return location.pathname === '/';
            if (sub.path === '/gl') return location.pathname === '/gl';
            if (sub.path === '/inventory') return location.pathname === '/inventory';
            return location.pathname.startsWith(sub.path);
        });
    };

    return (
        <>
            {/* Mobile top bar — visible only below md breakpoint */}
            <div className="fixed top-0 left-0 right-0 h-14 bg-[#1a2035] flex md:hidden items-center px-4 z-50">
                <button
                    type="button"
                    onClick={() => setMobileOpen(true)}
                    className="text-white p-1 mr-3"
                    aria-label="Open menu"
                >
                    <Menu size={24} />
                </button>
                <span className="text-white font-semibold text-base">MSM Accounting</span>
            </div>

            {/* Mobile slide-over overlay */}
            {mobileOpen && (
                <div className="fixed inset-0 z-[60] md:hidden">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/50"
                        onClick={() => setMobileOpen(false)}
                    />
                    {/* Slide-over panel */}
                    <div className="absolute top-0 left-0 h-full w-64 bg-[#1a2035] flex flex-col overflow-y-auto">
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 h-14 shrink-0 border-b border-white/10">
                            <span className="text-white font-semibold text-base">MSM Accounting</span>
                            <button
                                type="button"
                                onClick={() => setMobileOpen(false)}
                                className="text-white p-1"
                                aria-label="Close menu"
                            >
                                <X size={22} />
                            </button>
                        </div>
                        {/* Nav items */}
                        <nav className="flex flex-col py-2">
                            {visibleNavItems.map(item => {
                                const Icon = item.icon;
                                const active = isItemActive(item);
                                return (
                                    <div key={item.label} className="mb-1">
                                        <div className={`flex items-center gap-3 px-4 py-2 text-sm font-semibold ${active ? 'text-white' : 'text-white/60'}`}>
                                            <Icon size={18} strokeWidth={1.6} />
                                            {item.label}
                                        </div>
                                        {item.subItems.map(sub => (
                                            <NavLink
                                                key={sub.path}
                                                to={sub.path}
                                                end
                                                onClick={() => setMobileOpen(false)}
                                                className={({ isActive: subActive }) =>
                                                    `block pl-11 pr-4 py-1.5 text-sm ${subActive ? 'text-white font-medium' : 'text-white/50 hover:text-white/80'}`
                                                }
                                            >
                                                {sub.label}
                                            </NavLink>
                                        ))}
                                    </div>
                                );
                            })}
                        </nav>
                    </div>
                </div>
            )}

            {/* Desktop sidebar rail — hidden on mobile */}
            <nav className="sidebar-rail hidden md:flex flex-col">
                {/* Logo */}
                <div className="sidebar-logo">
                    <span className="sidebar-logo-text">M</span>
                </div>

                {/* Nav icons */}
                <div className="sidebar-icons">
                    {visibleNavItems.map(item => (
                        <SidebarIcon
                            key={item.label}
                            item={item}
                            isActive={isItemActive(item)}
                            flyoutOpen={flyout === item.label}
                            onFlyoutOpen={setFlyout}
                            onFlyoutClose={() => setFlyout(null)}
                        />
                    ))}
                </div>
            </nav>
        </>
    );
};

export default Sidebar;

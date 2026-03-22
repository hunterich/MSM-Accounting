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
    ShoppingBag,
    Briefcase,
    Users
} from 'lucide-react';
import { useAccessStore } from '../../stores/useAccessStore';

const navItems = [
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
            { label: 'Payments', path: '/ar/payments' },
            { label: 'Returns & Credits', path: '/ar/credits' },
            { label: 'Customers', path: '/ar/customers' },
            { label: 'Customer Categories', path: '/ar/categories' }
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
            { label: 'Vendors', path: '/ap/vendors' }
        ]
    },
    {
        label: 'Inventory',
        path: '/inventory',
        icon: Package,
        subItems: [
            { label: 'Items', path: '/inventory/items' },
            { label: 'Adjustments', path: '/inventory/adjustments' }
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
        label: 'Integrations',
        path: '/integrations',
        icon: ShoppingBag,
        subItems: [
            { label: 'Shop Connections', path: '/integrations' }
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
        label: 'Company Setup',
        path: '/company-setup',
        icon: Briefcase,
        subItems: [
            { label: 'Company Info', path: '/company-setup' }
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

const SidebarIcon = ({ item, isActive, onFlyoutOpen, onFlyoutClose, flyoutOpen }) => {
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

const Sidebar = () => {
    const location = useLocation();
    const [flyout, setFlyout] = useState(null);

    // RBAC: get permission check functions from the access store
    const canSeeSidebarItem = useAccessStore(s => s.canSeeSidebarItem);
    const canSeeSubItem = useAccessStore(s => s.canSeeSubItem);

    // Filter nav items based on current user's role permissions
    const visibleNavItems = navItems
        .filter(item => canSeeSidebarItem(item.label))
        .map(item => ({
            ...item,
            subItems: item.subItems.filter(sub => canSeeSubItem(sub.path))
        }))
        // If all sub-items are filtered out, hide the parent too
        .filter(item => item.subItems.length > 0);

    const isItemActive = (item) => {
        if (location.pathname === item.path) return true;
        return item.subItems.some(sub => {
            if (sub.path === '/') return location.pathname === '/';
            if (sub.path === '/gl') return location.pathname === '/gl';
            if (sub.path === '/inventory') return location.pathname === '/inventory';
            return location.pathname.startsWith(sub.path);
        });
    };

    return (
        <nav className="sidebar-rail">
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
    );
};

export default Sidebar;

import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { UserCircle } from 'lucide-react';
import Sidebar from './Sidebar';
import Button from '../UI/Button';
import { useAuthStore } from '../../stores/useAuthStore';

const Layout = () => {
    const navigate = useNavigate();
    const user = useAuthStore((s) => s.user);
    const org = useAuthStore((s) => s.org);
    const logout = useAuthStore((s) => s.logout);

    const handleLogout = async () => {
        await logout();
        navigate('/login', { replace: true });
    };

    return (
        <div className="flex h-screen w-screen overflow-hidden">
            <Sidebar />
            <div className="flex flex-col flex-1 min-w-0 h-screen overflow-hidden">
                <header className="bg-neutral-0 border-b border-neutral-200 flex items-center justify-between px-6 h-14 shrink-0">
                    <h2 className="text-lg font-semibold text-neutral-900 m-0">MSM Accounting</h2>

                    <div className="flex items-center gap-3">
                        <UserCircle size={20} className="text-neutral-400" />
                        <span className="text-sm text-neutral-600">{org?.name || 'Organization'}</span>
                        <span className="text-sm font-medium text-neutral-800">{user?.fullName || 'User'}</span>
                        <Button text="Logout" size="small" variant="tertiary" onClick={handleLogout} />
                    </div>
                </header>
                <main id="main-content" className="overflow-y-auto flex-1 p-8 bg-neutral-50 relative">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default Layout;

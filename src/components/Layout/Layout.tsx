import React from 'react';
import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { UserCircle } from 'lucide-react';
import Sidebar from './Sidebar';
import CompanySwitcher from './CompanySwitcher';
import Button from '../UI/Button';
import Toaster from '../UI/Toaster';
import { useAuthStore } from '../../stores/useAuthStore';
import ChangePasswordModal from '../auth/ChangePasswordModal';
import { WORKSPACE_TABS_ENABLED } from '../../config/featureFlags';
import WorkspaceShell from '../workspace/WorkspaceShell';

const Layout = (): React.ReactElement => {
    const navigate = useNavigate();
    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);
    const [showChangePassword, setShowChangePassword] = useState(false);

    const handleLogout = async (): Promise<void> => {
        await logout();
        navigate('/login', { replace: true });
    };

    return (
        <div className="flex h-screen w-screen overflow-hidden">
            <Sidebar />
            <div className="flex flex-col flex-1 min-w-0 h-screen overflow-hidden">
                <header className="bg-neutral-0 border-b border-neutral-200 flex items-center justify-between px-6 h-14 shrink-0 hidden md:flex">
                    <h2 className="text-lg font-semibold text-neutral-900 m-0">MSM Accounting</h2>

                    <div className="flex items-center gap-3">
                        <UserCircle size={20} className="text-neutral-400" />
                        <CompanySwitcher />
                        <span className="text-sm font-medium text-neutral-800">{user?.fullName || 'User'}</span>
                        <Button text="Change Password" size="small" variant="tertiary" onClick={() => setShowChangePassword(true)} />
                        <Button text="Logout" size="small" variant="tertiary" onClick={handleLogout} />
                        <ChangePasswordModal isOpen={showChangePassword} onClose={() => setShowChangePassword(false)} />
                    </div>
                </header>
                <main id="main-content" className="overflow-y-auto flex-1 p-8 bg-neutral-50 relative pt-14 md:pt-8">
                    {WORKSPACE_TABS_ENABLED ? <WorkspaceShell /> : <Outlet />}
                </main>
            </div>
            <Toaster />
        </div>
    );
};

export default Layout;

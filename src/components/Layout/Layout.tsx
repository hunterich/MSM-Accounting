import React from 'react';
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, HelpCircle, Bell, KeyRound, LogOut, ChevronDown } from 'lucide-react';
import Sidebar from './Sidebar';
import CompanySwitcher from './CompanySwitcher';
import Toaster from '../UI/Toaster';
import { useAuthStore } from '../../stores/useAuthStore';
import ChangePasswordModal from '../auth/ChangePasswordModal';
import WorkspaceShell from '../workspace/WorkspaceShell';

/**
 * Application shell, laid out the way Accurate Online lays its window out:
 *
 *   ┌──┬──────────────────────────────────────────────┐
 *   │  │  thin brand bar — identity + global actions  │  34px
 *   │r ├──────────────────────────────────────────────┤
 *   │a │  document tab strip (workspace mode)         │
 *   │i ├──────────────────────────────────────────────┤
 *   │l │  full-bleed work surface                     │
 *   └──┴──────────────────────────────────────────────┘
 *
 * The header is deliberately short and carries no page title — in Accurate the
 * tab names the document, so the bar only holds who you are and where you are.
 */
const Layout = (): React.ReactElement => {
    const navigate = useNavigate();
    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);
    const [showChangePassword, setShowChangePassword] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
        };
        const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onEsc);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onEsc);
        };
    }, []);

    const handleLogout = async (): Promise<void> => {
        await logout();
        navigate('/login', { replace: true });
    };

    const initials = (user?.fullName || user?.email || 'U')
        .split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

    return (
        <div className="flex h-screen w-screen overflow-hidden">
            <Sidebar />
            <div className="flex flex-col flex-1 min-w-0 h-screen overflow-hidden">
                <header className="acc-topbar hidden md:flex">
                    <div className="acc-topbar-brand">
                        MSM <small>accounting</small>
                    </div>

                    <div className="acc-topbar-tools">
                        <button type="button" className="acc-topbar-icon" aria-label="Search" title="Search">
                            <Search size={15} />
                        </button>
                        <button type="button" className="acc-topbar-icon" aria-label="Help" title="Help">
                            <HelpCircle size={15} />
                        </button>
                        <button type="button" className="acc-topbar-icon" aria-label="Notifications" title="Notifications">
                            <Bell size={15} />
                        </button>

                        <div className="acc-topbar-identity" ref={menuRef}>
                            <div className="acc-topbar-identity-text">
                                <span className="acc-topbar-company"><CompanySwitcher /></span>
                                <span className="acc-topbar-username">{user?.fullName || user?.email || 'User'}</span>
                            </div>
                            <button
                                type="button"
                                className="acc-topbar-icon"
                                style={{ width: 34 }}
                                onClick={() => setMenuOpen((o) => !o)}
                                aria-haspopup="menu"
                                aria-expanded={menuOpen}
                                aria-label="Account menu"
                            >
                                <span className="acc-topbar-avatar">{initials}</span>
                                <ChevronDown size={11} />
                            </button>

                            {menuOpen && (
                                <div
                                    role="menu"
                                    className="absolute right-2 top-[32px] z-[120] min-w-[190px] rounded-md border border-neutral-200 bg-neutral-0 py-1 shadow-lg"
                                >
                                    <button
                                        type="button"
                                        role="menuitem"
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[0.78rem] text-neutral-800 hover:bg-neutral-100"
                                        onClick={() => { setMenuOpen(false); setShowChangePassword(true); }}
                                    >
                                        <KeyRound size={14} /> Change password
                                    </button>
                                    <button
                                        type="button"
                                        role="menuitem"
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[0.78rem] text-neutral-800 hover:bg-neutral-100"
                                        onClick={() => { setMenuOpen(false); void handleLogout(); }}
                                    >
                                        <LogOut size={14} /> Logout
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                    <ChangePasswordModal isOpen={showChangePassword} onClose={() => setShowChangePassword(false)} />
                </header>

                {/* Full-bleed work surface. Accurate gives the content an ~8px
                    gutter and lets grids run the full width of the window. */}
                <main id="main-content" className="overflow-y-auto flex-1 p-2 bg-neutral-100 relative pt-14 md:pt-2">
                    <WorkspaceShell />
                </main>
            </div>
            <Toaster />
        </div>
    );
};

export default Layout;

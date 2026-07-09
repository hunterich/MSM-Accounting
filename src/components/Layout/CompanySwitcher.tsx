import React, { useState, useRef, useEffect } from 'react';
import { Check, ChevronDown, ExternalLink } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { setActiveOrgId } from '../../lib/activeOrg';

/**
 * Header company switcher. With a single membership it renders today's plain
 * org-name text (strict no-op); with several it becomes a dropdown where each
 * company offers "Switch here" (pin this tab + hard reload — deliberately
 * wipes React Query cache and Zustand state so no cross-company data can
 * linger) and "Open in new tab" (?org= handshake pins the new tab).
 */
const CompanySwitcher = (): React.ReactElement => {
    const org = useAuthStore((s) => s.org);
    const memberships = useAuthStore((s) => s.memberships);
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false);
        };
        const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', handler);
        document.addEventListener('keydown', escHandler);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('keydown', escHandler);
        };
    }, []);

    if (memberships.length <= 1) {
        return <span className="text-sm text-neutral-600">{org?.name || 'Organization'}</span>;
    }

    const switchHere = (orgId: string): void => {
        if (orgId === org?.id) { setOpen(false); return; }
        setActiveOrgId(orgId);
        window.location.assign('/');
    };

    const openInNewTab = (orgId: string): void => {
        window.open(`/?org=${orgId}`, '_blank');
        setOpen(false);
    };

    return (
        <div className="relative inline-flex" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Switch company"
                className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900 rounded-md px-1 py-0.5 hover:bg-neutral-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
            >
                <span>{org?.name || 'Organization'}</span>
                <ChevronDown size={14} />
            </button>
            {open && (
                <div
                    role="menu"
                    className="absolute top-full right-0 mt-1 min-w-[260px] bg-white border border-neutral-200 rounded-md shadow-lg py-1 z-50"
                >
                    {memberships.map((m) => {
                        const isActive = m.orgId === org?.id;
                        return (
                            <div key={m.orgId} className="flex items-center hover:bg-neutral-50">
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => switchHere(m.orgId)}
                                    title={isActive ? 'Current company' : 'Switch here'}
                                    className="flex-1 min-w-0 text-left px-3 py-2 flex items-center gap-2"
                                >
                                    <span className="w-4 inline-flex shrink-0 text-primary-700">
                                        {isActive && <Check size={14} />}
                                    </span>
                                    <span className="flex min-w-0 flex-col">
                                        <span className="truncate text-[13px] text-neutral-800">{m.name}</span>
                                        <span className="text-xs text-neutral-500">{m.roleType}</span>
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => openInNewTab(m.orgId)}
                                    aria-label={`Open ${m.name} in new tab`}
                                    title="Open in new tab"
                                    className="shrink-0 p-2 mr-1 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100"
                                >
                                    <ExternalLink size={14} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default CompanySwitcher;

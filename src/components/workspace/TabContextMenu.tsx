// src/components/workspace/TabContextMenu.tsx
import React, { useEffect, useRef } from 'react';

export interface TabMenuItem {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
}

interface Props {
    x: number;
    y: number;
    items: TabMenuItem[];
    onClose: () => void;
}

/**
 * Lightweight right-click menu for a tab. Closes on outside-click, Escape, or
 * scroll/resize so it never lingers in the wrong place.
 */
const TabContextMenu = ({ x, y, items, onClose }: Props): React.ReactElement => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) onClose();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        // capture so a click anywhere (including other tabs) dismisses first
        document.addEventListener('mousedown', onDocClick, true);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', onClose);
        window.addEventListener('scroll', onClose, true);
        return () => {
            document.removeEventListener('mousedown', onDocClick, true);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', onClose);
            window.removeEventListener('scroll', onClose, true);
        };
    }, [onClose]);

    // Keep the menu on-screen near the click point.
    const left = Math.min(x, window.innerWidth - 210);
    const top = Math.min(y, window.innerHeight - (items.length * 36 + 16));

    return (
        <div ref={ref} className="workbench-tab-menu" style={{ left, top }} role="menu">
            {items.map((it, i) => (
                <button
                    key={i}
                    type="button"
                    role="menuitem"
                    className="workbench-tab-menu-item"
                    disabled={it.disabled}
                    onClick={() => { if (!it.disabled) { it.onClick(); onClose(); } }}
                >
                    {it.icon}
                    <span>{it.label}</span>
                </button>
            ))}
        </div>
    );
};

export default TabContextMenu;

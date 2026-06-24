import React, { useEffect, useRef, useState } from 'react';
import { X, List, Plus, ChevronDown } from 'lucide-react';

interface NewTabMenuItem {
    label: string;
    icon?: React.ReactNode;
    onSelect: () => void;
}

interface DocumentTabBarProps {
    openIds: string[];
    selectedId: string;
    tabRows: string[][];
    getLabel: (id: string) => string;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
    newTabLabel?: string;
    onNewTab?: () => void;
    /** When provided, the "New" button opens a dropdown menu instead of calling onNewTab */
    newTabMenu?: NewTabMenuItem[];
    onCatalog?: () => void;
    catalogLabel?: string;
    disableNew?: boolean;
    /** Extra content rendered after "New" tab in the first row (e.g. a tab-count badge) */
    firstRowSuffix?: React.ReactNode;
}

const DocumentTabBar = ({
    openIds,
    selectedId,
    tabRows,
    getLabel,
    onSelect,
    onClose,
    newTabLabel = 'Data Baru',
    onNewTab,
    newTabMenu,
    onCatalog,
    catalogLabel = 'Catalog',
    disableNew = false,
    firstRowSuffix,
}: DocumentTabBarProps): React.ReactElement => {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!menuOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [menuOpen]);

    const renderTab = (id: string) => {
        const isActive = id === selectedId;
        return (
            <button
                key={id}
                className={`workbench-doc-tab ${isActive ? 'active' : ''}`}
                onClick={() => onSelect(id)}
            >
                {getLabel(id)}
                <span
                    className="workbench-doc-tab-close"
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose(id);
                    }}
                >
                    <X size={14} />
                </span>
            </button>
        );
    };

    // First row: catalog + new + first batch of doc tabs
    const firstRowIds = tabRows[0] ?? [];
    const extraRows = tabRows.slice(1);

    return (
        <div className="workbench-doc-tabs">
            <div className="workbench-doc-tab-row">
                {onCatalog && (
                    <button
                        className="workbench-doc-tab workbench-doc-tab-catalog"
                        onClick={onCatalog}
                        title="Back to catalog"
                    >
                        <List size={16} />
                        {catalogLabel}
                    </button>
                )}
                {newTabMenu && newTabMenu.length > 0 ? (
                    <div className="relative" ref={menuRef}>
                        <button
                            className={`workbench-doc-tab workbench-doc-tab-new ${disableNew ? 'opacity-60 cursor-not-allowed' : ''}`}
                            onClick={() => setMenuOpen((open) => !open)}
                            disabled={disableNew}
                            title={newTabLabel}
                        >
                            <Plus size={16} />
                            {newTabLabel}
                            <ChevronDown size={14} />
                        </button>
                        {menuOpen && !disableNew && (
                            <div className="absolute top-full left-0 mt-1 min-w-[160px] bg-neutral-0 border border-neutral-200 rounded-md shadow-lg z-[100] py-1">
                                {newTabMenu.map((item) => (
                                    <button
                                        key={item.label}
                                        className="w-full px-3 py-2 text-left text-sm text-neutral-700 flex items-center gap-2 hover:bg-primary-50 hover:text-primary-700"
                                        onClick={() => { setMenuOpen(false); item.onSelect(); }}
                                    >
                                        {item.icon}
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ) : onNewTab && (
                    <button
                        className={`workbench-doc-tab workbench-doc-tab-new ${disableNew ? 'opacity-60 cursor-not-allowed' : ''}`}
                        onClick={onNewTab}
                        disabled={disableNew}
                        title={newTabLabel}
                    >
                        <Plus size={16} />
                        {newTabLabel}
                    </button>
                )}
                {firstRowIds.map((id) => renderTab(id))}
                {firstRowSuffix}
            </div>
            {extraRows.map((row, rowIndex) => (
                <div key={`doc-tab-row-${rowIndex}`} className="workbench-doc-tab-row secondary-row">
                    {row.map((id) => renderTab(id))}
                </div>
            ))}
        </div>
    );
};

export default DocumentTabBar;

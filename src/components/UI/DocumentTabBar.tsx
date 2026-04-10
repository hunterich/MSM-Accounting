import React from 'react';
import { X, List, Plus } from 'lucide-react';

interface DocumentTabBarProps {
    openIds: string[];
    selectedId: string;
    tabRows: string[][];
    getLabel: (id: string) => string;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
    newTabLabel?: string;
    onNewTab?: () => void;
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
    onCatalog,
    catalogLabel = 'Catalog',
    disableNew = false,
    firstRowSuffix,
}: DocumentTabBarProps): React.ReactElement => {
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
                {onNewTab && (
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

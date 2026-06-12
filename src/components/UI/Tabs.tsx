import React from 'react';

export interface TabDef {
    id: string;
    label: React.ReactNode;
}

interface TabsProps {
    tabs: TabDef[];
    active: string;
    onChange: (id: string) => void;
    className?: string;
}

/**
 * Lightweight underline tab strip. Renders all tab buttons; the host shows the
 * active panel. Extracted from InvoiceForm's inline tab pattern for reuse.
 */
const Tabs = ({ tabs, active, onChange, className = '' }: TabsProps): React.ReactElement => (
    <div className={`flex gap-1 border-b border-neutral-200 ${className}`} role="tablist">
        {tabs.map((t) => {
            const on = t.id === active;
            return (
                <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => onChange(t.id)}
                    className={`px-4 py-2.5 text-sm -mb-px border-b-2 transition-colors duration-150 ${
                        on
                            ? 'border-primary-700 text-primary-700 font-medium'
                            : 'border-transparent text-neutral-500 hover:text-neutral-700'
                    }`}
                >
                    {t.label}
                </button>
            );
        })}
    </div>
);

export default Tabs;

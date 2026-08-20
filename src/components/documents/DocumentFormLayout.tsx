import React from 'react';
import DocumentActionBarV2, { type MoreItem, type SplitOption } from './DocumentActionBarV2';

/**
 * DocumentFormLayout — the two-column shell every document form shares:
 *   ┌───────────────────────────────────────────────┐
 *   │ DocumentActionBarV2 (back · title · actions)   │
 *   ├──────────────────────────────┬────────────────┤
 *   │ main (header, lines, costs)  │ rail (totals +  │
 *   │                              │ party context)  │
 *   └──────────────────────────────┴────────────────┘
 *
 * Host forms render their own `main` and `rail` content; this owns the layout
 * and the action bar wiring only. Keeps every form visually identical.
 */

interface DocumentFormLayoutProps {
    title: string;
    statusLabel?: string;
    dirty?: boolean;
    onBack?: () => void;
    backLabel?: string;
    onHistory?: () => void;
    printOptions?: SplitOption[];
    onSaveDraft?: () => void;
    primaryLabel: string;
    primaryIcon?: React.ReactNode;
    onPrimary?: () => void;
    primaryOptions?: SplitOption[];
    saving?: boolean;
    /** Overflow menu — destructive actions (delete/void) live here. */
    moreItems?: MoreItem[];
    main: React.ReactNode;
    rail: React.ReactNode;
}

const DocumentFormLayout = ({
    title, dirty, onBack, backLabel, onHistory, printOptions,
    onSaveDraft, primaryLabel, primaryIcon, onPrimary, primaryOptions, saving,
    moreItems, main, rail,
}: DocumentFormLayoutProps): React.ReactElement => (
    <div className="w-full min-w-0">
        <DocumentActionBarV2
            title={title}
            dirty={dirty}
            onBack={onBack}
            backLabel={backLabel}
            onHistory={onHistory}
            printOptions={printOptions}
            onSaveDraft={onSaveDraft}
            primaryLabel={primaryLabel}
            primaryIcon={primaryIcon}
            onPrimary={onPrimary}
            primaryOptions={primaryOptions}
            saving={saving}
            moreItems={moreItems}
        />
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-3 items-start">
            <div className="flex flex-col gap-3 min-w-0">{main}</div>
            <div className="flex flex-col gap-3 lg:sticky lg:top-2">{rail}</div>
        </div>
    </div>
);

export default DocumentFormLayout;

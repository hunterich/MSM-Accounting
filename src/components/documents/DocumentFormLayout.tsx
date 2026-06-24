import React from 'react';
import DocumentActionBarV2, { type SplitOption, type MoreItem } from './DocumentActionBarV2';

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
 *
 * The action bar has two states — DRAFT (Save draft / Save & …▾) and POSTED
 * (Print · Email · Edit · ⋯ · postedPrimary). Pass `posted` plus the posted-*
 * props to switch; the draft props are ignored while posted.
 */

interface DocumentFormLayoutProps {
    title: string;
    dirty?: boolean;
    onBack?: () => void;
    backLabel?: string;
    onHistory?: () => void;
    printOptions?: SplitOption[];
    saving?: boolean;
    // draft actions
    onSaveDraft?: () => void;
    primaryLabel: string;
    primaryIcon?: React.ReactNode;
    onPrimary?: () => void;
    primaryOptions?: SplitOption[];
    // posted state
    posted?: boolean;
    postedStatusLabel?: string;
    postedStatusTone?: 'danger' | 'success' | 'warning';
    onEdit?: () => void;
    onEmail?: () => void;
    postedPrimaryLabel?: string;
    onPostedPrimary?: () => void;
    moreItems?: MoreItem[];
    main: React.ReactNode;
    rail: React.ReactNode;
}

const DocumentFormLayout = ({
    title, dirty, onBack, backLabel, onHistory, printOptions, saving,
    onSaveDraft, primaryLabel, primaryIcon, onPrimary, primaryOptions,
    posted, postedStatusLabel, postedStatusTone, onEdit, onEmail,
    postedPrimaryLabel, onPostedPrimary, moreItems,
    main, rail,
}: DocumentFormLayoutProps): React.ReactElement => (
    <div className="max-w-[1240px] mx-auto">
        <DocumentActionBarV2
            title={title}
            dirty={dirty}
            onBack={onBack}
            backLabel={backLabel}
            onHistory={onHistory}
            printOptions={printOptions}
            saving={saving}
            onSaveDraft={onSaveDraft}
            primaryLabel={primaryLabel}
            primaryIcon={primaryIcon}
            onPrimary={onPrimary}
            primaryOptions={primaryOptions}
            posted={posted}
            postedStatusLabel={postedStatusLabel}
            postedStatusTone={postedStatusTone}
            onEdit={onEdit}
            onEmail={onEmail}
            postedPrimaryLabel={postedPrimaryLabel}
            onPostedPrimary={onPostedPrimary}
            moreItems={moreItems}
        />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">
            <div className="flex flex-col gap-4 min-w-0">{main}</div>
            <div className="flex flex-col gap-4 lg:sticky lg:top-4">{rail}</div>
        </div>
    </div>
);

export default DocumentFormLayout;

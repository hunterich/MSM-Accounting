import React, { useState, useRef, useEffect } from 'react';
import { Printer, History, ChevronDown, MoreHorizontal, Send } from 'lucide-react';

/**
 * DocumentActionBarV2 — the sticky toolbar shared by every document form.
 *
 * Two states:
 *  - DRAFT  → Print▾ · History · Save draft · Save & …▾   (status chip "Draft" + "Unsaved")
 *  - POSTED → Print▾ · Email · Edit · ⋯(Void/Duplicate/Download) · <postedPrimary>▾
 *             status chips become "Posted" + a money status ("Unpaid"/"Confirmed")
 *
 * Status only shows AFTER posting — a draft has no transaction yet. Void lives in the
 * ⋯ menu (one click removed) and can be disabled when the doc has linked payments/returns.
 */

export interface SplitOption {
    label: string;
    hint?: string;
    onClick?: () => void;
    disabled?: boolean;
}

export interface MoreItem {
    label?: string;
    onClick?: () => void;
    danger?: boolean;
    disabled?: boolean;
    disabledHint?: string;
    divider?: boolean;
}

interface DocumentActionBarV2Props {
    title: string;
    onBack?: () => void;
    backLabel?: string;
    /** false = draft (default), true = posted */
    posted?: boolean;
    /** second status chip shown when posted, e.g. "Unpaid" / "Confirmed". */
    postedStatusLabel?: string;
    postedStatusTone?: 'danger' | 'success' | 'warning';
    dirty?: boolean;
    saving?: boolean;
    // draft actions
    onHistory?: () => void;
    printOptions?: SplitOption[];
    onSaveDraft?: () => void;
    primaryLabel: string;
    primaryIcon?: React.ReactNode;
    onPrimary?: () => void;
    primaryOptions?: SplitOption[];
    // posted actions
    onEdit?: () => void;
    onEmail?: () => void;
    postedPrimaryLabel?: string;
    onPostedPrimary?: () => void;
    moreItems?: MoreItem[];
}

const Menu = ({ options }: { options: SplitOption[] }) => (
    <div className="absolute top-full mt-1 right-0 min-w-[220px] bg-white border border-neutral-200 rounded-md shadow-lg py-1 z-50">
        {options.map((o, i) => (
            <button key={i} type="button" disabled={o.disabled} onClick={o.onClick}
                className="w-full text-left px-3 py-2 text-[13px] text-neutral-800 hover:bg-neutral-50 disabled:opacity-50 flex flex-col">
                <span className="font-medium">{o.label}</span>
                {o.hint && <span className="text-[11px] text-neutral-500">{o.hint}</span>}
            </button>
        ))}
    </div>
);

function useOutside<T extends HTMLElement>(onClose: () => void) {
    const ref = useRef<T>(null);
    useEffect(() => {
        const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, [onClose]);
    return ref;
}

const ghost = 'inline-flex items-center gap-1.5 h-[34px] px-3 text-[13px] rounded-md bg-white text-neutral-700 border border-neutral-300 hover:bg-neutral-50';

const MoreMenu = ({ items }: { items: MoreItem[] }) => {
    const [open, setOpen] = useState(false);
    const ref = useOutside<HTMLDivElement>(() => setOpen(false));
    return (
        <div className="relative" ref={ref}>
            <button type="button" onClick={() => setOpen((o) => !o)} className={ghost} aria-label="More actions"><MoreHorizontal size={16} /></button>
            {open && (
                <div className="absolute right-0 top-full mt-1 min-w-[190px] bg-white border border-neutral-200 rounded-md shadow-lg py-1 z-50">
                    {items.map((it, i) => it.divider ? <div key={i} className="h-px bg-neutral-200 my-1" /> : (
                        <button key={i} type="button" disabled={it.disabled} title={it.disabled ? it.disabledHint : ''}
                            onClick={() => { setOpen(false); it.onClick?.(); }}
                            className={`w-full text-left px-3 py-2 text-[13px] flex flex-col ${it.disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-neutral-50 cursor-pointer'} ${it.danger ? 'text-danger-600' : 'text-neutral-800'}`}>
                            <span>{it.label}</span>
                            {it.disabled && it.disabledHint && <span className="text-[10px] text-neutral-400">{it.disabledHint}</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

const Chip = ({ tone, children }: { tone: 'neutral' | 'warning' | 'success' | 'danger'; children: React.ReactNode }) => {
    const m = {
        neutral: 'bg-neutral-100 text-neutral-700 border-neutral-300',
        warning: 'bg-warning-50 text-warning-800 border-warning-200',
        success: 'bg-success-50 text-success-700 border-success-200',
        danger: 'bg-danger-50 text-danger-700 border-danger-200',
    }[tone];
    const dot = { neutral: 'bg-neutral-500', warning: 'bg-warning-500', success: 'bg-success-500', danger: 'bg-danger-500' }[tone];
    return <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border ${m}`}><span className={`w-1.5 h-1.5 rounded-full ${dot}`} />{children}</span>;
};

const DocumentActionBarV2 = ({
    title, onBack, backLabel = 'Back',
    posted = false, postedStatusLabel, postedStatusTone = 'danger', dirty = false, saving = false,
    onHistory, printOptions, onSaveDraft, primaryLabel, primaryIcon, onPrimary, primaryOptions,
    onEdit, onEmail, postedPrimaryLabel, onPostedPrimary, moreItems,
}: DocumentActionBarV2Props): React.ReactElement => {
    const [printOpen, setPrintOpen] = useState(false);
    const [primaryOpen, setPrimaryOpen] = useState(false);
    const printRef = useOutside<HTMLDivElement>(() => setPrintOpen(false));
    const primaryRef = useOutside<HTMLDivElement>(() => setPrimaryOpen(false));

    return (
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
            <div className="flex items-center gap-3">
                <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-neutral-600 text-[13px] px-2 h-8 rounded-md hover:bg-neutral-100">← {backLabel}</button>
                <span className="text-neutral-300">/</span>
                <h1 className="m-0 text-xl font-semibold text-neutral-900">{title}</h1>
                {posted
                    ? <><Chip tone="success">Posted</Chip>{postedStatusLabel && <Chip tone={postedStatusTone}>{postedStatusLabel}</Chip>}</>
                    : <><Chip tone="neutral">Draft</Chip>{dirty && <Chip tone="warning">Unsaved</Chip>}</>}
            </div>

            <div className="flex gap-2 items-center">
                {printOptions && printOptions.length > 0 && (
                    <div className="relative" ref={printRef}>
                        <button type="button" onClick={() => setPrintOpen((o) => !o)} className={ghost}><Printer size={14} /> Print <ChevronDown size={13} /></button>
                        {printOpen && <Menu options={printOptions} />}
                    </div>
                )}

                {posted ? (
                    <>
                        {onEmail && <button type="button" onClick={onEmail} className={ghost}><Send size={14} /> Email</button>}
                        {onEdit && <button type="button" onClick={onEdit} className="h-[34px] px-3 text-[13px] rounded-md bg-white text-neutral-800 border border-neutral-300 hover:bg-neutral-50">Edit</button>}
                        {moreItems && moreItems.length > 0 && <MoreMenu items={moreItems} />}
                        {postedPrimaryLabel && (
                            <button type="button" onClick={onPostedPrimary} className="h-[34px] inline-flex items-center gap-1.5 px-3.5 text-[13px] font-medium bg-primary-700 text-white rounded-md hover:bg-primary-800">{postedPrimaryLabel}</button>
                        )}
                    </>
                ) : (
                    <>
                        {onHistory && <button type="button" onClick={onHistory} className={ghost}><History size={14} /> History</button>}
                        <span className="w-px h-6 bg-neutral-200 mx-1" />
                        {onSaveDraft && <button type="button" onClick={onSaveDraft} className="h-[34px] px-3 text-[13px] rounded-md bg-white text-neutral-800 border border-neutral-300 hover:bg-neutral-50">Save draft</button>}
                        <div className="relative inline-flex" ref={primaryRef}>
                            <div className="inline-flex rounded-md overflow-hidden border border-primary-700">
                                <button type="button" onClick={onPrimary} disabled={saving} className="h-[34px] inline-flex items-center gap-1.5 px-3.5 text-[13px] font-medium bg-primary-700 text-white hover:bg-primary-800 disabled:opacity-60">
                                    {primaryIcon} {saving ? 'Saving…' : primaryLabel}
                                </button>
                                {primaryOptions && primaryOptions.length > 0 && (
                                    <button type="button" onClick={() => setPrimaryOpen((o) => !o)} className="h-[34px] px-2 bg-primary-700 text-white hover:bg-primary-800 border-l border-white/20"><ChevronDown size={14} /></button>
                                )}
                            </div>
                            {primaryOpen && primaryOptions && <Menu options={primaryOptions} />}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default DocumentActionBarV2;

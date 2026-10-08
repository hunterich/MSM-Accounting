import React, { useEffect, useState } from 'react';

export interface ListPaginationProps {
    page: number;
    limit: number;
    total?: number;
    busy?: boolean;
    label?: string;
    onPageChange: (page: number) => void;
    onLimitChange: (limit: number) => void;
}

export default function ListPagination({ page, limit, total, busy = false, label = 'records', onPageChange, onLimitChange }: ListPaginationProps) {
    const pages = Math.max(1, Math.ceil((total ?? 0) / limit));
    const [jump, setJump] = useState(String(page));
    useEffect(() => setJump(String(page)), [page]);
    useEffect(() => {
        if (!busy && total !== undefined && page > pages) onPageChange(pages);
    }, [busy, total, page, pages]);
    const disabled = busy || total === undefined;
    return <nav aria-label={`${label} pagination`} className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-neutral-200 bg-white p-2 text-sm">
        <span>{total === undefined ? 'Loading count…' : `Showing ${total === 0 ? 0 : (page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total.toLocaleString()} ${label}`}</span>
        <label>Rows <select aria-label={`${label} per page`} value={limit} disabled={busy} onChange={e => onLimitChange(Number(e.target.value))} className="rounded border p-1">
            {[20, 50, 100].map(size => <option key={size}>{size}</option>)}
        </select></label>
        <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-secondary" disabled={disabled || page <= 1} onClick={() => onPageChange(1)}>First</button>
            <button className="btn btn-secondary" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
            <span>Page {page} of {pages.toLocaleString()}</span>
            <button className="btn btn-secondary" disabled={disabled || page >= pages} onClick={() => onPageChange(page + 1)}>Next</button>
            <button className="btn btn-secondary" disabled={disabled || page >= pages} onClick={() => onPageChange(pages)}>Last</button>
            <form className="flex gap-1" onSubmit={e => { e.preventDefault(); const next = Number(jump); if (Number.isInteger(next) && next >= 1 && next <= pages) onPageChange(next); }}>
                <input type="number" aria-label={`Go to ${label} page`} min={1} max={pages} value={jump} onChange={e => setJump(e.target.value)} disabled={disabled} className="w-16 rounded border p-1" />
                <button className="btn btn-secondary" disabled={disabled}>Go</button>
            </form>
        </div>
    </nav>;
}

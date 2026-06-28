// src/components/inventory/stockcounts/StockCountDetailPane.tsx
// Workspace-native stock-count detail (one tab per count). Read-only view with
// an "Open worksheet" action that opens the editor as a doc-form tab.
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Table, { TableColumn } from '../../UI/Table';
import Button from '../../UI/Button';
import StatusTag from '../../UI/StatusTag';
import { formatDateID, formatIDR } from '../../../utils/formatters';
import {
    useStockCount, useStockCountJournal, useItemCategories, useWarehouses,
    type StockCount, type StockCountLineRow,
} from '../../../hooks/useInventory';
import type { JournalDetail } from '../../../hooks/useAP';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { countStatusTag } from './stockCountStatus';

function InlineJournalTable({ journal, isLoading }: { journal: JournalDetail | null | undefined; isLoading: boolean }) {
    if (isLoading) return <div className="p-4 text-center text-neutral-400">Loading journal…</div>;
    if (!journal) return <div className="p-4 text-center text-neutral-400">Posted with no variance — no journal entry.</div>;
    return (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                <div className="flex justify-between"><span className="text-neutral-500">Date</span><span className="text-neutral-800">{String(journal.date).slice(0, 10)}</span></div>
                <div className="flex justify-between"><span className="text-neutral-500">Entry #</span><span className="text-primary-700 font-medium">{journal.entryNo}</span></div>
                {journal.memo && <div className="flex justify-between col-span-2"><span className="text-neutral-500">Memo</span><span className="text-neutral-800">{journal.memo}</span></div>}
            </div>
            <table className="w-full border-collapse text-sm">
                <thead><tr>
                    <th className="text-left p-2 border-y border-neutral-200 font-semibold text-neutral-600">Account</th>
                    <th className="text-right p-2 border-y border-neutral-200 font-semibold text-neutral-600 w-[22%]">Debit</th>
                    <th className="text-right p-2 border-y border-neutral-200 font-semibold text-neutral-600 w-[22%]">Credit</th>
                </tr></thead>
                <tbody>
                    {journal.lines.map((l) => (
                        <tr key={l.lineNo} className="border-b border-neutral-100">
                            <td className="p-2"><div className={`text-neutral-800 ${l.credit > 0 && l.debit === 0 ? 'pl-6' : ''}`}>{l.accountCode} {l.accountName}</div>{l.description ? <div className="text-xs text-neutral-400">{l.description}</div> : null}</td>
                            <td className="p-2 text-right text-neutral-800">{l.debit ? formatIDR(l.debit) : ''}</td>
                            <td className="p-2 text-right text-neutral-800">{l.credit ? formatIDR(l.credit) : ''}</td>
                        </tr>
                    ))}
                </tbody>
                <tfoot><tr className="font-semibold">
                    <td className="p-2 text-right text-neutral-500">Total</td>
                    <td className="p-2 text-right text-neutral-900 border-t border-neutral-300">{formatIDR(journal.totalDebit)}</td>
                    <td className="p-2 text-right text-neutral-900 border-t border-neutral-300">{formatIDR(journal.totalCredit)}</td>
                </tr></tfoot>
            </table>
        </div>
    );
}

interface Props { countId: string; workspaceTabId: string }

const StockCountDetailPane = ({ countId }: Props): React.ReactElement => {
    const navigate = useNavigate();
    const { open } = useWorkspaceNav();
    const { data: detailCount, isLoading: detailLoading } = useStockCount(countId || undefined);
    const { data: categories = [] } = useItemCategories();
    const { data: warehouses = [] } = useWarehouses();
    const selected: StockCount | null = detailCount ?? null;
    const [detailTab, setDetailTab] = useState('summary');

    const journalEnabled = detailTab === 'journal' && !!selected && selected.status === 'POSTED';
    const { data: journalData, isLoading: journalLoading } = useStockCountJournal(countId || undefined, journalEnabled);

    const scopeLabel = (count: StockCount): string => {
        const parts: string[] = [];
        if (count.categoryId) { const cat = categories.find((c) => c.id === count.categoryId); if (cat) parts.push(cat.name); }
        if (count.warehouseId) { const wh = warehouses.find((w) => w.id === count.warehouseId); if (wh) parts.push(wh.name); }
        return parts.length ? parts.join(' / ') : 'All';
    };

    const linesColumns = useMemo((): TableColumn<Record<string, unknown>>[] => [
        { key: 'item', label: 'Item', render: (_val, row) => { const line = row as unknown as StockCountLineRow; return line.item ? <div><div className="font-medium">{line.item.name}</div><div className="text-xs text-neutral-400">{line.item.sku}</div></div> : line.itemId; } },
        { key: 'systemQty', label: 'System Qty', align: 'right' as const, render: (val) => val as number },
        { key: 'countedQty', label: 'Counted', align: 'right' as const, render: (val) => val == null ? '—' : val as number },
        { key: 'variance', label: 'Variance', align: 'right' as const, render: (_val, row) => {
            const line = row as unknown as StockCountLineRow;
            if (line.countedQty == null) return <span className="text-neutral-400">—</span>;
            const v = line.countedQty - line.systemQty;
            if (v > 0) return <span style={{ color: '#2b8a3e' }}>+{v}</span>;
            if (v < 0) return <span style={{ color: '#c92a2a' }}>{v}</span>;
            return <span className="text-neutral-500">0</span>;
        } },
    ], []);

    const varianceSummary = useMemo(() => {
        const lines = detailCount?.lines ?? [];
        return {
            counted: lines.filter((l) => l.countedQty != null).length,
            total: lines.length,
            up: lines.filter((l) => l.countedQty != null && l.countedQty > l.systemQty).length,
            down: lines.filter((l) => l.countedQty != null && l.countedQty < l.systemQty).length,
        };
    }, [detailCount]);

    if (!selected) return <div className="container banking-module container-full-width"><div className="invoice-workbench-card dense-mode"><div className="p-8 text-center text-neutral-400">{detailLoading ? 'Loading count…' : 'Count not found.'}</div></div></div>;

    const openWorksheet = () => open({ kind: 'doc-form', target: { module: 'stock-count', entity: 'count', recordId: selected.id, mode: 'edit' }, title: `Worksheet ${selected.number}`, path: `/inventory/counts/edit?id=${selected.id}` });
    const viewAdjustment = () => navigate(`/inventory/adjustments/edit?id=${selected.generatedAdjustmentId}&mode=view`);
    const editable = selected.status === 'DRAFT' || selected.status === 'SUBMITTED';

    return (
        <div className="container banking-module container-full-width">
            <div className="invoice-workbench-card dense-mode">
                <div className="dense-topbar">
                    <div className="detail-header-title">
                        <h2 className="detail-header-h2">{selected.number}</h2>
                        <StatusTag {...countStatusTag(selected.status)} />
                    </div>
                    <div className="detail-header-actions">
                        {editable && <Button text="Open worksheet" size="small" variant="primary" onClick={openWorksheet} />}
                    </div>
                </div>
                <div className="dense-body">
                    <div className="dense-main">
                        <div className="detail-tabs dense-tabs">
                            <button className={`detail-tab ${detailTab === 'summary' ? 'active' : ''}`} onClick={() => setDetailTab('summary')}>Summary</button>
                            <button className={`detail-tab ${detailTab === 'lines' ? 'active' : ''}`} onClick={() => setDetailTab('lines')}>Lines</button>
                            <button className={`detail-tab ${detailTab === 'journal' ? 'active' : ''}`} onClick={() => setDetailTab('journal')}>Journal Entry</button>
                        </div>
                        <div className="detail-tab-content dense-content">
                            {detailTab === 'summary' && (
                                <div className="detail-grid">
                                    <div className="detail-field"><label>Count Number</label><strong>{selected.number}</strong></div>
                                    <div className="detail-field"><label>Date</label><div>{formatDateID(selected.date)}</div></div>
                                    <div className="detail-field"><label>Scope</label><div>{scopeLabel(selected)}</div></div>
                                    {selected.countedBy && <div className="detail-field"><label>Counted By</label><div>{selected.countedBy}</div></div>}
                                    {selected.notes && <div className="detail-field"><label>Notes</label><div>{selected.notes}</div></div>}
                                    {!detailLoading && detailCount && (
                                        <div className="detail-field col-span-2">
                                            <label>Variance Summary</label>
                                            <div className="flex gap-4 text-sm mt-1">
                                                <span className="text-neutral-600">{varianceSummary.counted} of {varianceSummary.total} items counted</span>
                                                {varianceSummary.counted > 0 && (<><span style={{ color: '#2b8a3e' }}>▲ {varianceSummary.up} up</span><span style={{ color: '#c92a2a' }}>▼ {varianceSummary.down} down</span></>)}
                                            </div>
                                        </div>
                                    )}
                                    {(selected.status === 'POSTED' || selected.status === 'VOIDED') && selected.generatedAdjustmentId && (
                                        <div className="detail-field">
                                            <label>Generated Adjustment</label>
                                            <button className="text-primary-700 text-sm underline hover:text-primary-900" onClick={viewAdjustment}>{selected.status === 'VOIDED' ? 'View generated adjustment (voided) →' : 'View generated adjustment →'}</button>
                                        </div>
                                    )}
                                    {editable && <div className="detail-field"><Button text="Open worksheet" size="small" variant="secondary" onClick={openWorksheet} /></div>}
                                </div>
                            )}
                            {detailTab === 'lines' && (
                                detailLoading ? <div className="p-4 text-center text-neutral-400">Loading lines…</div> : (
                                    <Table columns={linesColumns} data={(detailCount?.lines ?? []) as unknown as Record<string, unknown>[]} showCount countLabel="lines" isLoading={detailLoading} />
                                )
                            )}
                            {detailTab === 'journal' && (
                                selected.status !== 'POSTED' ? <div className="p-4 text-center text-neutral-400">Journal entry is only available for posted counts.</div> : (
                                    <>
                                        <InlineJournalTable journal={journalData} isLoading={journalLoading} />
                                        {!journalLoading && selected.generatedAdjustmentId && (
                                            <div className="mt-3 text-sm"><button className="text-primary-700 underline hover:text-primary-900" onClick={viewAdjustment}>View generated adjustment →</button></div>
                                        )}
                                    </>
                                )
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StockCountDetailPane;

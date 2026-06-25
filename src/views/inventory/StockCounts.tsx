import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import DocumentTabBar from '../../components/UI/DocumentTabBar';
import PageHeader from '../../components/Layout/PageHeader';
import { Search } from 'lucide-react';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { useDocumentTabs } from '../../hooks/useDocumentTabs';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import {
    useStockCounts,
    useStockCount,
    useStockCountJournal,
    useItemCategories,
    useWarehouses,
    type StockCount,
    type StockCountLineRow,
} from '../../hooks/useInventory';
import type { JournalDetail } from '../../hooks/useAP';

// ── StatusTag helper ──────────────────────────────────────────────────────────

function countStatusTag(status: string): { status: string; label: string } {
    switch (status) {
        case 'POSTED':    return { status: 'Success', label: 'Posted' };
        case 'SUBMITTED': return { status: 'Warning', label: 'Submitted' };
        case 'CANCELLED': return { status: 'Error',   label: 'Cancelled' };
        case 'VOIDED':    return { status: 'Error',   label: 'Voided' };
        default:          return { status: 'draft',   label: 'Draft' };
    }
}

// ── Inline Journal table (mirrors JournalDetailModal lines 42-69) ─────────────

function InlineJournalTable({ journal, isLoading }: { journal: JournalDetail | null | undefined; isLoading: boolean }) {
    if (isLoading) {
        return <div className="p-4 text-center text-neutral-400">Loading journal…</div>;
    }
    if (!journal) {
        return (
            <div className="p-4 text-center text-neutral-400">
                Posted with no variance — no journal entry.
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                <div className="flex justify-between">
                    <span className="text-neutral-500">Date</span>
                    <span className="text-neutral-800">{String(journal.date).slice(0, 10)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-neutral-500">Entry #</span>
                    <span className="text-primary-700 font-medium">{journal.entryNo}</span>
                </div>
                {journal.memo && (
                    <div className="flex justify-between col-span-2">
                        <span className="text-neutral-500">Memo</span>
                        <span className="text-neutral-800">{journal.memo}</span>
                    </div>
                )}
            </div>
            <table className="w-full border-collapse text-sm">
                <thead>
                    <tr>
                        <th className="text-left p-2 border-y border-neutral-200 font-semibold text-neutral-600">Account</th>
                        <th className="text-right p-2 border-y border-neutral-200 font-semibold text-neutral-600 w-[22%]">Debit</th>
                        <th className="text-right p-2 border-y border-neutral-200 font-semibold text-neutral-600 w-[22%]">Credit</th>
                    </tr>
                </thead>
                <tbody>
                    {journal.lines.map((l) => (
                        <tr key={l.lineNo} className="border-b border-neutral-100">
                            <td className="p-2">
                                <div className={`text-neutral-800 ${l.credit > 0 && l.debit === 0 ? 'pl-6' : ''}`}>
                                    {l.accountCode} {l.accountName}
                                </div>
                                {l.description ? <div className="text-xs text-neutral-400">{l.description}</div> : null}
                            </td>
                            <td className="p-2 text-right text-neutral-800">{l.debit ? formatIDR(l.debit) : ''}</td>
                            <td className="p-2 text-right text-neutral-800">{l.credit ? formatIDR(l.credit) : ''}</td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr className="font-semibold">
                        <td className="p-2 text-right text-neutral-500">Total</td>
                        <td className="p-2 text-right text-neutral-900 border-t border-neutral-300">{formatIDR(journal.totalDebit)}</td>
                        <td className="p-2 text-right text-neutral-900 border-t border-neutral-300">{formatIDR(journal.totalCredit)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

const StockCounts = () => {
    const navigate = useNavigate();
    const { canCreate } = useModulePermissions('inv_adj');

    // ── List data ────────────────────────────────────────────────────────────
    const { data: countsRes, isLoading } = useStockCounts();
    const counts: StockCount[] = countsRes?.data ?? [];

    // ── Supporting lookups (for scope names) ────────────────────────────────
    const { data: categories = [] } = useItemCategories();
    const { data: warehouses = [] } = useWarehouses();

    // ── Tabs ─────────────────────────────────────────────────────────────────
    const {
        selectedId,
        openIds,
        openTab,
        closeTab,
        selectNone,
        tabRows,
    } = useDocumentTabs({ urlParam: 'countId' });

    // ── Detail fetch (only when a tab is selected) ────────────────────────
    const { data: detailCount, isLoading: detailLoading } = useStockCount(selectedId || undefined);

    // Merge: use list-level count for topbar while detail loads
    const selectedListItem = counts.find((c) => c.id === selectedId) ?? null;
    const selected: StockCount | null = detailCount ?? selectedListItem;

    // ── Detail tab state ─────────────────────────────────────────────────────
    const [detailTab, setDetailTab] = useState<string>('summary');

    // Reset detail tab when a different count is opened
    const prevSelectedIdRef = React.useRef<string>('');
    if (prevSelectedIdRef.current !== selectedId) {
        prevSelectedIdRef.current = selectedId;
        if (detailTab !== 'summary') setDetailTab('summary');
    }

    // ── Journal (only fetched when Journal Entry tab is active + POSTED) ───
    const journalEnabled =
        detailTab === 'journal' &&
        !!selected &&
        selected.status === 'POSTED';
    const { data: journalData, isLoading: journalLoading } = useStockCountJournal(
        selectedId || undefined,
        journalEnabled,
    );

    // ── Filters (list view) ──────────────────────────────────────────────────
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [statusFilter, setStatusFilter] = useState<string>('');

    const filteredCounts = useMemo(() => {
        const kw = searchTerm.toLowerCase();
        return counts.filter((c) => {
            const matchesSearch = !kw || c.number.toLowerCase().includes(kw);
            const matchesStatus = !statusFilter || c.status === statusFilter;
            return matchesSearch && matchesStatus;
        });
    }, [counts, searchTerm, statusFilter]);

    // ── Scope label helper ───────────────────────────────────────────────────
    function scopeLabel(count: StockCount): string {
        const parts: string[] = [];
        if (count.categoryId) {
            const cat = categories.find((c) => c.id === count.categoryId);
            if (cat) parts.push(cat.name);
        }
        if (count.warehouseId) {
            const wh = warehouses.find((w) => w.id === count.warehouseId);
            if (wh) parts.push(wh.name);
        }
        return parts.length > 0 ? parts.join(' / ') : 'All';
    }

    // ── List columns ─────────────────────────────────────────────────────────
    const listColumns = useMemo((): TableColumn<Record<string, unknown>>[] => [
        {
            key: 'number',
            label: 'Number',
            render: (val) => <span className="font-medium text-primary-700">{val as string}</span>,
        },
        {
            key: 'date',
            label: 'Date',
            render: (val) => formatDateID(val as string),
        },
        {
            key: 'id',
            label: 'Scope',
            render: (_val, row) => scopeLabel(row as unknown as StockCount),
        },
        {
            key: 'status',
            label: 'Status',
            render: (val) => <StatusTag {...countStatusTag(val as string)} />,
        },
        {
            key: '_count',
            label: 'Items',
            align: 'right' as const,
            render: (val) => {
                const c = val as { lines?: number } | undefined;
                return c?.lines ?? 0;
            },
        },
        {
            key: 'actions',
            label: '',
            render: (_val, row) => {
                const r = row as unknown as StockCount;
                return (
                    <div className="row-actions-end">
                        <Button
                            text="Open worksheet"
                            size="small"
                            variant="tertiary"
                            onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                navigate(`/inventory/counts/edit?id=${r.id}`);
                            }}
                        />
                    </div>
                );
            },
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [categories, warehouses, navigate]);

    // ── Lines columns (detail view) ──────────────────────────────────────────
    const linesColumns = useMemo((): TableColumn<Record<string, unknown>>[] => [
        {
            key: 'item',
            label: 'Item',
            render: (_val, row) => {
                const line = row as unknown as StockCountLineRow;
                if (line.item) {
                    return (
                        <div>
                            <div className="font-medium">{line.item.name}</div>
                            <div className="text-xs text-neutral-400">{line.item.sku}</div>
                        </div>
                    );
                }
                return line.itemId;
            },
        },
        {
            key: 'systemQty',
            label: 'System Qty',
            align: 'right' as const,
            render: (val) => val as number,
        },
        {
            key: 'countedQty',
            label: 'Counted',
            align: 'right' as const,
            render: (val) => val == null ? '—' : val as number,
        },
        {
            key: 'variance',
            label: 'Variance',
            align: 'right' as const,
            render: (_val, row) => {
                const line = row as unknown as StockCountLineRow;
                if (line.countedQty == null) return <span className="text-neutral-400">—</span>;
                const variance = line.countedQty - line.systemQty;
                if (variance > 0) return <span style={{ color: '#2b8a3e' }}>+{variance}</span>;
                if (variance < 0) return <span style={{ color: '#c92a2a' }}>{variance}</span>;
                return <span className="text-neutral-500">0</span>;
            },
        },
    ], []);

    // ── Variance summary (for the Summary tab) ────────────────────────────────
    const varianceSummary = useMemo(() => {
        const lines = detailCount?.lines ?? [];
        const counted = lines.filter((l) => l.countedQty != null).length;
        const up = lines.filter((l) => l.countedQty != null && l.countedQty > l.systemQty).length;
        const down = lines.filter((l) => l.countedQty != null && l.countedQty < l.systemQty).length;
        return { counted, total: lines.length, up, down };
    }, [detailCount]);

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="container banking-module container-full-width">
            <PageHeader
                title="Stock Counts"
                subtitle="Count physical stock and post the variances."
            />

            <DocumentTabBar
                openIds={openIds}
                selectedId={selectedId}
                tabRows={tabRows}
                getLabel={(id) => counts.find((c) => c.id === id)?.number ?? id}
                onSelect={(id) => { openTab(id); setDetailTab('summary'); }}
                onClose={closeTab}
                newTabLabel="New count"
                onNewTab={() => navigate('/inventory/counts/new')}
                disableNew={!canCreate}
                onCatalog={() => { selectNone(); setSearchTerm(''); setStatusFilter(''); }}
                firstRowSuffix={
                    <div className="workbench-tab-count">Open tabs: {openIds.length}</div>
                }
            />

            {/* ── LIST VIEW ─────────────────────────────────────────────── */}
            {!selectedId && (
                <>
                    {/* Filters */}
                    <div className="payments-filter-card">
                        <div className="payments-filter-search">
                            <Search size={18} />
                            <input
                                type="text"
                                className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                placeholder="Search by number…"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="payments-filter-field">
                            <select
                                className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                            >
                                <option value="">All Statuses</option>
                                <option value="DRAFT">Draft</option>
                                <option value="SUBMITTED">Submitted</option>
                                <option value="POSTED">Posted</option>
                                <option value="CANCELLED">Cancelled</option>
                                <option value="VOIDED">Voided</option>
                            </select>
                        </div>
                    </div>

                    <Card padding={false}>
                        <Table
                            columns={listColumns}
                            data={filteredCounts as unknown as Record<string, unknown>[]}
                            onRowClick={(row) => {
                                const r = row as unknown as StockCount;
                                openTab(r.id);
                                setDetailTab('summary');
                            }}
                            showCount
                            countLabel="counts"
                            isLoading={isLoading}
                            loadingLabel="Loading stock counts…"
                        />
                    </Card>
                </>
            )}

            {/* ── DETAIL VIEW ───────────────────────────────────────────── */}
            {selectedId && selected && (
                <div className="invoice-workbench-card dense-mode">
                    {/* Topbar */}
                    <div className="dense-topbar">
                        <div className="detail-header-title">
                            <h2 className="detail-header-h2">{selected.number}</h2>
                            <StatusTag {...countStatusTag(selected.status)} />
                        </div>
                        <div className="detail-header-actions">
                            {selected.status !== 'POSTED' && selected.status !== 'CANCELLED' && (
                                <Button
                                    text="Open worksheet"
                                    size="small"
                                    variant="primary"
                                    onClick={() => navigate(`/inventory/counts/edit?id=${selected.id}`)}
                                />
                            )}
                        </div>
                    </div>

                    {/* Dense body */}
                    <div className="dense-body">
                        <div className="dense-main">
                            {/* Detail tab bar */}
                            <div className="detail-tabs dense-tabs">
                                <button
                                    className={`detail-tab ${detailTab === 'summary' ? 'active' : ''}`}
                                    onClick={() => setDetailTab('summary')}
                                >
                                    Summary
                                </button>
                                <button
                                    className={`detail-tab ${detailTab === 'lines' ? 'active' : ''}`}
                                    onClick={() => setDetailTab('lines')}
                                >
                                    Lines
                                </button>
                                <button
                                    className={`detail-tab ${detailTab === 'journal' ? 'active' : ''}`}
                                    onClick={() => setDetailTab('journal')}
                                >
                                    Journal Entry
                                </button>
                            </div>

                            <div className="detail-tab-content dense-content">
                                {/* ── SUMMARY TAB ──────────────────────────────── */}
                                {detailTab === 'summary' && (
                                    <div className="detail-grid">
                                        <div className="detail-field">
                                            <label>Count Number</label>
                                            <strong>{selected.number}</strong>
                                        </div>
                                        <div className="detail-field">
                                            <label>Date</label>
                                            <div>{formatDateID(selected.date)}</div>
                                        </div>
                                        <div className="detail-field">
                                            <label>Scope</label>
                                            <div>{scopeLabel(selected)}</div>
                                        </div>
                                        {selected.countedBy && (
                                            <div className="detail-field">
                                                <label>Counted By</label>
                                                <div>{selected.countedBy}</div>
                                            </div>
                                        )}
                                        {selected.notes && (
                                            <div className="detail-field">
                                                <label>Notes</label>
                                                <div>{selected.notes}</div>
                                            </div>
                                        )}

                                        {/* Variance summary */}
                                        {!detailLoading && detailCount && (
                                            <div className="detail-field col-span-2">
                                                <label>Variance Summary</label>
                                                <div className="flex gap-4 text-sm mt-1">
                                                    <span className="text-neutral-600">
                                                        {varianceSummary.counted} of {varianceSummary.total} items counted
                                                    </span>
                                                    {varianceSummary.counted > 0 && (
                                                        <>
                                                            <span style={{ color: '#2b8a3e' }}>
                                                                ▲ {varianceSummary.up} up
                                                            </span>
                                                            <span style={{ color: '#c92a2a' }}>
                                                                ▼ {varianceSummary.down} down
                                                            </span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Generated adjustment link (POSTED, or VOIDED — link kept for audit) */}
                                        {(selected.status === 'POSTED' || selected.status === 'VOIDED') && selected.generatedAdjustmentId && (
                                            <div className="detail-field">
                                                <label>Generated Adjustment</label>
                                                <button
                                                    className="text-primary-700 text-sm underline hover:text-primary-900"
                                                    onClick={() =>
                                                        navigate(
                                                            `/inventory/adjustments/edit?id=${selected.generatedAdjustmentId}&mode=view`,
                                                        )
                                                    }
                                                >
                                                    {selected.status === 'VOIDED'
                                                        ? 'View generated adjustment (voided) →'
                                                        : 'View generated adjustment →'}
                                                </button>
                                            </div>
                                        )}

                                        {/* Open worksheet button (editable statuses only) */}
                                        {(selected.status === 'DRAFT' || selected.status === 'SUBMITTED') && (
                                            <div className="detail-field">
                                                <Button
                                                    text="Open worksheet"
                                                    size="small"
                                                    variant="secondary"
                                                    onClick={() =>
                                                        navigate(`/inventory/counts/edit?id=${selected.id}`)
                                                    }
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* ── LINES TAB ────────────────────────────────── */}
                                {detailTab === 'lines' && (
                                    <>
                                        {detailLoading ? (
                                            <div className="p-4 text-center text-neutral-400">Loading lines…</div>
                                        ) : (
                                            <Table
                                                columns={linesColumns}
                                                data={(detailCount?.lines ?? []) as unknown as Record<string, unknown>[]}
                                                showCount
                                                countLabel="lines"
                                                isLoading={detailLoading}
                                            />
                                        )}
                                    </>
                                )}

                                {/* ── JOURNAL ENTRY TAB ────────────────────────── */}
                                {detailTab === 'journal' && (
                                    <>
                                        {selected.status !== 'POSTED' ? (
                                            <div className="p-4 text-center text-neutral-400">
                                                Journal entry is only available for posted counts.
                                            </div>
                                        ) : (
                                            <>
                                                <InlineJournalTable
                                                    journal={journalData}
                                                    isLoading={journalLoading}
                                                />
                                                {/* Link to generated adjustment */}
                                                {!journalLoading && journalData && selected.generatedAdjustmentId && (
                                                    <div className="mt-3 text-sm">
                                                        <button
                                                            className="text-primary-700 underline hover:text-primary-900"
                                                            onClick={() =>
                                                                navigate(
                                                                    `/inventory/adjustments/edit?id=${selected.generatedAdjustmentId}&mode=view`,
                                                                )
                                                            }
                                                        >
                                                            View generated adjustment →
                                                        </button>
                                                    </div>
                                                )}
                                                {/* No-variance message with adjustment link */}
                                                {!journalLoading && !journalData && selected.generatedAdjustmentId && (
                                                    <div className="mt-3 text-sm">
                                                        <button
                                                            className="text-primary-700 underline hover:text-primary-900"
                                                            onClick={() =>
                                                                navigate(
                                                                    `/inventory/adjustments/edit?id=${selected.generatedAdjustmentId}&mode=view`,
                                                                )
                                                            }
                                                        >
                                                            View generated adjustment →
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Loading state when a tab is selected but data not yet available */}
            {selectedId && !selected && (
                <div className="invoice-workbench-card dense-mode">
                    <div className="p-8 text-center text-neutral-400">Loading count…</div>
                </div>
            )}
        </div>
    );
};

export default StockCounts;

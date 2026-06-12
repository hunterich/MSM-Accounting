import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import FilterBar from '../../components/UI/FilterBar';
import { Plus, List, X, FileText, Paperclip, MoreHorizontal, Trash2, Download } from 'lucide-react';
import { exportToCsv } from '../../utils/exportCsv';
import { useBills } from '../../hooks/useAP';
import { useDebitNotes, usePurchaseReturns, useWarehouses } from '../../hooks/useReturns';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { useSettingsStore } from '../../stores/useSettingsStore';
import PrintPreviewModal from '../../components/UI/PrintPreviewModal';
import NotePrintTemplate from '../../components/print/NotePrintTemplate';

interface SelectedDoc {
    type: 'debit' | 'return';
    id: string;
}

interface DebitFilters {
    settlementType: string;
}

interface ReturnLine {
    lineKey?: string;
    description: string;
    qtyReturn: number;
    unit: string;
    price: number;
}

const DebitNotes = () => {
    const navigate = useNavigate();
    const { canCreate, canEdit, canDelete } = useModulePermissions('ap_debits');
    const { data: billsData } = useBills();
    const bills = billsData?.data ?? [];
    const { data: dnData } = useDebitNotes();
    const debitNotes = dnData?.data ?? [];
    const { data: prData } = usePurchaseReturns();
    const purchaseReturns = prData?.data ?? [];
    const { data: warehouses = [] } = useWarehouses();
    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [filters, setFilters] = useState<DebitFilters>({ settlementType: '' });
    const [isPrintOpen, setIsPrintOpen] = useState<boolean>(false);
    const [printDoc, setPrintDoc] = useState<{
        title: string; partyLabel: string; partyName?: string;
        document: Record<string, unknown>; lineItems: ReturnLine[];
        subtotal: number; taxAmount: number; total: number;
    } | null>(null);
    const [activeCatalogTab, setActiveCatalogTab] = useState<string>('debits');
    const [selectedDoc, setSelectedDoc] = useState<SelectedDoc | null>(null);
    const [openDocKeys, setOpenDocKeys] = useState<string[]>([]);
    const [detailTab, setDetailTab] = useState<string>('summary');

    const getPurchaseReturnTotal = (purchaseReturn: Record<string, unknown>) => {
        if (!purchaseReturn) return 0;
        const subtotal = ((purchaseReturn.lines as ReturnLine[]) || []).reduce((sum, line) => {
            return sum + Number(line.qtyReturn || 0) * Number(line.price || 0);
        }, 0);
        if (!purchaseReturn.applyTax) return subtotal;
        const rate = Number(purchaseReturn.taxRate || 0) / 100;
        if (purchaseReturn.taxIncluded) return subtotal;
        return subtotal + (subtotal * rate);
    };

    const openDoc = (type: 'debit' | 'return', id: string) => {
        const key = `${type}:${id}`;
        setOpenDocKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
        setSelectedDoc({ type, id });
        setDetailTab('summary');
    };

    const closeDoc = (keyToClose: string) => {
        setOpenDocKeys((prev) => {
            const idx = prev.indexOf(keyToClose);
            const next = prev.filter((key) => key !== keyToClose);
            if (selectedDoc && `${selectedDoc.type}:${selectedDoc.id}` === keyToClose) {
                if (next.length === 0) {
                    setSelectedDoc(null);
                } else {
                    const fallback = next[Math.max(0, idx - 1)] || next[0];
                    const [type, id] = fallback.split(':');
                    setSelectedDoc({ type: type as 'debit' | 'return', id });
                }
            }
            return next;
        });
    };

    const filteredDebitNotes = useMemo(() => {
        return debitNotes.filter((item) => {
            const keyword = searchTerm.toLowerCase();
            const matchesSearch =
                item.vendorName.toLowerCase().includes(keyword) ||
                item.id.toLowerCase().includes(keyword) ||
                item.sourceBillId.toLowerCase().includes(keyword) ||
                item.returnId.toLowerCase().includes(keyword);
            const matchesSettlement = filters.settlementType ? item.settlementType === filters.settlementType : true;
            return matchesSearch && matchesSettlement;
        });
    }, [searchTerm, filters.settlementType, debitNotes]);

    const filteredReturns = useMemo(() => {
        return purchaseReturns.filter((item) => {
            const keyword = searchTerm.toLowerCase();
            return (
                item.vendorName.toLowerCase().includes(keyword) ||
                item.id.toLowerCase().includes(keyword) ||
                item.billId.toLowerCase().includes(keyword)
            );
        });
    }, [searchTerm, purchaseReturns]);

    const selectedDebitNote = selectedDoc?.type === 'debit'
        ? debitNotes.find((item) => item.id === selectedDoc.id) || null
        : null;
    const selectedReturn = selectedDoc?.type === 'return'
        ? purchaseReturns.find((item) => item.id === selectedDoc.id) || null
        : null;

    const selectedDebitLines = useMemo(() => {
        if (!selectedDebitNote) return [];
        const linkedReturn = purchaseReturns.find((item) => item.id === selectedDebitNote.returnId);
        return linkedReturn?.lines || [];
    }, [selectedDebitNote, purchaseReturns]);

    // Build the print payload for either a debit note or its source purchase return
    const lineSubtotal = (lines: ReturnLine[]) =>
        lines.reduce((sum, line) => sum + Number(line.qtyReturn || 0) * Number(line.price || 0), 0);

    const queuePrintDebit = (id: string) => {
        const debit = debitNotes.find((d) => d.id === id);
        if (!debit) return;
        const lines = ((purchaseReturns.find((item) => item.id === debit.returnId)?.lines) as ReturnLine[] | undefined) || [];
        const subtotal = lineSubtotal(lines);
        const total = Number(debit.amount || 0);
        setPrintDoc({
            title: 'DEBIT NOTE', partyLabel: 'Vendor', partyName: debit.vendorName,
            document: { number: debit.id, date: debit.date, status: debit.status, reference: debit.sourceBillId },
            lineItems: lines, subtotal, taxAmount: Math.max(0, total - subtotal), total,
        });
        setIsPrintOpen(true);
    };

    const queuePrintReturn = (id: string) => {
        const ret = purchaseReturns.find((item) => item.id === id);
        if (!ret) return;
        const lines = (ret.lines as ReturnLine[] | undefined) || [];
        const subtotal = lineSubtotal(lines);
        const total = getPurchaseReturnTotal(ret as unknown as Record<string, unknown>);
        setPrintDoc({
            title: 'PURCHASE RETURN', partyLabel: 'Vendor', partyName: ret.vendorName,
            document: { number: ret.id, date: ret.returnDate, status: ret.status, reference: ret.billId },
            lineItems: lines, subtotal, taxAmount: Math.max(0, total - subtotal), total,
        });
        setIsPrintOpen(true);
    };

    const debitColumns = [
        { key: 'id', label: 'Debit Note #' },
        { key: 'returnId', label: 'Purchase Return #' },
        { key: 'date', label: 'Date', render: (value: unknown) => formatDateID(value as string) },
        { key: 'vendorName', label: 'Vendor' },
        { key: 'sourceBillId', label: 'Source Bill' },
        { key: 'amount', label: 'Amount', align: 'right' as const, render: (value: unknown) => formatIDR(value as number) },
        {
            key: 'settlementType',
            label: 'Settlement',
            render: (value: unknown, row: Record<string, unknown>) => `${value as string}${row['settlementRef'] ? ` • ${row['settlementRef'] as string}` : ''}`
        },
        {
            key: 'status',
            label: 'Status',
            render: (value: unknown) => <StatusTag status={(value as string) === 'Applied' ? 'Success' : 'Info'} label={value as string} />
        },
        {
            key: 'actions',
            label: '',
            render: (_: unknown, row: Record<string, unknown>) => (
                <div className="row-actions-end">
                    <Button text="View" size="small" variant="tertiary" onClick={(event: React.MouseEvent) => { event.stopPropagation(); openDoc('debit', row['id'] as string); }} />
                    <Button text="Print" size="small" variant="tertiary" onClick={(event: React.MouseEvent) => { event.stopPropagation(); queuePrintDebit(row['id'] as string); }} />
                    <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={(event: React.MouseEvent) => { event.stopPropagation(); navigate('/ap/debits/edit', { state: { mode: 'edit', debitId: row['id'] as string } }); }} />
                </div>
            )
        }
    ];

    const returnColumns = [
        { key: 'id', label: 'Purchase Return #' },
        { key: 'returnDate', label: 'Date', render: (value: unknown) => formatDateID(value as string) },
        { key: 'vendorName', label: 'Vendor' },
        { key: 'billId', label: 'Source Bill' },
        {
            key: 'status',
            label: 'Status',
            render: (value: unknown) => <StatusTag status={(value as string) === 'Approved' ? 'Success' : 'Warning'} label={value as string} />
        },
        {
            key: 'actions',
            label: '',
            render: (_: unknown, row: Record<string, unknown>) => (
                <Button text="Open" size="small" variant="tertiary" onClick={(event: React.MouseEvent) => { event.stopPropagation(); openDoc('return', row['id'] as string); }} />
            )
        }
    ];

    const filterOptions = [
        {
            key: 'settlementType',
            label: 'Settlement Type',
            options: [
                { value: 'Apply to Bill', label: 'Apply to Bill' },
                { value: 'Refund from Vendor', label: 'Refund from Vendor' }
            ]
        }
    ];

    const renderOpenDocTab = (key: string) => {
        const [type, id] = key.split(':');
        const doc = type === 'debit'
            ? debitNotes.find((item) => item.id === id)
            : purchaseReturns.find((item) => item.id === id);
        if (!doc) return null;
        const isActive = selectedDoc && `${selectedDoc.type}:${selectedDoc.id}` === key;
        return (
            <button key={key} className={`workbench-doc-tab ${isActive ? 'active' : ''}`} onClick={() => setSelectedDoc({ type: type as 'debit' | 'return', id })}>
                {doc.id}
                <span className="workbench-doc-tab-close" onClick={(event) => { event.stopPropagation(); closeDoc(key); }}>
                    <X size={14} />
                </span>
            </button>
        );
    };

    const firstRowDynamicLimit = 3;
    const firstRowDocKeys = openDocKeys.slice(0, firstRowDynamicLimit);
    const remainingDocKeys = openDocKeys.slice(firstRowDynamicLimit);
    const extraRows: string[][] = [];
    for (let i = 0; i < remainingDocKeys.length; i += 5) {
        extraRows.push(remainingDocKeys.slice(i, i + 5));
    }

    return (
        <div className="container ap-module container-full-width">
            <div className="workbench-doc-tabs">
                <div className="workbench-doc-tab-row">
                    <button className="workbench-doc-tab workbench-doc-tab-catalog" onClick={() => setSelectedDoc(null)}>
                        <List size={16} />
                        Catalog
                    </button>
                    <button className={`workbench-doc-tab workbench-doc-tab-new ${canCreate ? '' : 'opacity-60 cursor-not-allowed'}`} onClick={() => navigate('/ap/returns/new', { state: { mode: 'create' } })} disabled={!canCreate}>
                        <Plus size={16} />
                        New Purchase Return
                    </button>
                    {firstRowDocKeys.map((key) => renderOpenDocTab(key))}
                    <button
                        className="btn btn-secondary flex items-center gap-1"
                        title="Export CSV"
                        onClick={() => {
                            const rows = filteredDebitNotes.map((dn) => ({
                                id: dn.id,
                                date: dn.date,
                                vendorName: dn.vendorName,
                                sourceBillId: dn.sourceBillId,
                                amount: dn.amount,
                                status: dn.status,
                            }));
                            exportToCsv('debit-notes.csv', rows, [
                                { label: 'Number', key: 'id' },
                                { label: 'Date', key: 'date' },
                                { label: 'Vendor', key: 'vendorName' },
                                { label: 'Source Bill', key: 'sourceBillId' },
                                { label: 'Amount', key: 'amount' },
                                { label: 'Status', key: 'status' },
                            ]);
                        }}
                    >
                        <Download size={16} />
                        <span className="hidden sm:inline">Export</span>
                    </button>
                    <div className="workbench-tab-count">Open tabs: {openDocKeys.length}</div>
                </div>
                {extraRows.map((row, rowIndex) => (
                    <div key={`ap-debit-row-${rowIndex}`} className="workbench-doc-tab-row secondary-row">
                        {row.map((key) => renderOpenDocTab(key))}
                    </div>
                ))}
            </div>

            {!selectedDoc ? (
                <>
                    <div className="invoice-tabs module-tabs module-tabs-spaced">
                        <button className={`invoice-tab ${activeCatalogTab === 'debits' ? 'active' : ''}`} onClick={() => setActiveCatalogTab('debits')}>Debit Notes</button>
                        <button className={`invoice-tab ${activeCatalogTab === 'returns' ? 'active' : ''}`} onClick={() => setActiveCatalogTab('returns')}>Purchase Returns</button>
                    </div>

                    <FilterBar
                        onSearch={setSearchTerm}
                        filters={activeCatalogTab === 'debits' ? filterOptions : []}
                        activeFilters={filters as unknown as Record<string, string>}
                        onFilterChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
                        placeholder={activeCatalogTab === 'debits' ? 'Search debit #, return #, vendor...' : 'Search return #, vendor, bill...'}
                    />

                    <Card padding={false}>
                        {activeCatalogTab === 'debits' ? (
                            <Table
                                columns={debitColumns as TableColumn<Record<string, unknown>>[]}
                                data={filteredDebitNotes as unknown as Record<string, unknown>[]}
                                onRowClick={(row) => openDoc('debit', row['id'] as string)}
                                showCount
                                countLabel="debit notes"
                            />
                        ) : (
                            <Table
                                columns={returnColumns as TableColumn<Record<string, unknown>>[]}
                                data={filteredReturns as unknown as Record<string, unknown>[]}
                                onRowClick={(row) => openDoc('return', row['id'] as string)}
                                showCount
                                countLabel="debit notes"
                            />
                        )}
                    </Card>
                </>
            ) : null}

            {selectedDebitNote ? (
                <div className="invoice-workbench-card dense-mode">
                    <div className="dense-topbar">
                        <div className="detail-header-title">
                            <h2 className="detail-header-h2">{selectedDebitNote.id}</h2>
                            <StatusTag status={selectedDebitNote.status === 'Applied' ? 'Success' : 'Info'} label={selectedDebitNote.status} />
                        </div>
                        <div className="detail-header-actions">
                            <Button text="Print" size="small" variant="secondary" onClick={() => queuePrintDebit(selectedDebitNote.id)} />
                            <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={() => navigate('/ap/debits/edit', { state: { mode: 'edit', debitId: selectedDebitNote.id } })} />
                        </div>
                    </div>
                    <div className="dense-header-grid">
                        <div className="dense-field"><label>Vendor</label><div>{selectedDebitNote.vendorName}</div></div>
                        <div className="dense-field"><label>Date</label><div>{formatDateID(selectedDebitNote.date)}</div></div>
                        <div className="dense-field"><label>Source Bill</label><div>{selectedDebitNote.sourceBillId}</div></div>
                        <div className="dense-field"><label>Settlement</label><div>{selectedDebitNote.settlementType}</div></div>
                        <div className="dense-amount">{formatIDR(selectedDebitNote.amount)}</div>
                    </div>
                    <div className="dense-body">
                        <div className="dense-main">
                            <div className="detail-tabs dense-tabs">
                                <button className={`detail-tab ${detailTab === 'summary' ? 'active' : ''}`} onClick={() => setDetailTab('summary')}>Summary</button>
                                <button className={`detail-tab ${detailTab === 'items' ? 'active' : ''}`} onClick={() => setDetailTab('items')}>Items</button>
                                <button className={`detail-tab ${detailTab === 'logistics' ? 'active' : ''}`} onClick={() => setDetailTab('logistics')}>Logistics</button>
                                <button className={`detail-tab ${detailTab === 'attachments' ? 'active' : ''}`} onClick={() => setDetailTab('attachments')}>Attachments</button>
                                <button className={`detail-tab ${detailTab === 'audit' ? 'active' : ''}`} onClick={() => setDetailTab('audit')}>Audit / Journal</button>
                            </div>
                            <div className="detail-tab-content dense-content">
                                {detailTab === 'summary' ? (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Debit #</label><strong>{selectedDebitNote.id}</strong></div>
                                        <div className="detail-field"><label>Status</label><StatusTag status={selectedDebitNote.status === 'Applied' ? 'Success' : 'Info'} label={selectedDebitNote.status} /></div>
                                        <div className="detail-field"><label>Purchase Return</label><div>{selectedDebitNote.returnId}</div></div>
                                        <div className="detail-field"><label>Source Bill</label><div>{selectedDebitNote.sourceBillId}</div></div>
                                        <div className="detail-field"><label>Settlement Ref</label><div>{selectedDebitNote.settlementRef || '-'}</div></div>
                                        <div className="detail-field"><label>Amount</label><strong>{formatIDR(selectedDebitNote.amount)}</strong></div>
                                    </div>
                                ) : null}
                                {detailTab === 'items' ? (
                                    <div className="workbench-scroll-table">
                                        <table className="invoice-workbench-table">
                                            <thead>
                                                <tr>
                                                    <th>Description</th>
                                                    <th className="text-right">Qty Return</th>
                                                    <th>Unit</th>
                                                    <th className="text-right">Price</th>
                                                    <th className="text-right">Line Total</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(selectedDebitLines as ReturnLine[]).length === 0 ? (
                                                    <tr><td colSpan={5} className="table-empty-cell">No return lines.</td></tr>
                                                ) : (selectedDebitLines as ReturnLine[]).map((line, idx) => (
                                                    <tr key={`${line.lineKey || idx}`}>
                                                        <td>{line.description}</td>
                                                        <td className="text-right">{line.qtyReturn}</td>
                                                        <td>{line.unit}</td>
                                                        <td className="text-right">{formatIDR(line.price)}</td>
                                                        <td className="text-right">{formatIDR(Number(line.qtyReturn || 0) * Number(line.price || 0))}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : null}
                                {detailTab === 'logistics' ? (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Settlement Type</label><strong>{selectedDebitNote.settlementType}</strong></div>
                                        <div className="detail-field"><label>Settlement Ref</label><div>{selectedDebitNote.settlementRef || '-'}</div></div>
                                        <div className="detail-field"><label>Source Bill</label><div>{selectedDebitNote.sourceBillId}</div></div>
                                        <div className="detail-field"><label>Purchase Return</label><div>{selectedDebitNote.returnId}</div></div>
                                    </div>
                                ) : null}
                                {detailTab === 'attachments' ? <div className="attachment-empty">No attachments.</div> : null}
                                {detailTab === 'audit' ? (
                                    <ul className="audit-list">
                                        <li><div><strong>Debit note created</strong></div><div>{formatDateID(selectedDebitNote.date)} • System</div></li>
                                        <li><div><strong>Linked to purchase return {selectedDebitNote.returnId}</strong></div><div>{formatDateID(selectedDebitNote.date)} • Auto process</div></li>
                                    </ul>
                                ) : null}
                            </div>
                        </div>
                        <div className="dense-side-actions">
                            <button className="dense-side-btn" title="Details"><FileText size={18} /></button>
                            <button className="dense-side-btn" title="Attachments"><Paperclip size={18} /></button>
                            <button className="dense-side-btn success" title="More"><MoreHorizontal size={18} /></button>
                            <button className={`dense-side-btn danger ${canDelete ? '' : 'opacity-60 cursor-not-allowed'}`} title="Delete" disabled={!canDelete}><Trash2 size={18} /></button>
                        </div>
                    </div>
                </div>
            ) : null}

            {selectedReturn ? (
                <div className="invoice-workbench-card dense-mode">
                    <div className="dense-topbar">
                        <div className="detail-header-title">
                            <h2 className="detail-header-h2">{selectedReturn.id}</h2>
                            <StatusTag status={selectedReturn.status === 'Approved' ? 'Success' : 'Warning'} label={selectedReturn.status} />
                        </div>
                        <div className="detail-header-actions">
                            <Button text="Print" size="small" variant="secondary" onClick={() => queuePrintReturn(selectedReturn.id)} />
                            <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={() => navigate('/ap/returns/new', { state: { mode: 'edit', returnId: selectedReturn.id } })} />
                        </div>
                    </div>
                    <div className="dense-header-grid">
                        <div className="dense-field"><label>Vendor</label><div>{selectedReturn.vendorName}</div></div>
                        <div className="dense-field"><label>Return Date</label><div>{formatDateID(selectedReturn.returnDate)}</div></div>
                        <div className="dense-field"><label>Source Bill</label><div>{selectedReturn.billId}</div></div>
                        <div className="dense-field"><label>Warehouse</label><div>{(warehouses as Array<{ id: string; name: string }>).find((item) => item.id === selectedReturn.warehouseId)?.name || '-'}</div></div>
                        <div className="dense-amount">{formatIDR(getPurchaseReturnTotal(selectedReturn as unknown as Record<string, unknown>))}</div>
                    </div>
                    <div className="dense-content">
                        <table className="invoice-workbench-table compact">
                            <thead>
                                <tr>
                                    <th>Description</th>
                                    <th className="text-right">Qty Return</th>
                                    <th>Unit</th>
                                    <th className="text-right">Price</th>
                                    <th className="text-right">Line Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {((selectedReturn.lines || []) as ReturnLine[]).map((line, idx) => (
                                    <tr key={`${line.lineKey || idx}`}>
                                        <td>{line.description}</td>
                                        <td className="text-right">{line.qtyReturn}</td>
                                        <td>{line.unit}</td>
                                        <td className="text-right">{formatIDR(line.price)}</td>
                                        <td className="text-right">{formatIDR(Number(line.qtyReturn || 0) * Number(line.price || 0))}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : null}

            <PrintPreviewModal
                isOpen={isPrintOpen}
                onClose={() => setIsPrintOpen(false)}
                title={`${printDoc?.title || 'Document'} Print Preview`}
                documentTitle={`${(printDoc?.title || 'Document').replace(/\s+/g, '')}_${(printDoc?.document.number as string) || ''}`}
                defaultPaperSize={printSettings.defaultPaperSize}
            >
                <NotePrintTemplate
                    title={printDoc?.title || ''}
                    partyLabel={printDoc?.partyLabel || ''}
                    partyName={printDoc?.partyName}
                    document={printDoc?.document}
                    lineItems={printDoc?.lineItems}
                    subtotal={printDoc?.subtotal}
                    taxAmount={printDoc?.taxAmount}
                    total={printDoc?.total}
                    company={company}
                    options={printSettings}
                />
            </PrintPreviewModal>
        </div>
    );
};

export default DebitNotes;

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import FilterBar from '../../components/UI/FilterBar';
import DocumentTabBar from '../../components/UI/DocumentTabBar';
import PageHeader from '../../components/Layout/PageHeader';
import { Plus, FileText, Paperclip, MoreHorizontal, Trash2, Download } from 'lucide-react';
import { exportToCsv } from '../../utils/exportCsv';
import { useCreditNotes, useSalesReturns, useWarehouses, useVoidSalesReturn } from '../../hooks/useReturns';
import { useDocumentTabs } from '../../hooks/useDocumentTabs';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { useSettingsStore } from '../../stores/useSettingsStore';
import PrintPreviewModal from '../../components/UI/PrintPreviewModal';
import NotePrintTemplate from '../../components/print/NotePrintTemplate';

interface SelectedDoc {
    type: 'credit' | 'return';
    id: string;
}

interface CreditFilters {
    settlementType: string;
}

interface ReturnLine {
    itemId?: string;
    id?: string;
    itemName: string;
    qtyReturn: number;
    unit: string;
    price: number;
}

/** Builds a composite key used as the tab ID */
const toKey = (type: 'credit' | 'return', id: string) => `${type}:${id}`;

/** Parses a composite key back into type + id */
const fromKey = (key: string): { type: 'credit' | 'return'; id: string } => {
    const colonIdx = key.indexOf(':');
    const type = key.slice(0, colonIdx) as 'credit' | 'return';
    const id = key.slice(colonIdx + 1);
    return { type, id };
};

const CreditNotes = () => {
    const navigate = useNavigate();
    const { canCreate, canEdit, canDelete } = useModulePermissions('ar_credits');
    const { data: cnData } = useCreditNotes();
    const creditNotes = cnData?.data ?? [];
    const { data: srData } = useSalesReturns();
    const salesReturns = srData?.data ?? [];
    const voidSalesReturn = useVoidSalesReturn();

    const handleVoidReturn = (id: string) => {
        if (!window.confirm('Void this sales return? Its journal entry will be reversed and the restocked inventory removed. This cannot be undone.')) return;
        voidSalesReturn.mutate(id, {
            onError: (error: unknown) => {
                window.alert(error instanceof Error ? error.message : 'Failed to void sales return');
            },
        });
    };
    const { data: warehouses = [] } = useWarehouses();
    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [filters, setFilters] = useState<CreditFilters>({ settlementType: '' });
    const [isPrintOpen, setIsPrintOpen] = useState<boolean>(false);
    const [printDoc, setPrintDoc] = useState<{
        title: string; partyLabel: string; partyName?: string;
        document: Record<string, unknown>; lineItems: ReturnLine[];
        subtotal: number; taxAmount: number; total: number;
    } | null>(null);
    const [activeCatalogTab, setActiveCatalogTab] = useState<string>('credits');
    const [detailTab, setDetailTab] = useState<string>('summary');

    // Tab state: composite keys ("credit:id" | "return:id") are used as IDs
    const { selectedId: selectedKey, openIds: openDocKeys, openTab: openDocTab, closeTab: closeDocTab, selectNone: selectNoneDoc, tabRows } = useDocumentTabs();

    const selectedDoc: SelectedDoc | null = selectedKey ? fromKey(selectedKey) : null;

    const getReturnTotal = (salesReturn: Record<string, unknown>) => {
        if (!salesReturn) return 0;
        const subtotal = ((salesReturn.lines as ReturnLine[]) || []).reduce((sum, line) => {
            return sum + (Number(line.qtyReturn || 0) * Number(line.price || 0));
        }, 0);
        if (!salesReturn.applyTax) return subtotal;
        const rate = Number(salesReturn.taxRate || 0) / 100;
        if (salesReturn.taxIncluded) return subtotal;
        return subtotal + (subtotal * rate);
    };

    const openDoc = (type: 'credit' | 'return', id: string) => {
        const key = toKey(type, id);
        openDocTab(key);
        setDetailTab('summary');
    };

    const filteredCredits = useMemo(() => {
        return creditNotes.filter((item) => {
            const keyword = searchTerm.toLowerCase();
            const matchesSearch = item.customerName.toLowerCase().includes(keyword)
                || item.id.toLowerCase().includes(keyword)
                || item.sourceInvoiceId.toLowerCase().includes(keyword)
                || item.returnId.toLowerCase().includes(keyword);
            const matchesSettlement = filters.settlementType ? item.settlementType === filters.settlementType : true;
            return matchesSearch && matchesSettlement;
        });
    }, [searchTerm, filters.settlementType, creditNotes]);

    const filteredReturns = useMemo(() => {
        return salesReturns.filter((item) => {
            const keyword = searchTerm.toLowerCase();
            return item.customerName.toLowerCase().includes(keyword)
                || item.id.toLowerCase().includes(keyword)
                || item.invoiceId.toLowerCase().includes(keyword);
        });
    }, [searchTerm, salesReturns]);

    const selectedCredit = selectedDoc?.type === 'credit'
        ? creditNotes.find((item) => item.id === selectedDoc.id) || null
        : null;
    const selectedReturn = selectedDoc?.type === 'return'
        ? salesReturns.find((item) => item.id === selectedDoc.id) || null
        : null;

    const selectedCreditLines = useMemo(() => {
        if (!selectedCredit) return [];
        const linkedReturn = salesReturns.find((ret) => ret.id === selectedCredit.returnId);
        return linkedReturn?.lines || [];
    }, [selectedCredit, salesReturns]);

    // Build the print payload for either a credit note or its source sales return
    const lineSubtotal = (lines: ReturnLine[]) =>
        lines.reduce((sum, line) => sum + Number(line.qtyReturn || 0) * Number(line.price || 0), 0);

    const queuePrintCredit = (id: string) => {
        const credit = creditNotes.find((c) => c.id === id);
        if (!credit) return;
        const lines = ((salesReturns.find((ret) => ret.id === credit.returnId)?.lines) as ReturnLine[] | undefined) || [];
        const subtotal = lineSubtotal(lines);
        const total = Number(credit.amount || 0);
        setPrintDoc({
            title: 'CREDIT NOTE', partyLabel: 'Customer', partyName: credit.customerName,
            document: { number: credit.id, date: credit.date, status: credit.status, reference: credit.sourceInvoiceId },
            lineItems: lines, subtotal, taxAmount: Math.max(0, total - subtotal), total,
        });
        setIsPrintOpen(true);
    };

    const queuePrintReturn = (id: string) => {
        const ret = salesReturns.find((item) => item.id === id);
        if (!ret) return;
        const lines = (ret.lines as ReturnLine[] | undefined) || [];
        const subtotal = lineSubtotal(lines);
        const total = getReturnTotal(ret as unknown as Record<string, unknown>);
        setPrintDoc({
            title: 'SALES RETURN', partyLabel: 'Customer', partyName: ret.customerName,
            document: { number: ret.id, date: ret.returnDate, status: ret.status, reference: ret.invoiceId },
            lineItems: lines, subtotal, taxAmount: Math.max(0, total - subtotal), total,
        });
        setIsPrintOpen(true);
    };

    const creditColumns = [
        { key: 'id', label: 'Credit Note #' },
        { key: 'returnId', label: 'Sales Return #' },
        { key: 'date', label: 'Date', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'customerName', label: 'Customer', sortable: true },
        { key: 'sourceInvoiceId', label: 'Source Invoice' },
        { key: 'amount', label: 'Amount', align: 'right' as const, render: (val: unknown) => formatIDR(val as number) },
        {
            key: 'settlementType',
            label: 'Settlement',
            render: (val: unknown, row: Record<string, unknown>) => `${val as string}${row['settlementRef'] ? ` • ${row['settlementRef'] as string}` : ''}`
        },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={(val as string) === 'Applied' ? 'Success' : 'Info'} label={val as string} /> },
        {
            key: 'actions',
            label: '',
            render: (_: unknown, row: Record<string, unknown>) => (
                <div className="row-actions-end">
                    <Button text="View" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openDoc('credit', row['id'] as string); }} />
                    <Button text="Print" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); queuePrintCredit(row['id'] as string); }} />
                    <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={(e: React.MouseEvent) => { e.stopPropagation(); navigate('/ar/credits/edit', { state: { mode: 'edit', creditId: row['id'] as string } }); }} />
                </div>
            )
        }
    ];

    const returnColumns = [
        { key: 'id', label: 'Sales Return #' },
        { key: 'returnDate', label: 'Date', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'customerName', label: 'Customer', sortable: true },
        { key: 'invoiceId', label: 'Source Invoice' },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={(val as string) === 'Approved' ? 'Success' : 'Warning'} label={val as string} /> },
        {
            key: 'actions',
            label: '',
            render: (_: unknown, row: Record<string, unknown>) => (
                <div className="row-actions-end">
                    {(row['status'] as string) === 'Approved' && (
                        <Button text="Void" size="small" variant="tertiary" disabled={!canEdit || voidSalesReturn.isPending} onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleVoidReturn(row['id'] as string); }} />
                    )}
                    <Button
                        text="Open"
                        size="small"
                        variant="tertiary"
                        onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            openDoc('return', row['id'] as string);
                        }}
                    />
                </div>
            )
        }
    ];

    const filterOptions = [
        {
            key: 'settlementType',
            label: 'Settlement Type',
            options: [
                { value: 'Apply to Invoice', label: 'Apply to Invoice' },
                { value: 'Refund', label: 'Refund' }
            ]
        }
    ];

    /** Resolve a composite key to a display label */
    const getTabLabel = (key: string): string => {
        const { type, id } = fromKey(key);
        if (type === 'credit') {
            const doc = creditNotes.find((item) => item.id === id);
            return doc ? doc.id : id;
        }
        const doc = salesReturns.find((item) => item.id === id);
        return doc ? doc.id : id;
    };

    const handleExportCsv = () => {
        const rows = filteredCredits.map((cn) => ({
            id: cn.id,
            date: cn.date,
            customerName: cn.customerName,
            sourceInvoiceId: cn.sourceInvoiceId,
            amount: cn.amount,
            status: cn.status,
        }));
        exportToCsv('credit-notes.csv', rows, [
            { label: 'Number', key: 'id' },
            { label: 'Date', key: 'date' },
            { label: 'Customer', key: 'customerName' },
            { label: 'Source Invoice', key: 'sourceInvoiceId' },
            { label: 'Amount', key: 'amount' },
            { label: 'Status', key: 'status' },
        ]);
    };

    return (
        <div className="container ar-module container-full-width">
            <PageHeader
                title="Returns & Credits"
                subtitle="Credit notes and sales returns issued to customers."
                actions={
                    <Button
                        text="Export CSV"
                        size="small"
                        variant="secondary"
                        icon={<Download size={16} />}
                        onClick={handleExportCsv}
                    />
                }
            />

            <DocumentTabBar
                openIds={openDocKeys}
                selectedId={selectedKey}
                tabRows={tabRows}
                getLabel={getTabLabel}
                onSelect={(key) => {
                    const { type, id } = fromKey(key);
                    openDoc(type, id);
                }}
                onClose={closeDocTab}
                newTabLabel="New Sales Return"
                onNewTab={canCreate ? () => navigate('/ar/returns/new', { state: { mode: 'create' } }) : undefined}
                disableNew={!canCreate}
                onCatalog={selectNoneDoc}
                firstRowSuffix={
                    <div className="workbench-tab-count">Open tabs: {openDocKeys.length}</div>
                }
            />

            {!selectedDoc && (
                <>
                    <div className="invoice-tabs module-tabs module-tabs-spaced">
                        <button className={`invoice-tab ${activeCatalogTab === 'credits' ? 'active' : ''}`} onClick={() => setActiveCatalogTab('credits')}>
                            Credit Notes
                        </button>
                        <button className={`invoice-tab ${activeCatalogTab === 'returns' ? 'active' : ''}`} onClick={() => setActiveCatalogTab('returns')}>
                            Sales Returns
                        </button>
                    </div>

                    <FilterBar
                        onSearch={setSearchTerm}
                        filters={activeCatalogTab === 'credits' ? filterOptions : []}
                        activeFilters={filters as unknown as Record<string, string>}
                        onFilterChange={(key, val) => setFilters((prev) => ({ ...prev, [key]: val }))}
                        placeholder={activeCatalogTab === 'credits' ? 'Search credit #, return #, customer...' : 'Search return #, customer, invoice...'}
                    />

                    <Card padding={false}>
                        {activeCatalogTab === 'credits' ? (
                            <Table
                                columns={creditColumns as TableColumn<Record<string, unknown>>[]}
                                data={filteredCredits as unknown as Record<string, unknown>[]}
                                onRowClick={(row) => openDoc('credit', row['id'] as string)}
                                showCount
                                countLabel="credit notes"
                            />
                        ) : (
                            <Table
                                columns={returnColumns as TableColumn<Record<string, unknown>>[]}
                                data={filteredReturns as unknown as Record<string, unknown>[]}
                                onRowClick={(row) => openDoc('return', row['id'] as string)}
                                showCount
                                countLabel="credit notes"
                            />
                        )}
                    </Card>
                </>
            )}

            {selectedCredit && (
                <div className="invoice-workbench-card dense-mode">
                    <div className="dense-topbar">
                        <div className="detail-header-title">
                            <h2 className="detail-header-h2">{selectedCredit.id}</h2>
                            <StatusTag status={selectedCredit.status === 'Applied' ? 'Success' : 'Info'} label={selectedCredit.status} />
                        </div>
                        <div className="detail-header-actions">
                            <Button text="Print" size="small" variant="secondary" onClick={() => queuePrintCredit(selectedCredit.id)} />
                            <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={() => navigate('/ar/credits/edit', { state: { mode: 'edit', creditId: selectedCredit.id } })} />
                        </div>
                    </div>
                    <div className="dense-header-grid">
                        <div className="dense-field">
                            <label>Customer</label>
                            <div>{selectedCredit.customerName}</div>
                        </div>
                        <div className="dense-field">
                            <label>Credit Date</label>
                            <div>{formatDateID(selectedCredit.date)}</div>
                        </div>
                        <div className="dense-field">
                            <label>Source Invoice</label>
                            <div>{selectedCredit.sourceInvoiceId}</div>
                        </div>
                        <div className="dense-field">
                            <label>Settlement</label>
                            <div>{selectedCredit.settlementType}</div>
                        </div>
                        <div className="dense-amount">{formatIDR(selectedCredit.amount)}</div>
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
                                {detailTab === 'summary' && (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Credit #</label><strong>{selectedCredit.id}</strong></div>
                                        <div className="detail-field"><label>Status</label><StatusTag status={selectedCredit.status === 'Applied' ? 'Success' : 'Info'} label={selectedCredit.status} /></div>
                                        <div className="detail-field"><label>Sales Return</label><div>{selectedCredit.returnId}</div></div>
                                        <div className="detail-field"><label>Source Invoice</label><div>{selectedCredit.sourceInvoiceId}</div></div>
                                        <div className="detail-field"><label>Settlement Ref</label><div>{selectedCredit.settlementRef || '-'}</div></div>
                                        <div className="detail-field"><label>Amount</label><strong>{formatIDR(selectedCredit.amount)}</strong></div>
                                    </div>
                                )}
                                {detailTab === 'items' && (
                                    <div className="workbench-scroll-table">
                                        <table className="invoice-workbench-table">
                                            <thead>
                                                <tr>
                                                    <th>Item</th>
                                                    <th className="text-right">Qty Return</th>
                                                    <th>Unit</th>
                                                    <th className="text-right">Price</th>
                                                    <th className="text-right">Line Total</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {selectedCreditLines.length === 0 && (
                                                    <tr><td colSpan={5} className="table-empty-cell">No return lines.</td></tr>
                                                )}
                                                {(selectedCreditLines as ReturnLine[]).map((line, idx) => (
                                                    <tr key={`${line.itemId || line.id}-${idx}`}>
                                                        <td>{line.itemName}</td>
                                                        <td className="text-right">{line.qtyReturn}</td>
                                                        <td>{line.unit}</td>
                                                        <td className="text-right">{formatIDR(line.price)}</td>
                                                        <td className="text-right">{formatIDR(Number(line.qtyReturn || 0) * Number(line.price || 0))}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {detailTab === 'logistics' && (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Settlement Type</label><strong>{selectedCredit.settlementType}</strong></div>
                                        <div className="detail-field"><label>Settlement Ref</label><div>{selectedCredit.settlementRef || '-'}</div></div>
                                        <div className="detail-field"><label>Source Invoice</label><div>{selectedCredit.sourceInvoiceId}</div></div>
                                        <div className="detail-field"><label>Sales Return</label><div>{selectedCredit.returnId}</div></div>
                                    </div>
                                )}
                                {detailTab === 'attachments' && (
                                    <div className="attachment-empty">No attachments.</div>
                                )}
                                {detailTab === 'audit' && (
                                    <ul className="audit-list">
                                        <li>
                                            <div><strong>Credit note created</strong></div>
                                            <div>{formatDateID(selectedCredit.date)} • System</div>
                                        </li>
                                        <li>
                                            <div><strong>Linked to return {selectedCredit.returnId}</strong></div>
                                            <div>{formatDateID(selectedCredit.date)} • Auto process</div>
                                        </li>
                                    </ul>
                                )}
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
            )}

            {selectedReturn && (
                <div className="invoice-workbench-card dense-mode">
                    <div className="dense-topbar">
                        <div className="detail-header-title">
                            <h2 className="detail-header-h2">{selectedReturn.id}</h2>
                            <StatusTag status={selectedReturn.status === 'Approved' ? 'Success' : 'Warning'} label={selectedReturn.status} />
                        </div>
                        <div className="detail-header-actions">
                            {selectedReturn.status === 'Approved' && (
                                <Button text="Void" size="small" variant="secondary" disabled={!canEdit || voidSalesReturn.isPending} onClick={() => handleVoidReturn(selectedReturn.id)} />
                            )}
                            <Button text="Print" size="small" variant="secondary" onClick={() => queuePrintReturn(selectedReturn.id)} />
                            <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={() => navigate('/ar/returns/new', { state: { mode: 'edit', returnId: selectedReturn.id } })} />
                        </div>
                    </div>
                    <div className="dense-header-grid">
                        <div className="dense-field">
                            <label>Customer</label>
                            <div>{selectedReturn.customerName}</div>
                        </div>
                        <div className="dense-field">
                            <label>Return Date</label>
                            <div>{formatDateID(selectedReturn.returnDate)}</div>
                        </div>
                        <div className="dense-field">
                            <label>Source Invoice</label>
                            <div>{selectedReturn.invoiceId}</div>
                        </div>
                        <div className="dense-field">
                            <label>Warehouse</label>
                            <div>{(warehouses as Array<{ id: string; name: string }>).find((wh) => wh.id === selectedReturn.warehouseId)?.name || '-'}</div>
                        </div>
                        <div className="dense-amount">{formatIDR(getReturnTotal(selectedReturn as unknown as Record<string, unknown>))}</div>
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
                                {detailTab === 'summary' && (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Return #</label><strong>{selectedReturn.id}</strong></div>
                                        <div className="detail-field"><label>Status</label><StatusTag status={selectedReturn.status === 'Approved' ? 'Success' : 'Warning'} label={selectedReturn.status} /></div>
                                        <div className="detail-field"><label>Customer</label><div>{selectedReturn.customerName}</div></div>
                                        <div className="detail-field"><label>Source Invoice</label><div>{selectedReturn.invoiceId}</div></div>
                                        <div className="detail-field span-2"><label>Reason</label><div>{selectedReturn.reason || '-'}</div></div>
                                    </div>
                                )}
                                {detailTab === 'items' && (
                                    <div className="workbench-scroll-table">
                                        <table className="invoice-workbench-table">
                                            <thead>
                                                <tr>
                                                    <th>Item</th>
                                                    <th className="text-right">Qty Return</th>
                                                    <th>Unit</th>
                                                    <th className="text-right">Price</th>
                                                    <th className="text-right">Line Total</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {((selectedReturn.lines || []) as ReturnLine[]).map((line, idx) => (
                                                    <tr key={`${line.itemId || line.id}-${idx}`}>
                                                        <td>{line.itemName}</td>
                                                        <td className="text-right">{line.qtyReturn}</td>
                                                        <td>{line.unit}</td>
                                                        <td className="text-right">{formatIDR(line.price)}</td>
                                                        <td className="text-right">{formatIDR(Number(line.qtyReturn || 0) * Number(line.price || 0))}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {detailTab === 'logistics' && (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Warehouse</label><strong>{(warehouses as Array<{ id: string; name: string }>).find((wh) => wh.id === selectedReturn.warehouseId)?.name || '-'}</strong></div>
                                        <div className="detail-field"><label>Source Invoice</label><strong>{selectedReturn.invoiceId}</strong></div>
                                        <div className="detail-field"><label>Apply Tax</label><div>{selectedReturn.applyTax ? 'Yes' : 'No'}</div></div>
                                        <div className="detail-field"><label>Total Includes Tax</label><div>{selectedReturn.taxIncluded ? 'Yes' : 'No'}</div></div>
                                        <div className="detail-field"><label>Tax Rate</label><div>{selectedReturn.taxRate || 0}%</div></div>
                                        <div className="detail-field"><label>Total</label><strong>{formatIDR(getReturnTotal(selectedReturn as unknown as Record<string, unknown>))}</strong></div>
                                    </div>
                                )}
                                {detailTab === 'attachments' && (
                                    <div className="attachment-empty">No attachments.</div>
                                )}
                                {detailTab === 'audit' && (
                                    <ul className="audit-list">
                                        <li>
                                            <div><strong>Sales return created</strong></div>
                                            <div>{formatDateID(selectedReturn.returnDate)} • System</div>
                                        </li>
                                        <li>
                                            <div><strong>Status updated to {selectedReturn.status}</strong></div>
                                            <div>{formatDateID(selectedReturn.returnDate)} • AR User</div>
                                        </li>
                                    </ul>
                                )}
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
            )}

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

export default CreditNotes;

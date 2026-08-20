// src/components/ap/debits/APDebitNoteListPane.tsx
// Returns & Debits catalog. The only such list — the pre-workspace duplicate is gone.
// Records open as doc-view tabs keyed by a composite recordId: `debit:ID` | `return:ID`.
import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import Card from '../../UI/Card';
import Table, { TableColumn } from '../../UI/Table';
import Button from '../../UI/Button';
import StatusTag from '../../UI/StatusTag';
import FilterBar from '../../UI/FilterBar';
import PageHeader from '../../Layout/PageHeader';
import PrintPreviewModal from '../../UI/PrintPreviewModal';
import NotePrintTemplate from '../../print/NotePrintTemplate';
import { exportToCsv } from '../../../utils/exportCsv';
import { formatDateID, formatIDR } from '../../../utils/formatters';
import { useDebitNotes, usePurchaseReturns, useVoidDebitNote, useVoidPurchaseReturn } from '../../../hooks/useReturns';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../../hooks/useModulePermissions';
import { useSettingsStore } from '../../../stores/useSettingsStore';

interface ReturnLine { lineKey?: string; description: string; qtyReturn: number; unit: string; price: number }

const lineSubtotal = (lines: ReturnLine[]) => lines.reduce((s, l) => s + Number(l.qtyReturn || 0) * Number(l.price || 0), 0);
const getReturnTotal = (r: Record<string, unknown>) => {
    if (!r) return 0;
    const subtotal = ((r.lines as ReturnLine[]) || []).reduce((s, l) => s + Number(l.qtyReturn || 0) * Number(l.price || 0), 0);
    if (!r.applyTax) return subtotal;
    if (r.taxIncluded) return subtotal;
    return subtotal + subtotal * (Number(r.taxRate || 0) / 100);
};

const APDebitNoteListPane = (): React.ReactElement => {
    const { canCreate, canEdit } = useModulePermissions('ap_debits');
    const { open } = useWorkspaceNav();
    const { data: dnData } = useDebitNotes();
    const debitNotes = useMemo(() => dnData?.data ?? [], [dnData?.data]);
    const { data: prData } = usePurchaseReturns();
    const purchaseReturns = useMemo(() => prData?.data ?? [], [prData?.data]);
    const voidDebitNote = useVoidDebitNote();
    const voidPurchaseReturn = useVoidPurchaseReturn();
    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);

    const [searchTerm, setSearchTerm] = useState('');
    const [settlementType, setSettlementType] = useState('');
    const [activeCatalogTab, setActiveCatalogTab] = useState('debits');
    const [isPrintOpen, setIsPrintOpen] = useState(false);
    const [printDoc, setPrintDoc] = useState<{ title: string; partyLabel: string; partyName?: string; document: Record<string, unknown>; lineItems: ReturnLine[]; subtotal: number; taxAmount: number; total: number } | null>(null);

    const handleVoidDebit = (id: string) => { if (!window.confirm('Void this debit note? Its journal entry will be reversed. This cannot be undone.')) return; voidDebitNote.mutate(id, { onError: (e: unknown) => window.alert(e instanceof Error ? e.message : 'Failed to void debit note') }); };
    const handleVoidReturn = (id: string) => { if (!window.confirm('Void this purchase return? Its journal entry will be reversed and the returned stock added back to inventory. This cannot be undone.')) return; voidPurchaseReturn.mutate(id, { onError: (e: unknown) => window.alert(e instanceof Error ? e.message : 'Failed to void purchase return') }); };

    const openDebit = (id: string) => open({ kind: 'doc-view', target: { module: 'ap', entity: 'debit-note', recordId: `debit:${id}`, mode: 'view' }, title: id, path: `/ap/debits?docKey=debit:${id}` });
    const openReturn = (id: string) => open({ kind: 'doc-view', target: { module: 'ap', entity: 'debit-note', recordId: `return:${id}`, mode: 'view' }, title: id, path: `/ap/debits?docKey=return:${id}` });
    const editDebit = (id: string) => open({ kind: 'doc-form', target: { module: 'ap', entity: 'debit-note', recordId: `debit:${id}`, mode: 'edit' }, title: `Edit ${id}`, path: `/ap/debits/edit?debitId=${id}` });
    const newReturn = () => open({ kind: 'doc-form', target: { module: 'ap', entity: 'debit-note', recordId: null, mode: 'create' }, title: 'New purchase return', path: '/ap/returns/new', unique: true });

    const queuePrintDebit = (id: string) => {
        const debit = debitNotes.find((d) => d.id === id); if (!debit) return;
        const lines = ((purchaseReturns.find((r) => r.id === debit.returnId)?.lines) as ReturnLine[] | undefined) || [];
        const subtotal = lineSubtotal(lines); const total = Number(debit.amount || 0);
        setPrintDoc({ title: 'DEBIT NOTE', partyLabel: 'Vendor', partyName: debit.vendorName, document: { number: debit.id, date: debit.date, status: debit.status, reference: debit.sourceBillId }, lineItems: lines, subtotal, taxAmount: Math.max(0, total - subtotal), total });
        setIsPrintOpen(true);
    };

    const filteredDebits = useMemo(() => debitNotes.filter((item) => {
        const kw = searchTerm.toLowerCase();
        const matchesSearch = item.vendorName.toLowerCase().includes(kw) || item.id.toLowerCase().includes(kw) || item.sourceBillId.toLowerCase().includes(kw) || item.returnId.toLowerCase().includes(kw);
        return matchesSearch && (settlementType ? item.settlementType === settlementType : true);
    }), [searchTerm, settlementType, debitNotes]);
    const filteredReturns = useMemo(() => purchaseReturns.filter((item) => {
        const kw = searchTerm.toLowerCase();
        return item.vendorName.toLowerCase().includes(kw) || item.id.toLowerCase().includes(kw) || item.billId.toLowerCase().includes(kw);
    }), [searchTerm, purchaseReturns]);

    const debitColumns = [
        { key: 'id', label: 'Debit Note #' },
        { key: 'returnId', label: 'Purchase Return #' },
        { key: 'date', label: 'Date', render: (val: unknown) => formatDateID(val as string) },
        { key: 'vendorName', label: 'Vendor' },
        { key: 'sourceBillId', label: 'Source Bill' },
        { key: 'amount', label: 'Amount', align: 'right' as const, render: (val: unknown) => formatIDR(val as number) },
        { key: 'settlementType', label: 'Settlement', render: (val: unknown, row: Record<string, unknown>) => `${val as string}${row['settlementRef'] ? ` • ${row['settlementRef'] as string}` : ''}` },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={(val as string) === 'Applied' ? 'Success' : 'Info'} label={val as string} /> },
        { key: 'actions', label: '', render: (_: unknown, row: Record<string, unknown>) => (
            <div className="row-actions-end">
                {(row['status'] as string) === 'Applied' && <Button text="Void" size="small" variant="tertiary" disabled={!canEdit || voidDebitNote.isPending} onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleVoidDebit(row['id'] as string); }} />}
                <Button text="View" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openDebit(row['id'] as string); }} />
                <Button text="Print" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); queuePrintDebit(row['id'] as string); }} />
                <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={(e: React.MouseEvent) => { e.stopPropagation(); editDebit(row['id'] as string); }} />
            </div>
        ) },
    ];
    const returnColumns = [
        { key: 'id', label: 'Purchase Return #' },
        { key: 'returnDate', label: 'Date', render: (val: unknown) => formatDateID(val as string) },
        { key: 'vendorName', label: 'Vendor' },
        { key: 'billId', label: 'Source Bill' },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={(val as string) === 'Approved' ? 'Success' : 'Warning'} label={val as string} /> },
        { key: 'actions', label: '', render: (_: unknown, row: Record<string, unknown>) => (
            <div className="row-actions-end">
                {(row['status'] as string) === 'Approved' && <Button text="Void" size="small" variant="tertiary" disabled={!canEdit || voidPurchaseReturn.isPending} onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleVoidReturn(row['id'] as string); }} />}
                <Button text="Open" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openReturn(row['id'] as string); }} />
            </div>
        ) },
    ];

    const handleExportCsv = () => {
        const rows = filteredDebits.map((dn) => ({ id: dn.id, date: dn.date, vendorName: dn.vendorName, sourceBillId: dn.sourceBillId, amount: dn.amount, status: dn.status }));
        exportToCsv('debit-notes.csv', rows, [
            { label: 'Number', key: 'id' }, { label: 'Date', key: 'date' }, { label: 'Vendor', key: 'vendorName' },
            { label: 'Source Bill', key: 'sourceBillId' }, { label: 'Amount', key: 'amount' }, { label: 'Status', key: 'status' },
        ]);
    };

    return (
        <div className="container ap-module container-full-width">
            <PageHeader
                title="Returns & Debits"
                subtitle="Debit notes and purchase returns issued to vendors."
                actions={
                    <div className="flex gap-2">
                        <Button text="Export CSV" size="small" variant="secondary" icon={<Download size={16} />} onClick={handleExportCsv} />
                        {canCreate && <Button text="New Purchase Return" size="small" onClick={newReturn} />}
                    </div>
                }
            />
            <div className="invoice-tabs module-tabs module-tabs-spaced">
                <button className={`invoice-tab ${activeCatalogTab === 'debits' ? 'active' : ''}`} onClick={() => setActiveCatalogTab('debits')}>Debit Notes</button>
                <button className={`invoice-tab ${activeCatalogTab === 'returns' ? 'active' : ''}`} onClick={() => setActiveCatalogTab('returns')}>Purchase Returns</button>
            </div>
            <FilterBar
                onSearch={setSearchTerm}
                filters={activeCatalogTab === 'debits' ? [{ key: 'settlementType', label: 'Settlement Type', options: [{ value: 'Apply to Bill', label: 'Apply to Bill' }, { value: 'Refund from Vendor', label: 'Refund from Vendor' }] }] : []}
                activeFilters={{ settlementType } as unknown as Record<string, string>}
                onFilterChange={(_key, val) => setSettlementType(val)}
                placeholder={activeCatalogTab === 'debits' ? 'Search debit #, return #, vendor...' : 'Search return #, vendor, bill...'}
            />
            <Card padding={false}>
                {activeCatalogTab === 'debits' ? (
                    <Table columns={debitColumns as TableColumn<Record<string, unknown>>[]} data={filteredDebits as unknown as Record<string, unknown>[]} onRowClick={(row) => openDebit(row['id'] as string)} showCount countLabel="debit notes" />
                ) : (
                    <Table columns={returnColumns as TableColumn<Record<string, unknown>>[]} data={filteredReturns as unknown as Record<string, unknown>[]} onRowClick={(row) => openReturn(row['id'] as string)} showCount countLabel="purchase returns" />
                )}
            </Card>

            <PrintPreviewModal isOpen={isPrintOpen} onClose={() => setIsPrintOpen(false)} title={`${printDoc?.title || 'Document'} Preview`} documentTitle={`${(printDoc?.document?.number as string) || 'document'}`} defaultPaperSize={printSettings.defaultPaperSize}>
                {printDoc && <NotePrintTemplate title={printDoc.title} partyLabel={printDoc.partyLabel} partyName={printDoc.partyName} document={printDoc.document} lineItems={printDoc.lineItems as unknown as Record<string, unknown>[]} subtotal={printDoc.subtotal} taxAmount={printDoc.taxAmount} total={printDoc.total} company={company} options={printSettings} />}
            </PrintPreviewModal>
        </div>
    );
};

export default APDebitNoteListPane;
export { getReturnTotal, lineSubtotal };
export type { ReturnLine };

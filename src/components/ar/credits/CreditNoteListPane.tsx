// src/components/ar/credits/CreditNoteListPane.tsx
// Returns & Credits catalog. The only such list — the pre-workspace duplicate is gone.
// Records open as doc-view tabs keyed by a composite recordId: `credit:ID` | `return:ID`.
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
import { useCreditNotes, useSalesReturns, useVoidCreditNote, useVoidSalesReturn } from '../../../hooks/useReturns';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../../hooks/useModulePermissions';
import { useSettingsStore } from '../../../stores/useSettingsStore';

interface ReturnLine { itemId?: string; id?: string; itemName: string; qtyReturn: number; unit: string; price: number }

const lineSubtotal = (lines: ReturnLine[]) => lines.reduce((s, l) => s + Number(l.qtyReturn || 0) * Number(l.price || 0), 0);
const getReturnTotal = (r: Record<string, unknown>) => {
    if (!r) return 0;
    const subtotal = ((r.lines as ReturnLine[]) || []).reduce((s, l) => s + Number(l.qtyReturn || 0) * Number(l.price || 0), 0);
    if (!r.applyTax) return subtotal;
    if (r.taxIncluded) return subtotal;
    return subtotal + subtotal * (Number(r.taxRate || 0) / 100);
};

const CreditNoteListPane = (): React.ReactElement => {
    const { canCreate, canEdit } = useModulePermissions('ar_credits');
    const { open } = useWorkspaceNav();
    const { data: cnData } = useCreditNotes();
    const creditNotes = useMemo(() => cnData?.data ?? [], [cnData?.data]);
    const { data: srData } = useSalesReturns();
    const salesReturns = useMemo(() => srData?.data ?? [], [srData?.data]);
    const voidCreditNote = useVoidCreditNote();
    const voidSalesReturn = useVoidSalesReturn();
    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);

    const [searchTerm, setSearchTerm] = useState('');
    const [settlementType, setSettlementType] = useState('');
    const [activeCatalogTab, setActiveCatalogTab] = useState('credits');
    const [isPrintOpen, setIsPrintOpen] = useState(false);
    const [printDoc, setPrintDoc] = useState<{ title: string; partyLabel: string; partyName?: string; document: Record<string, unknown>; lineItems: ReturnLine[]; subtotal: number; taxAmount: number; total: number } | null>(null);

    const handleVoidCredit = (id: string) => { if (!window.confirm('Void this credit note? Its journal entry will be reversed. This cannot be undone.')) return; voidCreditNote.mutate(id, { onError: (e: unknown) => window.alert(e instanceof Error ? e.message : 'Failed to void credit note') }); };
    const handleVoidReturn = (id: string) => { if (!window.confirm('Void this sales return? Its journal entry will be reversed and the restocked inventory removed. This cannot be undone.')) return; voidSalesReturn.mutate(id, { onError: (e: unknown) => window.alert(e instanceof Error ? e.message : 'Failed to void sales return') }); };

    const openCredit = (id: string) => open({ kind: 'doc-view', target: { module: 'ar', entity: 'credit-note', recordId: `credit:${id}`, mode: 'view' }, title: id, path: `/ar/credits?docKey=credit:${id}` });
    const openReturn = (id: string) => open({ kind: 'doc-view', target: { module: 'ar', entity: 'credit-note', recordId: `return:${id}`, mode: 'view' }, title: id, path: `/ar/credits?docKey=return:${id}` });
    const editCredit = (id: string) => open({ kind: 'doc-form', target: { module: 'ar', entity: 'credit-note', recordId: `credit:${id}`, mode: 'edit' }, title: `Edit ${id}`, path: `/ar/credits/edit?creditId=${id}` });
    const newReturn = () => open({ kind: 'doc-form', target: { module: 'ar', entity: 'credit-note', recordId: null, mode: 'create' }, title: 'New sales return', path: '/ar/returns/new', unique: true });

    const queuePrintCredit = (id: string) => {
        const credit = creditNotes.find((c) => c.id === id); if (!credit) return;
        const lines = ((salesReturns.find((r) => r.id === credit.returnId)?.lines) as ReturnLine[] | undefined) || [];
        const subtotal = lineSubtotal(lines); const total = Number(credit.amount || 0);
        setPrintDoc({ title: 'CREDIT NOTE', partyLabel: 'Customer', partyName: credit.customerName, document: { number: credit.number, date: credit.date, status: credit.status, reference: credit.sourceInvoiceNumber }, lineItems: lines, subtotal, taxAmount: Math.max(0, total - subtotal), total });
        setIsPrintOpen(true);
    };

    const filteredCredits = useMemo(() => creditNotes.filter((item) => {
        const kw = searchTerm.toLowerCase();
        const matchesSearch = item.customerName.toLowerCase().includes(kw) || item.number.toLowerCase().includes(kw)
            || item.sourceInvoiceNumber.toLowerCase().includes(kw) || item.returnNumber.toLowerCase().includes(kw);
        return matchesSearch && (settlementType ? item.settlementType === settlementType : true);
    }), [searchTerm, settlementType, creditNotes]);
    const filteredReturns = useMemo(() => salesReturns.filter((item) => {
        const kw = searchTerm.toLowerCase();
        return item.customerName.toLowerCase().includes(kw) || item.number.toLowerCase().includes(kw) || item.invoiceNumber.toLowerCase().includes(kw);
    }), [searchTerm, salesReturns]);

    const creditColumns = [
        { key: 'number', label: 'Credit Note #' },
        { key: 'returnNumber', label: 'Sales Return #' },
        { key: 'date', label: 'Date', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'customerName', label: 'Customer', sortable: true },
        { key: 'sourceInvoiceNumber', label: 'Source Invoice' },
        { key: 'amount', label: 'Amount', align: 'right' as const, render: (val: unknown) => formatIDR(val as number) },
        { key: 'settlementType', label: 'Settlement', render: (val: unknown, row: Record<string, unknown>) => `${val as string}${row['sourceInvoiceNumber'] ? ` • ${row['sourceInvoiceNumber'] as string}` : ''}` },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={(val as string) === 'Applied' ? 'Success' : 'Info'} label={val as string} /> },
        { key: 'actions', label: '', render: (_: unknown, row: Record<string, unknown>) => (
            <div className="row-actions-end">
                {(row['status'] as string) === 'Applied' && <Button text="Void" size="small" variant="tertiary" disabled={!canEdit || voidCreditNote.isPending} onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleVoidCredit(row['id'] as string); }} />}
                <Button text="View" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openCredit(row['id'] as string); }} />
                <Button text="Print" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); queuePrintCredit(row['id'] as string); }} />
                <Button text="Edit" size="small" variant="tertiary" disabled={!canEdit} onClick={(e: React.MouseEvent) => { e.stopPropagation(); editCredit(row['id'] as string); }} />
            </div>
        ) },
    ];
    const returnColumns = [
        { key: 'number', label: 'Sales Return #' },
        { key: 'returnDate', label: 'Date', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'customerName', label: 'Customer', sortable: true },
        { key: 'invoiceNumber', label: 'Source Invoice' },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={(val as string) === 'Approved' ? 'Success' : 'Warning'} label={val as string} /> },
        { key: 'actions', label: '', render: (_: unknown, row: Record<string, unknown>) => (
            <div className="row-actions-end">
                {(row['status'] as string) === 'Approved' && <Button text="Void" size="small" variant="tertiary" disabled={!canEdit || voidSalesReturn.isPending} onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleVoidReturn(row['id'] as string); }} />}
                <Button text="Open" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openReturn(row['id'] as string); }} />
            </div>
        ) },
    ];

    const handleExportCsv = () => {
        const rows = filteredCredits.map((cn) => ({ number: cn.number, date: cn.date, customerName: cn.customerName, sourceInvoiceNumber: cn.sourceInvoiceNumber, amount: cn.amount, status: cn.status }));
        exportToCsv('credit-notes.csv', rows, [
            { label: 'Number', key: 'number' }, { label: 'Date', key: 'date' }, { label: 'Customer', key: 'customerName' },
            { label: 'Source Invoice', key: 'sourceInvoiceNumber' }, { label: 'Amount', key: 'amount' }, { label: 'Status', key: 'status' },
        ]);
    };

    return (
        <div className="container ar-module container-full-width">
            <PageHeader
                title="Returns & Credits"
                subtitle="Credit notes and sales returns issued to customers."
                actions={
                    <div className="flex gap-2">
                        <Button text="Export CSV" size="small" variant="secondary" icon={<Download size={16} />} onClick={handleExportCsv} />
                        {canCreate && <Button text="New Sales Return" size="small" onClick={newReturn} />}
                    </div>
                }
            />
            <div className="invoice-tabs module-tabs module-tabs-spaced">
                <button className={`invoice-tab ${activeCatalogTab === 'credits' ? 'active' : ''}`} onClick={() => setActiveCatalogTab('credits')}>Credit Notes</button>
                <button className={`invoice-tab ${activeCatalogTab === 'returns' ? 'active' : ''}`} onClick={() => setActiveCatalogTab('returns')}>Sales Returns</button>
            </div>
            <FilterBar
                onSearch={setSearchTerm}
                filters={activeCatalogTab === 'credits' ? [{ key: 'settlementType', label: 'Settlement Type', options: [{ value: 'Apply to Invoice', label: 'Apply to Invoice' }, { value: 'Refund', label: 'Refund' }] }] : []}
                activeFilters={{ settlementType } as unknown as Record<string, string>}
                onFilterChange={(_key, val) => setSettlementType(val)}
                placeholder={activeCatalogTab === 'credits' ? 'Search credit #, return #, customer...' : 'Search return #, customer, invoice...'}
            />
            <Card padding={false}>
                {activeCatalogTab === 'credits' ? (
                    <Table columns={creditColumns as TableColumn<Record<string, unknown>>[]} data={filteredCredits as unknown as Record<string, unknown>[]} onRowClick={(row) => openCredit(row['id'] as string)} showCount countLabel="credit notes" />
                ) : (
                    <Table columns={returnColumns as TableColumn<Record<string, unknown>>[]} data={filteredReturns as unknown as Record<string, unknown>[]} onRowClick={(row) => openReturn(row['id'] as string)} showCount countLabel="sales returns" />
                )}
            </Card>

            <PrintPreviewModal isOpen={isPrintOpen} onClose={() => setIsPrintOpen(false)} title={`${printDoc?.title || 'Document'} Preview`} documentTitle={`${(printDoc?.document?.number as string) || 'document'}`} defaultPaperSize={printSettings.defaultPaperSize}>
                {printDoc && <NotePrintTemplate title={printDoc.title} partyLabel={printDoc.partyLabel} partyName={printDoc.partyName} document={printDoc.document} lineItems={printDoc.lineItems as unknown as Record<string, unknown>[]} subtotal={printDoc.subtotal} taxAmount={printDoc.taxAmount} total={printDoc.total} company={company} options={printSettings} />}
            </PrintPreviewModal>
        </div>
    );
};

export default CreditNoteListPane;
export { getReturnTotal, lineSubtotal };
export type { ReturnLine };

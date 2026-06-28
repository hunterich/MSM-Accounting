// src/components/ar/credits/CreditNoteDetailPane.tsx
// Workspace-native detail for a credit note OR a sales return — `docKey` is the
// composite recordId (`credit:ID` | `return:ID`).
import React, { useMemo, useState } from 'react';
import { FileText, Paperclip, MoreHorizontal, Trash2 } from 'lucide-react';
import Button from '../../UI/Button';
import StatusTag from '../../UI/StatusTag';
import PrintPreviewModal from '../../UI/PrintPreviewModal';
import NotePrintTemplate from '../../print/NotePrintTemplate';
import { formatDateID, formatIDR } from '../../../utils/formatters';
import { useCreditNotes, useSalesReturns, useWarehouses, useVoidCreditNote, useVoidSalesReturn } from '../../../hooks/useReturns';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../../hooks/useModulePermissions';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { getReturnTotal, lineSubtotal, type ReturnLine } from './CreditNoteListPane';

interface Props { docKey: string; workspaceTabId: string }

const CreditNoteDetailPane = ({ docKey }: Props): React.ReactElement => {
    const colon = docKey.indexOf(':');
    const type = docKey.slice(0, colon) as 'credit' | 'return';
    const id = docKey.slice(colon + 1);

    const { canEdit, canDelete } = useModulePermissions('ar_credits');
    const { open } = useWorkspaceNav();
    const { data: cnData } = useCreditNotes();
    const creditNotes = cnData?.data ?? [];
    const { data: srData } = useSalesReturns();
    const salesReturns = srData?.data ?? [];
    const { data: warehouses = [] } = useWarehouses();
    const voidCreditNote = useVoidCreditNote();
    const voidSalesReturn = useVoidSalesReturn();
    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);
    const [detailTab, setDetailTab] = useState('summary');
    const [isPrintOpen, setIsPrintOpen] = useState(false);
    const [printDoc, setPrintDoc] = useState<{ title: string; partyLabel: string; partyName?: string; document: Record<string, unknown>; lineItems: ReturnLine[]; subtotal: number; taxAmount: number; total: number } | null>(null);

    const credit = type === 'credit' ? creditNotes.find((c) => c.id === id) ?? null : null;
    const ret = type === 'return' ? salesReturns.find((r) => r.id === id) ?? null : null;

    const creditLines = useMemo(() => {
        if (!credit) return [] as ReturnLine[];
        return (salesReturns.find((r) => r.id === credit.returnId)?.lines as ReturnLine[] | undefined) || [];
    }, [credit, salesReturns]);

    const handleVoidCredit = () => { if (!credit || !window.confirm('Void this credit note? Its journal entry will be reversed. This cannot be undone.')) return; voidCreditNote.mutate(credit.id, { onError: (e: unknown) => window.alert(e instanceof Error ? e.message : 'Failed to void credit note') }); };
    const handleVoidReturn = () => { if (!ret || !window.confirm('Void this sales return? Its journal entry will be reversed and the restocked inventory removed. This cannot be undone.')) return; voidSalesReturn.mutate(ret.id, { onError: (e: unknown) => window.alert(e instanceof Error ? e.message : 'Failed to void sales return') }); };
    const editCredit = () => credit && open({ kind: 'doc-form', target: { module: 'ar', entity: 'credit-note', recordId: `credit:${credit.id}`, mode: 'edit' }, title: `Edit ${credit.id}`, path: `/ar/credits/edit?creditId=${credit.id}` });
    const editReturn = () => ret && open({ kind: 'doc-form', target: { module: 'ar', entity: 'credit-note', recordId: `return:${ret.id}`, mode: 'edit' }, title: `Edit ${ret.id}`, path: `/ar/returns/new?returnId=${ret.id}` });

    const printCredit = () => { if (!credit) return; const lines = creditLines; const subtotal = lineSubtotal(lines); const total = Number(credit.amount || 0); setPrintDoc({ title: 'CREDIT NOTE', partyLabel: 'Customer', partyName: credit.customerName, document: { number: credit.id, date: credit.date, status: credit.status, reference: credit.sourceInvoiceId }, lineItems: lines, subtotal, taxAmount: Math.max(0, total - subtotal), total }); setIsPrintOpen(true); };
    const printReturn = () => { if (!ret) return; const lines = (ret.lines as ReturnLine[] | undefined) || []; const subtotal = lineSubtotal(lines); const total = getReturnTotal(ret as unknown as Record<string, unknown>); setPrintDoc({ title: 'SALES RETURN', partyLabel: 'Customer', partyName: ret.customerName, document: { number: ret.id, date: ret.returnDate, status: ret.status, reference: ret.invoiceId }, lineItems: lines, subtotal, taxAmount: Math.max(0, total - subtotal), total }); setIsPrintOpen(true); };

    const ItemsTable = ({ lines }: { lines: ReturnLine[] }) => (
        <div className="workbench-scroll-table">
            <table className="invoice-workbench-table">
                <thead><tr><th>Item</th><th className="text-right">Qty Return</th><th>Unit</th><th className="text-right">Price</th><th className="text-right">Line Total</th></tr></thead>
                <tbody>
                    {lines.length === 0 && <tr><td colSpan={5} className="table-empty-cell">No return lines.</td></tr>}
                    {lines.map((line, idx) => (
                        <tr key={`${line.itemId || line.id}-${idx}`}><td>{line.itemName}</td><td className="text-right">{line.qtyReturn}</td><td>{line.unit}</td><td className="text-right">{formatIDR(line.price)}</td><td className="text-right">{formatIDR(Number(line.qtyReturn || 0) * Number(line.price || 0))}</td></tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
    const Tabs = () => (
        <div className="detail-tabs dense-tabs">
            {(['summary', 'items', 'logistics', 'attachments', 'audit'] as const).map((t) => (
                <button key={t} className={`detail-tab ${detailTab === t ? 'active' : ''}`} onClick={() => setDetailTab(t)}>{t === 'audit' ? 'Audit / Journal' : t.charAt(0).toUpperCase() + t.slice(1)}</button>
            ))}
        </div>
    );
    const SideActions = () => (
        <div className="dense-side-actions">
            <button className="dense-side-btn" title="Details"><FileText size={18} /></button>
            <button className="dense-side-btn" title="Attachments"><Paperclip size={18} /></button>
            <button className="dense-side-btn success" title="More"><MoreHorizontal size={18} /></button>
            <button className={`dense-side-btn danger ${canDelete ? '' : 'opacity-60 cursor-not-allowed'}`} title="Delete" disabled={!canDelete}><Trash2 size={18} /></button>
        </div>
    );

    const printModal = (
        <PrintPreviewModal isOpen={isPrintOpen} onClose={() => setIsPrintOpen(false)} title={`${printDoc?.title || 'Document'} Preview`} documentTitle={`${(printDoc?.document?.number as string) || 'document'}`} defaultPaperSize={printSettings.defaultPaperSize}>
            {printDoc && <NotePrintTemplate title={printDoc.title} partyLabel={printDoc.partyLabel} partyName={printDoc.partyName} document={printDoc.document} lineItems={printDoc.lineItems as unknown as Record<string, unknown>[]} subtotal={printDoc.subtotal} taxAmount={printDoc.taxAmount} total={printDoc.total} company={company} options={printSettings} />}
        </PrintPreviewModal>
    );

    if (type === 'credit') {
        if (!credit) return <div className="p-6 text-sm text-neutral-500">Credit note not found.</div>;
        return (
            <div className="container ar-module container-full-width">
                <div className="invoice-workbench-card dense-mode">
                    <div className="dense-topbar">
                        <div className="detail-header-title"><h2 className="detail-header-h2">{credit.id}</h2><StatusTag status={credit.status === 'Applied' ? 'Success' : 'Info'} label={credit.status} /></div>
                        <div className="detail-header-actions">
                            {credit.status === 'Applied' && <Button text="Void" size="small" variant="secondary" disabled={!canEdit || voidCreditNote.isPending} onClick={handleVoidCredit} />}
                            <Button text="Print" size="small" variant="secondary" onClick={printCredit} />
                            <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={editCredit} />
                        </div>
                    </div>
                    <div className="dense-header-grid">
                        <div className="dense-field"><label>Customer</label><div>{credit.customerName}</div></div>
                        <div className="dense-field"><label>Credit Date</label><div>{formatDateID(credit.date)}</div></div>
                        <div className="dense-field"><label>Source Invoice</label><div>{credit.sourceInvoiceId}</div></div>
                        <div className="dense-field"><label>Settlement</label><div>{credit.settlementType}</div></div>
                        <div className="dense-amount">{formatIDR(credit.amount)}</div>
                    </div>
                    <div className="dense-body">
                        <div className="dense-main">
                            <Tabs />
                            <div className="detail-tab-content dense-content">
                                {detailTab === 'summary' && (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Credit #</label><strong>{credit.id}</strong></div>
                                        <div className="detail-field"><label>Status</label><StatusTag status={credit.status === 'Applied' ? 'Success' : 'Info'} label={credit.status} /></div>
                                        <div className="detail-field"><label>Sales Return</label><div>{credit.returnId}</div></div>
                                        <div className="detail-field"><label>Source Invoice</label><div>{credit.sourceInvoiceId}</div></div>
                                        <div className="detail-field"><label>Settlement Ref</label><div>{credit.settlementRef || '-'}</div></div>
                                        <div className="detail-field"><label>Amount</label><strong>{formatIDR(credit.amount)}</strong></div>
                                    </div>
                                )}
                                {detailTab === 'items' && <ItemsTable lines={creditLines} />}
                                {detailTab === 'logistics' && (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Settlement Type</label><strong>{credit.settlementType}</strong></div>
                                        <div className="detail-field"><label>Settlement Ref</label><div>{credit.settlementRef || '-'}</div></div>
                                        <div className="detail-field"><label>Source Invoice</label><div>{credit.sourceInvoiceId}</div></div>
                                        <div className="detail-field"><label>Sales Return</label><div>{credit.returnId}</div></div>
                                    </div>
                                )}
                                {detailTab === 'attachments' && <div className="attachment-empty">No attachments.</div>}
                                {detailTab === 'audit' && <ul className="audit-list"><li><div><strong>Credit note created</strong></div><div>{formatDateID(credit.date)} • System</div></li><li><div><strong>Linked to return {credit.returnId}</strong></div><div>{formatDateID(credit.date)} • Auto process</div></li></ul>}
                            </div>
                        </div>
                        <SideActions />
                    </div>
                </div>
                {printModal}
            </div>
        );
    }

    if (!ret) return <div className="p-6 text-sm text-neutral-500">Sales return not found.</div>;
    const returnLines = (ret.lines as ReturnLine[] | undefined) || [];
    return (
        <div className="container ar-module container-full-width">
            <div className="invoice-workbench-card dense-mode">
                <div className="dense-topbar">
                    <div className="detail-header-title"><h2 className="detail-header-h2">{ret.id}</h2><StatusTag status={ret.status === 'Approved' ? 'Success' : 'Warning'} label={ret.status} /></div>
                    <div className="detail-header-actions">
                        {ret.status === 'Approved' && <Button text="Void" size="small" variant="secondary" disabled={!canEdit || voidSalesReturn.isPending} onClick={handleVoidReturn} />}
                        <Button text="Print" size="small" variant="secondary" onClick={printReturn} />
                        <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={editReturn} />
                    </div>
                </div>
                <div className="dense-header-grid">
                    <div className="dense-field"><label>Customer</label><div>{ret.customerName}</div></div>
                    <div className="dense-field"><label>Return Date</label><div>{formatDateID(ret.returnDate)}</div></div>
                    <div className="dense-field"><label>Source Invoice</label><div>{ret.invoiceId}</div></div>
                    <div className="dense-field"><label>Warehouse</label><div>{(warehouses as Array<{ id: string; name: string }>).find((w) => w.id === ret.warehouseId)?.name || '-'}</div></div>
                    <div className="dense-amount">{formatIDR(getReturnTotal(ret as unknown as Record<string, unknown>))}</div>
                </div>
                <div className="dense-body">
                    <div className="dense-main">
                        <Tabs />
                        <div className="detail-tab-content dense-content">
                            {detailTab === 'summary' && (
                                <div className="detail-grid">
                                    <div className="detail-field"><label>Return #</label><strong>{ret.id}</strong></div>
                                    <div className="detail-field"><label>Status</label><StatusTag status={ret.status === 'Approved' ? 'Success' : 'Warning'} label={ret.status} /></div>
                                    <div className="detail-field"><label>Customer</label><div>{ret.customerName}</div></div>
                                    <div className="detail-field"><label>Source Invoice</label><div>{ret.invoiceId}</div></div>
                                    <div className="detail-field span-2"><label>Reason</label><div>{ret.reason || '-'}</div></div>
                                </div>
                            )}
                            {detailTab === 'items' && <ItemsTable lines={returnLines} />}
                            {detailTab === 'logistics' && (
                                <div className="detail-grid">
                                    <div className="detail-field"><label>Warehouse</label><strong>{(warehouses as Array<{ id: string; name: string }>).find((w) => w.id === ret.warehouseId)?.name || '-'}</strong></div>
                                    <div className="detail-field"><label>Source Invoice</label><strong>{ret.invoiceId}</strong></div>
                                    <div className="detail-field"><label>Apply Tax</label><div>{ret.applyTax ? 'Yes' : 'No'}</div></div>
                                    <div className="detail-field"><label>Total Includes Tax</label><div>{ret.taxIncluded ? 'Yes' : 'No'}</div></div>
                                    <div className="detail-field"><label>Tax Rate</label><div>{ret.taxRate || 0}%</div></div>
                                    <div className="detail-field"><label>Total</label><strong>{formatIDR(getReturnTotal(ret as unknown as Record<string, unknown>))}</strong></div>
                                </div>
                            )}
                            {detailTab === 'attachments' && <div className="attachment-empty">No attachments.</div>}
                            {detailTab === 'audit' && <ul className="audit-list"><li><div><strong>Sales return created</strong></div><div>{formatDateID(ret.returnDate)} • System</div></li><li><div><strong>Status updated to {ret.status}</strong></div><div>{formatDateID(ret.returnDate)} • AR User</div></li></ul>}
                        </div>
                    </div>
                    <SideActions />
                </div>
            </div>
            {printModal}
        </div>
    );
};

export default CreditNoteDetailPane;

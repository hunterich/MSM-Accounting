// src/components/ap/debits/APDebitNoteDetailPane.tsx
// Workspace-native detail for a debit note OR a purchase return — `docKey` is the
// composite recordId (`debit:ID` | `return:ID`).
import React, { useMemo, useState } from 'react';
import { FileText, Paperclip, MoreHorizontal, Trash2 } from 'lucide-react';
import Button from '../../UI/Button';
import StatusTag from '../../UI/StatusTag';
import PrintPreviewModal from '../../UI/PrintPreviewModal';
import NotePrintTemplate from '../../print/NotePrintTemplate';
import { formatDateID, formatIDR } from '../../../utils/formatters';
import { useDebitNotes, usePurchaseReturns, useWarehouses, useVoidDebitNote, useVoidPurchaseReturn } from '../../../hooks/useReturns';
import { useWorkspaceNav } from '../../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../../hooks/useModulePermissions';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { getReturnTotal, lineSubtotal, type ReturnLine } from './APDebitNoteListPane';

interface Props { docKey: string; workspaceTabId: string }

const APDebitNoteDetailPane = ({ docKey }: Props): React.ReactElement => {
    const colon = docKey.indexOf(':');
    const type = docKey.slice(0, colon) as 'debit' | 'return';
    const id = docKey.slice(colon + 1);

    const { canEdit, canDelete } = useModulePermissions('ap_debits');
    const { open } = useWorkspaceNav();
    const { data: dnData } = useDebitNotes();
    const debitNotes = dnData?.data ?? [];
    const { data: prData } = usePurchaseReturns();
    const purchaseReturns = prData?.data ?? [];
    const { data: warehouses = [] } = useWarehouses();
    const voidDebitNote = useVoidDebitNote();
    const voidPurchaseReturn = useVoidPurchaseReturn();
    const company = useSettingsStore((s) => s.companyInfo);
    const printSettings = useSettingsStore((s) => s.printSettings);
    const [detailTab, setDetailTab] = useState('summary');
    const [isPrintOpen, setIsPrintOpen] = useState(false);
    const [printDoc, setPrintDoc] = useState<{ title: string; partyLabel: string; partyName?: string; document: Record<string, unknown>; lineItems: ReturnLine[]; subtotal: number; taxAmount: number; total: number } | null>(null);

    const debit = type === 'debit' ? debitNotes.find((d) => d.id === id) ?? null : null;
    const ret = type === 'return' ? purchaseReturns.find((r) => r.id === id) ?? null : null;
    const debitLines = useMemo(() => {
        if (!debit) return [] as ReturnLine[];
        return (purchaseReturns.find((r) => r.id === debit.returnId)?.lines as ReturnLine[] | undefined) || [];
    }, [debit, purchaseReturns]);

    const handleVoidDebit = () => { if (!debit || !window.confirm('Void this debit note? Its journal entry will be reversed. This cannot be undone.')) return; voidDebitNote.mutate(debit.id, { onError: (e: unknown) => window.alert(e instanceof Error ? e.message : 'Failed to void debit note') }); };
    const handleVoidReturn = () => { if (!ret || !window.confirm('Void this purchase return? Its journal entry will be reversed and the returned stock added back to inventory. This cannot be undone.')) return; voidPurchaseReturn.mutate(ret.id, { onError: (e: unknown) => window.alert(e instanceof Error ? e.message : 'Failed to void purchase return') }); };
    const editDebit = () => debit && open({ kind: 'doc-form', target: { module: 'ap', entity: 'debit-note', recordId: `debit:${debit.id}`, mode: 'edit' }, title: `Edit ${debit.id}`, path: `/ap/debits/edit?debitId=${debit.id}` });
    const editReturn = () => ret && open({ kind: 'doc-form', target: { module: 'ap', entity: 'debit-note', recordId: `return:${ret.id}`, mode: 'edit' }, title: `Edit ${ret.id}`, path: `/ap/returns/new?returnId=${ret.id}` });

    const printDebit = () => { if (!debit) return; const lines = debitLines; const subtotal = lineSubtotal(lines); const total = Number(debit.amount || 0); setPrintDoc({ title: 'DEBIT NOTE', partyLabel: 'Vendor', partyName: debit.vendorName, document: { number: debit.id, date: debit.date, status: debit.status, reference: debit.sourceBillId }, lineItems: lines, subtotal, taxAmount: Math.max(0, total - subtotal), total }); setIsPrintOpen(true); };
    const printReturn = () => { if (!ret) return; const lines = (ret.lines as ReturnLine[] | undefined) || []; const subtotal = lineSubtotal(lines); const total = getReturnTotal(ret as unknown as Record<string, unknown>); setPrintDoc({ title: 'PURCHASE RETURN', partyLabel: 'Vendor', partyName: ret.vendorName, document: { number: ret.id, date: ret.returnDate, status: ret.status, reference: ret.billId }, lineItems: lines, subtotal, taxAmount: Math.max(0, total - subtotal), total }); setIsPrintOpen(true); };

    const ItemsTable = ({ lines }: { lines: ReturnLine[] }) => (
        <div className="workbench-scroll-table">
            <table className="invoice-workbench-table">
                <thead><tr><th>Description</th><th className="text-right">Qty Return</th><th>Unit</th><th className="text-right">Price</th><th className="text-right">Line Total</th></tr></thead>
                <tbody>
                    {lines.length === 0 && <tr><td colSpan={5} className="table-empty-cell">No return lines.</td></tr>}
                    {lines.map((line, idx) => (
                        <tr key={`${line.lineKey || idx}`}><td>{line.description}</td><td className="text-right">{line.qtyReturn}</td><td>{line.unit}</td><td className="text-right">{formatIDR(line.price)}</td><td className="text-right">{formatIDR(Number(line.qtyReturn || 0) * Number(line.price || 0))}</td></tr>
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

    if (type === 'debit') {
        if (!debit) return <div className="p-6 text-sm text-neutral-500">Debit note not found.</div>;
        return (
            <div className="container ap-module container-full-width">
                <div className="invoice-workbench-card dense-mode">
                    <div className="dense-topbar">
                        <div className="detail-header-title"><h2 className="detail-header-h2">{debit.id}</h2><StatusTag status={debit.status === 'Applied' ? 'Success' : 'Info'} label={debit.status} /></div>
                        <div className="detail-header-actions">
                            {debit.status === 'Applied' && <Button text="Void" size="small" variant="secondary" disabled={!canEdit || voidDebitNote.isPending} onClick={handleVoidDebit} />}
                            <Button text="Print" size="small" variant="secondary" onClick={printDebit} />
                            <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={editDebit} />
                        </div>
                    </div>
                    <div className="dense-header-grid">
                        <div className="dense-field"><label>Vendor</label><div>{debit.vendorName}</div></div>
                        <div className="dense-field"><label>Date</label><div>{formatDateID(debit.date)}</div></div>
                        <div className="dense-field"><label>Source Bill</label><div>{debit.sourceBillId}</div></div>
                        <div className="dense-field"><label>Settlement</label><div>{debit.settlementType}</div></div>
                        <div className="dense-amount">{formatIDR(debit.amount)}</div>
                    </div>
                    <div className="dense-body">
                        <div className="dense-main">
                            <Tabs />
                            <div className="detail-tab-content dense-content">
                                {detailTab === 'summary' && (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Debit #</label><strong>{debit.id}</strong></div>
                                        <div className="detail-field"><label>Status</label><StatusTag status={debit.status === 'Applied' ? 'Success' : 'Info'} label={debit.status} /></div>
                                        <div className="detail-field"><label>Purchase Return</label><div>{debit.returnId}</div></div>
                                        <div className="detail-field"><label>Source Bill</label><div>{debit.sourceBillId}</div></div>
                                        <div className="detail-field"><label>Settlement Ref</label><div>{debit.settlementRef || '-'}</div></div>
                                        <div className="detail-field"><label>Amount</label><strong>{formatIDR(debit.amount)}</strong></div>
                                    </div>
                                )}
                                {detailTab === 'items' && <ItemsTable lines={debitLines} />}
                                {detailTab === 'logistics' && (
                                    <div className="detail-grid">
                                        <div className="detail-field"><label>Settlement Type</label><strong>{debit.settlementType}</strong></div>
                                        <div className="detail-field"><label>Settlement Ref</label><div>{debit.settlementRef || '-'}</div></div>
                                        <div className="detail-field"><label>Source Bill</label><div>{debit.sourceBillId}</div></div>
                                        <div className="detail-field"><label>Purchase Return</label><div>{debit.returnId}</div></div>
                                    </div>
                                )}
                                {detailTab === 'attachments' && <div className="attachment-empty">No attachments.</div>}
                                {detailTab === 'audit' && <ul className="audit-list"><li><div><strong>Debit note created</strong></div><div>{formatDateID(debit.date)} • System</div></li><li><div><strong>Linked to purchase return {debit.returnId}</strong></div><div>{formatDateID(debit.date)} • Auto process</div></li></ul>}
                            </div>
                        </div>
                        <SideActions />
                    </div>
                </div>
                {printModal}
            </div>
        );
    }

    if (!ret) return <div className="p-6 text-sm text-neutral-500">Purchase return not found.</div>;
    const returnLines = (ret.lines as ReturnLine[] | undefined) || [];
    return (
        <div className="container ap-module container-full-width">
            <div className="invoice-workbench-card dense-mode">
                <div className="dense-topbar">
                    <div className="detail-header-title"><h2 className="detail-header-h2">{ret.id}</h2><StatusTag status={ret.status === 'Approved' ? 'Success' : 'Warning'} label={ret.status} /></div>
                    <div className="detail-header-actions">
                        {ret.status === 'Approved' && <Button text="Void" size="small" variant="secondary" disabled={!canEdit || voidPurchaseReturn.isPending} onClick={handleVoidReturn} />}
                        <Button text="Print" size="small" variant="secondary" onClick={printReturn} />
                        <Button text="Edit" size="small" variant="primary" disabled={!canEdit} onClick={editReturn} />
                    </div>
                </div>
                <div className="dense-header-grid">
                    <div className="dense-field"><label>Vendor</label><div>{ret.vendorName}</div></div>
                    <div className="dense-field"><label>Return Date</label><div>{formatDateID(ret.returnDate)}</div></div>
                    <div className="dense-field"><label>Source Bill</label><div>{ret.billId}</div></div>
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
                                    <div className="detail-field"><label>Vendor</label><div>{ret.vendorName}</div></div>
                                    <div className="detail-field"><label>Source Bill</label><div>{ret.billId}</div></div>
                                </div>
                            )}
                            {detailTab === 'items' && <ItemsTable lines={returnLines} />}
                            {detailTab === 'logistics' && (
                                <div className="detail-grid">
                                    <div className="detail-field"><label>Warehouse</label><strong>{(warehouses as Array<{ id: string; name: string }>).find((w) => w.id === ret.warehouseId)?.name || '-'}</strong></div>
                                    <div className="detail-field"><label>Source Bill</label><strong>{ret.billId}</strong></div>
                                    <div className="detail-field"><label>Apply Tax</label><div>{ret.applyTax ? 'Yes' : 'No'}</div></div>
                                    <div className="detail-field"><label>Total Includes Tax</label><div>{ret.taxIncluded ? 'Yes' : 'No'}</div></div>
                                    <div className="detail-field"><label>Tax Rate</label><div>{ret.taxRate || 0}%</div></div>
                                    <div className="detail-field"><label>Total</label><strong>{formatIDR(getReturnTotal(ret as unknown as Record<string, unknown>))}</strong></div>
                                </div>
                            )}
                            {detailTab === 'attachments' && <div className="attachment-empty">No attachments.</div>}
                            {detailTab === 'audit' && <ul className="audit-list"><li><div><strong>Purchase return created</strong></div><div>{formatDateID(ret.returnDate)} • System</div></li><li><div><strong>Status updated to {ret.status}</strong></div><div>{formatDateID(ret.returnDate)} • AP User</div></li></ul>}
                        </div>
                    </div>
                    <SideActions />
                </div>
            </div>
            {printModal}
        </div>
    );
};

export default APDebitNoteDetailPane;

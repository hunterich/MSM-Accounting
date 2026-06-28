// src/components/banking/BankingDetailPane.tsx
// Workspace-native bank-transaction detail (one tab per transaction).
import React, { useMemo, useState } from 'react';
import { FileText, Paperclip, MoreHorizontal, Trash2 } from 'lucide-react';
import Button from '../UI/Button';
import StatusTag from '../UI/StatusTag';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { useBankAccounts, useBankTransactions, useDeleteBankTransaction } from '../../hooks/useBanking';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import type { BankAccount, BankTransaction } from '../../types';

const TXN_TYPE_LABELS: Record<string, string> = { transfer: 'Transfer', expense: 'Payment', income: 'Receive' };

interface Props { txnId: string; workspaceTabId: string }

const BankingDetailPane = ({ txnId, workspaceTabId }: Props): React.ReactElement => {
    const { canCreate, canDelete } = useModulePermissions('banking');
    const { open } = useWorkspaceNav();
    const closeTab = useWorkspaceStore((s) => s.closeTab);
    const { data: txnResult } = useBankTransactions({});
    const { data: accounts = [] } = useBankAccounts();
    const deleteTransaction = useDeleteBankTransaction();
    const [detailTab, setDetailTab] = useState('summary');

    const allTransactions = (txnResult?.data ?? []) as BankTransaction[];
    const txn = useMemo(() => allTransactions.find((t) => t.id === txnId) ?? null, [allTransactions, txnId]);
    const account = txn ? (accounts as BankAccount[]).find((a) => a.id === txn.accountId) ?? null : null;

    if (!txn) return <div className="p-6 text-sm text-neutral-500">Transaction not found.</div>;

    const openMatch = () => open({ kind: 'doc-form', target: { module: 'banking', entity: 'transaction', recordId: `edit:${txn.type}:${txn.id}`, mode: 'edit' }, title: `Match ${txn.reference || txn.id}`, path: `/banking/${txn.type === 'expense' ? 'payment' : txn.type === 'income' ? 'receive' : 'transfer'}?txnId=${txn.id}` });
    const handleDelete = async () => {
        if (!window.confirm(`Delete transaction "${txn.description}"? This cannot be undone.`)) return;
        try { await deleteTransaction.mutateAsync(txn.id); closeTab(workspaceTabId); }
        catch (err) { window.alert((err as Error)?.message ?? 'Delete failed.'); }
    };

    return (
        <div className="container banking-module container-full-width">
            <div className="invoice-workbench-card dense-mode">
                <div className="dense-topbar">
                    <div className="detail-header-title"><h2 className="detail-header-h2">{txn.reference || txn.id}</h2><StatusTag status={txn.status === 'Matched' ? 'Success' : 'Warning'} label={txn.status} /></div>
                    <div className="detail-header-actions">{txn.status === 'Unmatched' && <Button text="Match" size="small" variant="primary" disabled={!canCreate} onClick={openMatch} />}</div>
                </div>
                <div className="dense-header-grid">
                    <div className="dense-field"><label>Account</label><div>{account?.name || '-'}</div></div>
                    <div className="dense-field"><label>Date</label><div>{formatDateID(txn.date)}</div></div>
                    <div className="dense-field"><label>Type</label><div>{TXN_TYPE_LABELS[txn.type] || txn.type}</div></div>
                    <div className="dense-field"><label>Reference</label><div>{txn.reference || '-'}</div></div>
                    <div className="dense-amount"><span className={txn.amount > 0 ? 'banking-amount-positive' : 'banking-amount-negative'}>{txn.amount > 0 ? '+' : ''}{formatIDR(txn.amount)}</span></div>
                </div>
                <div className="dense-body">
                    <div className="dense-main">
                        <div className="detail-tabs dense-tabs">
                            <button className={`detail-tab ${detailTab === 'summary' ? 'active' : ''}`} onClick={() => setDetailTab('summary')}>Summary</button>
                            <button className={`detail-tab ${detailTab === 'audit' ? 'active' : ''}`} onClick={() => setDetailTab('audit')}>Audit / Journal</button>
                        </div>
                        <div className="detail-tab-content dense-content">
                            {detailTab === 'summary' && (
                                <div className="detail-grid">
                                    <div className="detail-field"><label>Transaction #</label><strong>{txn.id}</strong></div>
                                    <div className="detail-field"><label>Status</label><StatusTag status={txn.status === 'Matched' ? 'Success' : 'Warning'} label={txn.status} /></div>
                                    <div className="detail-field"><label>Description</label><div>{txn.description}</div></div>
                                    <div className="detail-field"><label>Account</label><div>{account?.name || '-'}</div></div>
                                    <div className="detail-field"><label>Type</label><div>{TXN_TYPE_LABELS[txn.type] || txn.type}</div></div>
                                    <div className="detail-field"><label>Date</label><div>{formatDateID(txn.date)}</div></div>
                                    {txn.payee && <div className="detail-field"><label>Payee</label><div>{txn.payee}</div></div>}
                                    {txn.receivedFrom && <div className="detail-field"><label>Received From</label><div>{txn.receivedFrom}</div></div>}
                                    {txn.costCenter && <div className="detail-field"><label>Cost Center</label><div>{txn.costCenter}</div></div>}
                                    {txn.taxType !== 'none' && <div className="detail-field"><label>Tax</label><div>{txn.taxType.toUpperCase()} ({txn.taxRate}%)</div></div>}
                                    {txn.notes && <div className="detail-field"><label>Notes</label><div>{txn.notes}</div></div>}
                                    <div className="detail-field"><label>Amount</label><strong>{formatIDR(txn.amount)}</strong></div>
                                </div>
                            )}
                            {detailTab === 'audit' && (
                                <ul className="audit-list">
                                    <li><div><strong>Transaction recorded ({TXN_TYPE_LABELS[txn.type] || txn.type})</strong></div><div>{formatDateID(txn.date)} • System</div></li>
                                    {txn.status === 'Matched' && <li><div><strong>Matched against bank statement</strong></div><div>{formatDateID(txn.date)} • Reconciliation</div></li>}
                                </ul>
                            )}
                        </div>
                    </div>
                    <div className="dense-side-actions">
                        <button className="dense-side-btn" title="Details"><FileText size={18} /></button>
                        <button className="dense-side-btn" title="Attachment"><Paperclip size={18} /></button>
                        <button className="dense-side-btn success" title="More"><MoreHorizontal size={18} /></button>
                        <button className={`dense-side-btn danger ${canDelete ? '' : 'opacity-60 cursor-not-allowed'}`} title="Delete" disabled={!canDelete || deleteTransaction.isPending} onClick={handleDelete}><Trash2 size={18} /></button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BankingDetailPane;

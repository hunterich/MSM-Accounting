import React, { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import DocumentTabBar from '../../components/UI/DocumentTabBar';
import PageHeader from '../../components/Layout/PageHeader';
import { Plus, ArrowRightLeft, TrendingDown, TrendingUp, Search, Download, FileText, Paperclip, MoreHorizontal, Trash2 } from 'lucide-react';
import { exportToCsv } from '../../utils/exportCsv';
import { useBankAccounts, useBankTransactions, useDeleteBankTransaction } from '../../hooks/useBanking';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { useDocumentTabs } from '../../hooks/useDocumentTabs';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { SkeletonBlock } from '../../components/UI/LoadingSkeleton';
import type { BankAccount, BankTransaction } from '../../types';

interface DateRange {
    from: string;
    to: string;
}

const TXN_TYPE_LABELS: Record<string, string> = {
    transfer: 'Transfer',
    expense: 'Expense',
    income: 'Income',
};

const Banking = () => {
    const navigate = useNavigate();
    const { canCreate, canDelete } = useModulePermissions('banking');

    const { data: accounts = [], isLoading: accountsLoading } = useBankAccounts();
    const [selectedAccountId, setSelectedAccountId] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [dateRange, setDateRange] = useState<DateRange>({ from: '', to: '' });
    const [detailTab, setDetailTab] = useState<string>('summary');

    const deleteTransaction = useDeleteBankTransaction();

    // Tab state managed by useDocumentTabs
    const { selectedId: selectedTxnId, openIds: openTxnIds, openTab: openTxnTab, closeTab: closeTxnTab, selectNone, tabRows } = useDocumentTabs({ urlParam: 'txnId' });

    // Fetch transactions — filter by account when one is selected
    const txnFilters = useMemo(() => ({
        ...(selectedAccountId ? { bankAccountId: selectedAccountId } : {}),
    }), [selectedAccountId]);
    const { data: txnResult, isLoading: txnsLoading } = useBankTransactions(txnFilters);
    const allTransactions = (txnResult?.data ?? []) as BankTransaction[];
    const bankAccounts = accounts as BankAccount[];

    const selectedAccount = useMemo(
        () => bankAccounts.find((a) => a.id === selectedAccountId) || null,
        [bankAccounts, selectedAccountId]
    );

    const totalBalance = useMemo(
        () => bankAccounts.reduce((sum, a) => sum + (a.balance || 0), 0),
        [bankAccounts]
    );

    const filteredTransactions = useMemo(() => {
        const keyword = searchTerm.toLowerCase();
        return allTransactions.filter((txn) => {
            const matchesSearch = txn.description.toLowerCase().includes(keyword)
                || txn.id.toLowerCase().includes(keyword)
                || (txn.reference || '').toLowerCase().includes(keyword);
            const matchesStatus = statusFilter ? txn.status === statusFilter : true;
            let matchesDate = true;
            if (dateRange.from) matchesDate = matchesDate && new Date(txn.date) >= new Date(dateRange.from);
            if (dateRange.to) matchesDate = matchesDate && new Date(txn.date) <= new Date(dateRange.to);
            return matchesSearch && matchesStatus && matchesDate;
        });
    }, [allTransactions, searchTerm, statusFilter, dateRange]);

    const unmatchedCount = useMemo(
        () => filteredTransactions.filter((t) => t.status === 'Unmatched').length,
        [filteredTransactions]
    );

    const openTransactionForm = (txn: BankTransaction) => {
        const targetPathByType: Record<string, string> = {
            transfer: '/banking/transfer',
            expense: '/banking/expense',
            income: '/banking/income'
        };
        navigate(targetPathByType[txn.type] || '/banking/account', {
            state: {
                mode: 'edit',
                sourceTxnId: txn.id,
                transaction: txn
            }
        });
    };

    const transactionColumns = useMemo(() => ([
        { key: 'date', label: 'Date', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'description', label: 'Description' },
        { key: 'type', label: 'Type', render: (val: unknown) => TXN_TYPE_LABELS[val as string] || (val as string) },
        {
            key: 'amount',
            label: 'Amount',
            align: 'right' as const,
            render: (val: unknown) => {
                const v = val as number;
                return (
                    <span className={v > 0 ? 'banking-amount-positive' : 'banking-amount-negative'}>
                        {v > 0 ? '+' : ''}{formatIDR(v)}
                    </span>
                );
            },
        },
        {
            key: 'status',
            label: 'Status',
            render: (val: unknown) => <StatusTag status={(val as string) === 'Matched' ? 'Success' : 'Warning'} label={val as string} />,
        },
        {
            key: 'actions',
            label: '',
            render: (_: unknown, row: Record<string, unknown>) => (
                <div className="row-actions-end">
                    <Button text="View" size="small" variant="tertiary" onClick={(event: React.MouseEvent) => { event.stopPropagation(); openTxnTab(row['id'] as string); }} />
                    {(row['status'] as string) === 'Unmatched' && (
                        <Button text="Match" size="small" variant="secondary" disabled={!canCreate} onClick={(event: React.MouseEvent) => { event.stopPropagation(); openTransactionForm(row as unknown as BankTransaction); }} />
                    )}
                </div>
            ),
        },
    ]), [canCreate, navigate, openTxnTab]);

    const selectedTxn = allTransactions.find((txn) => txn.id === selectedTxnId) || null;
    const selectedTxnAccount = selectedTxn
        ? bankAccounts.find((a) => a.id === selectedTxn.accountId) || null
        : null;

    const handleExportCsv = () => {
        const rows = filteredTransactions.map((txn) => ({
            date: txn.date,
            description: txn.description,
            amount: txn.amount,
            status: txn.status,
            type: txn.type,
        }));
        exportToCsv('banking-transactions.csv', rows, [
            { label: 'Date', key: 'date' },
            { label: 'Description', key: 'description' },
            { label: 'Amount', key: 'amount' },
            { label: 'Status', key: 'status' },
            { label: 'Type', key: 'type' },
        ]);
    };

    const handleDeleteTxn = async (txn: BankTransaction) => {
        if (!window.confirm(`Delete transaction "${txn.description}"? This cannot be undone.`)) return;
        try {
            await deleteTransaction.mutateAsync(txn.id);
            closeTxnTab(txn.id);
        } catch (err) {
            window.alert((err as Error)?.message ?? 'Delete failed.');
        }
    };

    return (
        <div className="container banking-module container-full-width">
            <PageHeader
                title="Banking & Reconciliation"
                subtitle="Manage bank accounts, transactions, and reconciliation."
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
                openIds={openTxnIds}
                selectedId={selectedTxnId}
                tabRows={tabRows}
                getLabel={(id) => {
                    const txn = allTransactions.find((t) => t.id === id);
                    return txn ? (txn.reference || txn.id) : id;
                }}
                onSelect={openTxnTab}
                onClose={closeTxnTab}
                newTabLabel="New Transaction"
                newTabMenu={[
                    { label: 'Transfer', icon: <ArrowRightLeft size={14} />, onSelect: () => navigate('/banking/transfer') },
                    { label: 'Expense', icon: <TrendingDown size={14} />, onSelect: () => navigate('/banking/expense') },
                    { label: 'Income', icon: <TrendingUp size={14} />, onSelect: () => navigate('/banking/income') },
                ]}
                disableNew={!canCreate}
                onCatalog={() => {
                    setSearchTerm('');
                    setStatusFilter('');
                    setDateRange({ from: '', to: '' });
                    selectNone();
                }}
                firstRowSuffix={
                    <div className="workbench-tab-count">Open tabs: {openTxnIds.length}</div>
                }
            />

            {!selectedTxn && (
                <>
                    {/* Account Summary Cards */}
                    <div className="grid-12 banking-accounts-grid">
                        {accountsLoading ? (
                            <div className="col-span-12">
                                <div className="text-sm text-neutral-500 mb-3">Loading accounts...</div>
                                <div className="grid grid-cols-4 gap-4">
                                    {Array.from({ length: 4 }).map((_, index) => (
                                        <Card key={`account-skeleton-${index}`} padding>
                                            <div className="space-y-3">
                                                <SkeletonBlock className="h-4 w-28" />
                                                <SkeletonBlock className="h-8 w-36" />
                                                <SkeletonBlock className="h-4 w-24" />
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* All Accounts summary card */}
                                <div className="col-span-3">
                                    <Card padding>
                                        <button
                                            className={`banking-account-selector ${!selectedAccountId ? 'is-active' : ''}`}
                                            onClick={() => setSelectedAccountId('')}
                                        >
                                            <div className="banking-account-label">All Accounts</div>
                                            <div className="banking-account-balance">{formatIDR(totalBalance)}</div>
                                            <div className="banking-account-meta">{bankAccounts.length} accounts</div>
                                        </button>
                                    </Card>
                                </div>

                                {bankAccounts.map((acc) => (
                                    <div key={acc.id} className="col-span-3">
                                        <Card padding>
                                            <button
                                                className={`banking-account-selector ${selectedAccountId === acc.id ? 'is-active' : ''}`}
                                                onClick={() => setSelectedAccountId(acc.id)}
                                            >
                                                <div className="banking-account-label">{acc.name}</div>
                                                <div className="banking-account-balance">{formatIDR(acc.balance)}</div>
                                                <div className="banking-account-meta">
                                                    {acc.code ? `Code: ${acc.code}` : 'Cash / Other'}
                                                </div>
                                            </button>
                                        </Card>
                                    </div>
                                ))}

                                {/* Add Account ghost card */}
                                <div className="col-span-3">
                                    <button
                                        className={`w-full h-full min-h-[120px] rounded-lg border-2 border-dashed border-neutral-300 bg-transparent flex flex-col items-center justify-center gap-1.5 text-neutral-500 transition-colors ${canCreate ? 'cursor-pointer hover:border-primary-400 hover:text-primary-600' : 'opacity-60 cursor-not-allowed'}`}
                                        disabled={!canCreate}
                                        onClick={() => navigate('/banking/account')}
                                    >
                                        <Plus size={20} />
                                        <span className="text-sm font-medium">Add Account</span>
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Reconciliation Status Banner */}
                    {unmatchedCount > 0 && (
                        <div className="banking-reconcile-banner">
                            <strong>{unmatchedCount} unmatched transaction{unmatchedCount > 1 ? 's' : ''}</strong>
                            {' '}need to be reviewed
                            {selectedAccount ? ` in ${selectedAccount.name}` : ''}.{' '}
                            <Link to="/banking/reconciliation" className="font-semibold text-warning-900 underline">
                                Review in Reconciliation →
                            </Link>
                        </div>
                    )}

                    {/* Filters */}
                    <div className="payments-filter-card">
                        <div className="payments-filter-search">
                            <Search size={18} />
                            <input
                                type="text"
                                className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                placeholder="Search description or reference..."
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
                                <option value="">Filter by Status</option>
                                <option value="Matched">Matched</option>
                                <option value="Unmatched">Unmatched</option>
                            </select>
                        </div>
                        <div className="payments-filter-field">
                            <input
                                type="date"
                                className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                value={dateRange.from}
                                onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                            />
                        </div>
                        <div className="payments-filter-field">
                            <input
                                type="date"
                                className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                value={dateRange.to}
                                onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                            />
                        </div>
                        {(dateRange.from || dateRange.to) && (
                            <Button
                                text="Clear"
                                variant="tertiary"
                                size="small"
                                className="payments-filter-clear"
                                onClick={() => setDateRange({ from: '', to: '' })}
                            />
                        )}
                    </div>

                    {/* Transaction Feed */}
                    <Card padding={false}>
                        <Table
                            columns={transactionColumns as TableColumn<Record<string, unknown>>[]}
                            data={filteredTransactions as unknown as Record<string, unknown>[]}
                            onRowClick={(row) => openTxnTab(row['id'] as string)}
                            showCount
                            countLabel="transactions"
                            isLoading={txnsLoading}
                            loadingLabel="Loading transactions..."
                        />
                    </Card>
                </>
            )}

            {selectedTxn && (
                <div className="invoice-workbench-card dense-mode">
                    <div className="dense-topbar">
                        <div className="detail-header-title">
                            <h2 className="detail-header-h2">{selectedTxn.reference || selectedTxn.id}</h2>
                            <StatusTag status={selectedTxn.status === 'Matched' ? 'Success' : 'Warning'} label={selectedTxn.status} />
                        </div>
                        <div className="detail-header-actions">
                            {selectedTxn.status === 'Unmatched' && (
                                <Button text="Match" size="small" variant="primary" disabled={!canCreate} onClick={() => openTransactionForm(selectedTxn)} />
                            )}
                        </div>
                    </div>

                    <div className="dense-header-grid">
                        <div className="dense-field">
                            <label>Account</label>
                            <div>{selectedTxnAccount?.name || '-'}</div>
                        </div>
                        <div className="dense-field">
                            <label>Date</label>
                            <div>{formatDateID(selectedTxn.date)}</div>
                        </div>
                        <div className="dense-field">
                            <label>Type</label>
                            <div>{TXN_TYPE_LABELS[selectedTxn.type] || selectedTxn.type}</div>
                        </div>
                        <div className="dense-field">
                            <label>Reference</label>
                            <div>{selectedTxn.reference || '-'}</div>
                        </div>
                        <div className="dense-amount">
                            <span className={selectedTxn.amount > 0 ? 'banking-amount-positive' : 'banking-amount-negative'}>
                                {selectedTxn.amount > 0 ? '+' : ''}{formatIDR(selectedTxn.amount)}
                            </span>
                        </div>
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
                                        <div className="detail-field"><label>Transaction #</label><strong>{selectedTxn.id}</strong></div>
                                        <div className="detail-field"><label>Status</label><StatusTag status={selectedTxn.status === 'Matched' ? 'Success' : 'Warning'} label={selectedTxn.status} /></div>
                                        <div className="detail-field"><label>Description</label><div>{selectedTxn.description}</div></div>
                                        <div className="detail-field"><label>Account</label><div>{selectedTxnAccount?.name || '-'}</div></div>
                                        <div className="detail-field"><label>Type</label><div>{TXN_TYPE_LABELS[selectedTxn.type] || selectedTxn.type}</div></div>
                                        <div className="detail-field"><label>Date</label><div>{formatDateID(selectedTxn.date)}</div></div>
                                        {selectedTxn.payee && <div className="detail-field"><label>Payee</label><div>{selectedTxn.payee}</div></div>}
                                        {selectedTxn.receivedFrom && <div className="detail-field"><label>Received From</label><div>{selectedTxn.receivedFrom}</div></div>}
                                        {selectedTxn.costCenter && <div className="detail-field"><label>Cost Center</label><div>{selectedTxn.costCenter}</div></div>}
                                        {selectedTxn.taxType !== 'none' && (
                                            <div className="detail-field"><label>Tax</label><div>{selectedTxn.taxType.toUpperCase()} ({selectedTxn.taxRate}%)</div></div>
                                        )}
                                        {selectedTxn.notes && <div className="detail-field"><label>Notes</label><div>{selectedTxn.notes}</div></div>}
                                        <div className="detail-field"><label>Amount</label><strong>{formatIDR(selectedTxn.amount)}</strong></div>
                                    </div>
                                )}
                                {detailTab === 'audit' && (
                                    <ul className="audit-list">
                                        <li>
                                            <div><strong>Transaction recorded ({TXN_TYPE_LABELS[selectedTxn.type] || selectedTxn.type})</strong></div>
                                            <div>{formatDateID(selectedTxn.date)} • System</div>
                                        </li>
                                        {selectedTxn.status === 'Matched' && (
                                            <li>
                                                <div><strong>Matched against bank statement</strong></div>
                                                <div>{formatDateID(selectedTxn.date)} • Reconciliation</div>
                                            </li>
                                        )}
                                    </ul>
                                )}
                            </div>
                        </div>
                        <div className="dense-side-actions">
                            <button className="dense-side-btn" title="Details"><FileText size={18} /></button>
                            <button className="dense-side-btn" title="Attachment"><Paperclip size={18} /></button>
                            <button className="dense-side-btn success" title="More"><MoreHorizontal size={18} /></button>
                            <button
                                className={`dense-side-btn danger ${canDelete ? '' : 'opacity-60 cursor-not-allowed'}`}
                                title="Delete"
                                disabled={!canDelete || deleteTransaction.isPending}
                                onClick={() => handleDeleteTxn(selectedTxn)}
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Banking;

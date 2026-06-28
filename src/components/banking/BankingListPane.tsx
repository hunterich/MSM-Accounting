// src/components/banking/BankingListPane.tsx
// Workspace-native banking catalog (flag-off stays views/banking/Banking.tsx).
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ArrowRightLeft, TrendingDown, TrendingUp, Search, Download } from 'lucide-react';
import Card from '../UI/Card';
import Table, { TableColumn } from '../UI/Table';
import Button from '../UI/Button';
import StatusTag from '../UI/StatusTag';
import { SkeletonBlock } from '../UI/LoadingSkeleton';
import PageHeader from '../Layout/PageHeader';
import { exportToCsv } from '../../utils/exportCsv';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { useBankAccounts, useBankTransactions } from '../../hooks/useBanking';
import { useWorkspaceNav } from '../../hooks/useWorkspaceNav';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import type { BankAccount, BankTransaction } from '../../types';

const TXN_TYPE_LABELS: Record<string, string> = { transfer: 'Transfer', expense: 'Payment', income: 'Receive' };

const BankingListPane = (): React.ReactElement => {
    const { canCreate } = useModulePermissions('banking');
    const { open } = useWorkspaceNav();
    const { data: accounts = [], isLoading: accountsLoading } = useBankAccounts();
    const bankAccounts = accounts as BankAccount[];
    const [selectedAccountId, setSelectedAccountId] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: '', to: '' });

    const txnFilters = useMemo(() => (selectedAccountId ? { bankAccountId: selectedAccountId } : {}), [selectedAccountId]);
    const { data: txnResult, isLoading: txnsLoading } = useBankTransactions(txnFilters);
    const allTransactions = useMemo(() => (txnResult?.data ?? []) as BankTransaction[], [txnResult?.data]);

    const selectedAccount = useMemo(() => bankAccounts.find((a) => a.id === selectedAccountId) || null, [bankAccounts, selectedAccountId]);
    const totalBalance = useMemo(() => bankAccounts.reduce((s, a) => s + (a.balance || 0), 0), [bankAccounts]);

    const filteredTransactions = useMemo(() => {
        const kw = searchTerm.toLowerCase();
        return allTransactions.filter((txn) => {
            const matchesSearch = txn.description.toLowerCase().includes(kw) || txn.id.toLowerCase().includes(kw) || (txn.reference || '').toLowerCase().includes(kw);
            const matchesStatus = statusFilter ? txn.status === statusFilter : true;
            let matchesDate = true;
            if (dateRange.from) matchesDate = matchesDate && new Date(txn.date) >= new Date(dateRange.from);
            if (dateRange.to) matchesDate = matchesDate && new Date(txn.date) <= new Date(dateRange.to);
            return matchesSearch && matchesStatus && matchesDate;
        });
    }, [allTransactions, searchTerm, statusFilter, dateRange]);
    const unmatchedCount = useMemo(() => filteredTransactions.filter((t) => t.status === 'Unmatched').length, [filteredTransactions]);

    const openView = (id: string) => { const t = allTransactions.find((x) => x.id === id); open({ kind: 'doc-view', target: { module: 'banking', entity: 'transaction', recordId: id, mode: 'view' }, title: t ? (t.reference || t.id) : id, path: `/banking?txnId=${id}` }); };
    const openMatch = (txn: BankTransaction) => open({ kind: 'doc-form', target: { module: 'banking', entity: 'transaction', recordId: `edit:${txn.type}:${txn.id}`, mode: 'edit' }, title: `Match ${txn.reference || txn.id}`, path: `/banking/${txn.type === 'expense' ? 'payment' : txn.type === 'income' ? 'receive' : 'transfer'}?txnId=${txn.id}` });
    const openNew = (action: 'expense' | 'income' | 'transfer' | 'account', label: string, path: string) => open({ kind: 'doc-form', target: { module: 'banking', entity: 'transaction', recordId: `new:${action}`, mode: 'create' }, title: label, path, unique: true });

    const transactionColumns = useMemo(() => ([
        { key: 'date', label: 'Date', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'description', label: 'Description' },
        { key: 'type', label: 'Type', render: (val: unknown) => TXN_TYPE_LABELS[val as string] || (val as string) },
        { key: 'amount', label: 'Amount', align: 'right' as const, render: (val: unknown) => { const v = val as number; return <span className={v > 0 ? 'banking-amount-positive' : 'banking-amount-negative'}>{v > 0 ? '+' : ''}{formatIDR(v)}</span>; } },
        { key: 'status', label: 'Status', render: (val: unknown) => <StatusTag status={(val as string) === 'Matched' ? 'Success' : 'Warning'} label={val as string} /> },
        { key: 'actions', label: '', render: (_: unknown, row: Record<string, unknown>) => (
            <div className="row-actions-end">
                <Button text="View" size="small" variant="tertiary" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openView(row['id'] as string); }} />
                {(row['status'] as string) === 'Unmatched' && <Button text="Match" size="small" variant="secondary" disabled={!canCreate} onClick={(e: React.MouseEvent) => { e.stopPropagation(); openMatch(row as unknown as BankTransaction); }} />}
            </div>
        ) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ]), [canCreate, allTransactions]);

    const handleExportCsv = () => {
        const rows = filteredTransactions.map((txn) => ({ date: txn.date, description: txn.description, amount: txn.amount, status: txn.status, type: txn.type }));
        exportToCsv('banking-transactions.csv', rows, [
            { label: 'Date', key: 'date' }, { label: 'Description', key: 'description' }, { label: 'Amount', key: 'amount' },
            { label: 'Status', key: 'status' }, { label: 'Type', key: 'type' },
        ]);
    };

    return (
        <div className="container banking-module container-full-width">
            <PageHeader
                title="Banking & Reconciliation"
                subtitle="Manage bank accounts, transactions, and reconciliation."
                actions={
                    <div className="flex gap-2">
                        <Button text="Export CSV" size="small" variant="secondary" icon={<Download size={16} />} onClick={handleExportCsv} />
                        {canCreate && <>
                            <Button text="Payment" size="small" variant="secondary" icon={<TrendingDown size={15} />} onClick={() => openNew('expense', 'New payment', '/banking/payment')} />
                            <Button text="Receive" size="small" variant="secondary" icon={<TrendingUp size={15} />} onClick={() => openNew('income', 'New receipt', '/banking/receive')} />
                            <Button text="Transfer" size="small" icon={<ArrowRightLeft size={15} />} onClick={() => openNew('transfer', 'New transfer', '/banking/transfer')} />
                        </>}
                    </div>
                }
            />
            <div className="grid-12 banking-accounts-grid">
                {accountsLoading ? (
                    <div className="col-span-12">
                        <div className="text-sm text-neutral-500 mb-3">Loading accounts...</div>
                        <div className="grid grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Card key={i} padding><div className="space-y-3"><SkeletonBlock className="h-4 w-28" /><SkeletonBlock className="h-8 w-36" /><SkeletonBlock className="h-4 w-24" /></div></Card>)}</div>
                    </div>
                ) : (
                    <>
                        <div className="col-span-3"><Card padding>
                            <button className={`banking-account-selector ${!selectedAccountId ? 'is-active' : ''}`} onClick={() => setSelectedAccountId('')}>
                                <div className="banking-account-label">All Accounts</div>
                                <div className="banking-account-balance">{formatIDR(totalBalance)}</div>
                                <div className="banking-account-meta">{bankAccounts.length} accounts</div>
                            </button>
                        </Card></div>
                        {bankAccounts.map((acc) => (
                            <div key={acc.id} className="col-span-3"><Card padding>
                                <button className={`banking-account-selector ${selectedAccountId === acc.id ? 'is-active' : ''}`} onClick={() => setSelectedAccountId(acc.id)}>
                                    <div className="banking-account-label">{acc.name}</div>
                                    <div className="banking-account-balance">{formatIDR(acc.balance)}</div>
                                    <div className="banking-account-meta">{acc.code ? `Code: ${acc.code}` : 'Cash / Other'}</div>
                                </button>
                            </Card></div>
                        ))}
                        <div className="col-span-3">
                            <button className={`w-full h-full min-h-[120px] rounded-lg border-2 border-dashed border-neutral-300 bg-transparent flex flex-col items-center justify-center gap-1.5 text-neutral-500 transition-colors ${canCreate ? 'cursor-pointer hover:border-primary-400 hover:text-primary-600' : 'opacity-60 cursor-not-allowed'}`} disabled={!canCreate} onClick={() => openNew('account', 'Add account', '/banking/account')}>
                                <Plus size={20} /><span className="text-sm font-medium">Add Account</span>
                            </button>
                        </div>
                    </>
                )}
            </div>

            {unmatchedCount > 0 && (
                <div className="banking-reconcile-banner">
                    <strong>{unmatchedCount} unmatched transaction{unmatchedCount > 1 ? 's' : ''}</strong>{' '}need to be reviewed{selectedAccount ? ` in ${selectedAccount.name}` : ''}.{' '}
                    <Link to="/banking/reconciliation" className="font-semibold text-warning-900 underline">Review in Reconciliation →</Link>
                </div>
            )}

            <div className="payments-filter-card">
                <div className="payments-filter-search">
                    <Search size={18} />
                    <input type="text" className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0" placeholder="Search description or reference..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
                <div className="payments-filter-field">
                    <select className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                        <option value="">Filter by Status</option><option value="Matched">Matched</option><option value="Unmatched">Unmatched</option>
                    </select>
                </div>
                <div className="payments-filter-field"><input type="date" className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0" value={dateRange.from} onChange={(e) => setDateRange((p) => ({ ...p, from: e.target.value }))} /></div>
                <div className="payments-filter-field"><input type="date" className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0" value={dateRange.to} onChange={(e) => setDateRange((p) => ({ ...p, to: e.target.value }))} /></div>
                {(dateRange.from || dateRange.to) && <Button text="Clear" variant="tertiary" size="small" className="payments-filter-clear" onClick={() => setDateRange({ from: '', to: '' })} />}
            </div>

            <Card padding={false}>
                <Table
                    columns={transactionColumns as TableColumn<Record<string, unknown>>[]}
                    data={filteredTransactions as unknown as Record<string, unknown>[]}
                    onRowClick={(row) => openView(row['id'] as string)}
                    showCount countLabel="transactions" isLoading={txnsLoading} loadingLabel="Loading transactions..."
                />
            </Card>
        </div>
    );
};

export default BankingListPane;

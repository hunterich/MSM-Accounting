import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import { Plus, ArrowRightLeft, TrendingDown, TrendingUp, Search } from 'lucide-react';
import { useBankAccounts, useBankTransactions } from '../../hooks/useBanking';
import { formatDateID, formatIDR } from '../../utils/formatters';
import ListPage from '../../components/Layout/ListPage';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { SkeletonBlock } from '../../components/UI/LoadingSkeleton';

interface BankTransaction {
    id: string;
    date: string;
    description: string;
    amount: number;
    status: string;
    type: string;
}

interface BankAccount {
    id: string;
    name: string;
    balance: number;
    code?: string;
}

const Banking = () => {
    const navigate = useNavigate();
    const { canCreate } = useModulePermissions('banking');

    const { data: accounts = [], isLoading: accountsLoading } = useBankAccounts();
    const [selectedAccountId, setSelectedAccountId] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [statusFilter, setStatusFilter] = useState<string>('');

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
                || txn.id.toLowerCase().includes(keyword);
            const matchesStatus = statusFilter ? txn.status === statusFilter : true;
            return matchesSearch && matchesStatus;
        });
    }, [allTransactions, searchTerm, statusFilter]);

    const unmatchedCount = useMemo(
        () => filteredTransactions.filter((t) => t.status === 'Unmatched').length,
        [filteredTransactions]
    );

    const openTransactionAction = (txn: BankTransaction, mode = 'edit') => {
        const targetPathByType: Record<string, string> = {
            transfer: '/banking/transfer',
            expense: '/banking/expense',
            income: '/banking/income'
        };
        navigate(targetPathByType[txn.type] || '/banking/account', {
            state: {
                mode,
                sourceTxnId: txn.id,
                transaction: txn
            }
        });
    };

    const transactionColumns = useMemo(() => ([
        { key: 'date', label: 'Date', sortable: true, render: (val: unknown) => formatDateID(val as string) },
        { key: 'description', label: 'Description' },
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
                (row['status'] as string) === 'Unmatched'
                    ? <Button text="Match" size="small" variant="secondary" disabled={!canCreate} onClick={(event: React.MouseEvent) => { event.stopPropagation(); openTransactionAction(row as unknown as BankTransaction, 'edit'); }} />
                    : <Button text="View" size="small" variant="tertiary" disabled={!canCreate} onClick={(event: React.MouseEvent) => { event.stopPropagation(); openTransactionAction(row as unknown as BankTransaction, 'edit'); }} />
            ),
        },
    ]), [canCreate, navigate]);

    return (
        <ListPage
            containerClassName="banking-module"
            title="Banking & Reconciliation"
            subtitle="Manage bank accounts, transactions, and reconciliation."
            actions={
                <div className="page-header-actions">
                    <Button
                        text="Transfer"
                        variant="tertiary"
                        icon={<ArrowRightLeft size={16} />}
                        disabled={!canCreate}
                        onClick={() => navigate('/banking/transfer')}
                    />
                    <Button
                        text="Expense"
                        variant="tertiary"
                        icon={<TrendingDown size={16} />}
                        disabled={!canCreate}
                        onClick={() => navigate('/banking/expense')}
                    />
                    <Button
                        text="Income"
                        variant="tertiary"
                        icon={<TrendingUp size={16} />}
                        disabled={!canCreate}
                        onClick={() => navigate('/banking/income')}
                    />
                    <Button
                        text="Add Account"
                        variant="primary"
                        icon={<Plus size={16} />}
                        disabled={!canCreate}
                        onClick={() => navigate('/banking/account')}
                    />
                </div>
            }
        >
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
                    </>
                )}
            </div>

            {/* Reconciliation Status Banner */}
            {unmatchedCount > 0 && (
                <div className="banking-reconcile-banner">
                    <strong>{unmatchedCount} unmatched transaction{unmatchedCount > 1 ? 's' : ''}</strong>
                    {' '}need to be reviewed
                    {selectedAccount ? ` in ${selectedAccount.name}` : ''}.
                </div>
            )}

            {/* Transaction Feed */}
            <Card
                title={selectedAccount ? `Transactions — ${selectedAccount.name}` : 'All Transactions'}
                padding={false}
            >
                {/* Search bar inside the card header area */}
                <div className="filter-bar filter-bar--search-only">
                    <div className="filter-bar__search">
                        <Search size={16} />
                        <input
                            type="text"
                            className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                            placeholder="Search transactions..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="filter-bar__field">
                        <select
                            className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="">All Statuses</option>
                            <option value="Matched">Matched</option>
                            <option value="Unmatched">Unmatched</option>
                        </select>
                    </div>
                </div>

                <Table
                    columns={transactionColumns as TableColumn<Record<string, unknown>>[]}
                    data={filteredTransactions as unknown as Record<string, unknown>[]}
                    onRowClick={canCreate ? (row) => openTransactionAction(row as unknown as BankTransaction, 'edit') : undefined}
                    isLoading={txnsLoading}
                    loadingLabel="Loading transactions..."
                />
            </Card>
        </ListPage>
    );
};

export default Banking;

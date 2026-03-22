import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import { Plus, ArrowRightLeft, TrendingDown, TrendingUp, Search, Loader } from 'lucide-react';
import { useBankAccounts, useBankTransactions } from '../../hooks/useBanking';
import { formatDateID, formatIDR } from '../../utils/formatters';
import ListPage from '../../components/Layout/ListPage';



const Banking = () => {
    const navigate = useNavigate();

    const { data: accounts = [], isLoading: accountsLoading } = useBankAccounts();
    const [selectedAccountId, setSelectedAccountId] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    // Fetch transactions — filter by account when one is selected
    const txnFilters = useMemo(() => ({
        ...(selectedAccountId ? { bankAccountId: selectedAccountId } : {}),
    }), [selectedAccountId]);
    const { data: txnResult, isLoading: txnsLoading } = useBankTransactions(txnFilters);
    const allTransactions = txnResult?.data ?? [];

    const selectedAccount = useMemo(
        () => accounts.find((a) => a.id === selectedAccountId) || null,
        [accounts, selectedAccountId]
    );

    const totalBalance = useMemo(
        () => accounts.reduce((sum, a) => sum + (a.balance || 0), 0),
        [accounts]
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

    const openTransactionAction = (txn, mode = 'edit') => {
        const targetPathByType = {
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
        { key: 'date', label: 'Date', sortable: true, render: (val) => formatDateID(val) },
        { key: 'description', label: 'Description' },
        {
            key: 'amount',
            label: 'Amount',
            align: 'right',
            render: (val) => (
                <span className={val > 0 ? 'banking-amount-positive' : 'banking-amount-negative'}>
                    {val > 0 ? '+' : ''}{formatIDR(val)}
                </span>
            ),
        },
        {
            key: 'status',
            label: 'Status',
            render: (val) => <StatusTag status={val === 'Matched' ? 'Success' : 'Warning'} label={val} />,
        },
        {
            key: 'actions',
            label: '',
            render: (_, row) => (
                row.status === 'Unmatched'
                    ? <Button text="Match" size="small" variant="secondary" onClick={(event) => { event.stopPropagation(); openTransactionAction(row, 'edit'); }} />
                    : <Button text="View" size="small" variant="tertiary" onClick={(event) => { event.stopPropagation(); openTransactionAction(row, 'edit'); }} />
            ),
        },
    ]), [navigate]);

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
                        onClick={() => navigate('/banking/transfer')}
                    />
                    <Button
                        text="Expense"
                        variant="tertiary"
                        icon={<TrendingDown size={16} />}
                        onClick={() => navigate('/banking/expense')}
                    />
                    <Button
                        text="Income"
                        variant="tertiary"
                        icon={<TrendingUp size={16} />}
                        onClick={() => navigate('/banking/income')}
                    />
                    <Button
                        text="Add Account"
                        variant="primary"
                        icon={<Plus size={16} />}
                        onClick={() => navigate('/banking/account')}
                    />
                </div>
            }
        >
            {/* Account Summary Cards */}
            <div className="grid-12 banking-accounts-grid">
                {accountsLoading ? (
                    <div className="col-span-12 flex items-center gap-2 py-4 text-sm text-neutral-400">
                        <Loader size={16} className="animate-spin" /> Loading accounts...
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
                                    <div className="banking-account-meta">{accounts.length} accounts</div>
                                </button>
                            </Card>
                        </div>

                        {accounts.map((acc) => (
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

                {txnsLoading ? (
                    <div className="flex items-center gap-2 py-8 px-4 text-sm text-neutral-400">
                        <Loader size={16} className="animate-spin" /> Loading transactions...
                    </div>
                ) : (
                    <Table
                        columns={transactionColumns}
                        data={filteredTransactions}
                        onRowClick={(row) => openTransactionAction(row, 'edit')}
                    />
                )}
            </Card>
        </ListPage>
    );
};

export default Banking;

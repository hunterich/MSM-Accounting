import React, { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import Modal from '../../components/UI/Modal';
import { Plus, ArrowRightLeft, TrendingDown, TrendingUp, Search, Upload, Zap, Download } from 'lucide-react';
import { exportToCsv } from '../../utils/exportCsv';
import {
    useBankAccounts, useBankTransactions,
    useBankStatements, useImportBankStatement, useAutoMatch, useManualMatch,
    BankStatement, BankStatementLine,
} from '../../hooks/useBanking';
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

    // ── Import statement state ────────────────────────────────────────────────
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [importAccountId, setImportAccountId] = useState('');
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importError, setImportError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // The "active" statement whose lines we show in the matching table
    const [activeStatementId, setActiveStatementId] = useState('');
    // Pending manual match: statementLineId → txId selection
    const [matchingLineId, setMatchingLineId] = useState('');
    const [matchTxnId, setMatchTxnId] = useState('');

    const statementsForAccount = selectedAccountId || undefined;
    const { data: statements = [] } = useBankStatements(statementsForAccount);
    const activeStatement = (statements as BankStatement[]).find((s) => s.id === activeStatementId) || null;

    const importStatement = useImportBankStatement();
    const autoMatch = useAutoMatch(activeStatementId);
    const manualMatch = useManualMatch();

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
                    <button
                        className="btn btn-secondary flex items-center gap-1"
                        title="Export CSV"
                        onClick={() => {
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
                        }}
                    >
                        <Download size={16} />
                        <span className="hidden sm:inline">Export</span>
                    </button>
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

            {/* ── Import Bank Statement section ─────────────────────────────── */}
            <Card
                title="Bank Statement Import"
                padding
            >
                <div className="flex items-center gap-3 mb-4">
                    <Button
                        text="Import Bank Statement"
                        variant="secondary"
                        icon={<Upload size={16} />}
                        disabled={!canCreate}
                        onClick={() => setImportModalOpen(true)}
                    />
                    {(statements as BankStatement[]).length > 0 && (
                        <div className="flex items-center gap-2">
                            <select
                                className="h-9 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                value={activeStatementId}
                                onChange={(e) => setActiveStatementId(e.target.value)}
                            >
                                <option value="">Select imported statement</option>
                                {(statements as BankStatement[]).map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.fileName || s.id} {s.importedAt ? `(${formatDateID(s.importedAt.slice(0, 10))})` : ''}
                                    </option>
                                ))}
                            </select>
                            {activeStatementId && (
                                <Button
                                    text="Auto-match"
                                    variant="primary"
                                    size="small"
                                    icon={<Zap size={14} />}
                                    disabled={autoMatch.isPending}
                                    onClick={() => autoMatch.mutate()}
                                />
                            )}
                        </div>
                    )}
                </div>

                {activeStatement && (
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                            <thead className="bg-neutral-50">
                                <tr>
                                    <th className="p-2 text-left font-semibold border border-neutral-200">Date</th>
                                    <th className="p-2 text-left font-semibold border border-neutral-200">Description</th>
                                    <th className="p-2 text-right font-semibold border border-neutral-200">Amount</th>
                                    <th className="p-2 text-center font-semibold border border-neutral-200">Status</th>
                                    <th className="p-2 text-center font-semibold border border-neutral-200 w-[180px]">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(activeStatement.lines || []).map((line: BankStatementLine) => (
                                    <tr key={line.id} className="hover:bg-neutral-50">
                                        <td className="p-2 border border-neutral-100">{formatDateID(line.date)}</td>
                                        <td className="p-2 border border-neutral-100">{line.description}</td>
                                        <td className="p-2 border border-neutral-100 text-right font-mono">
                                            <span className={line.amount >= 0 ? 'banking-amount-positive' : 'banking-amount-negative'}>
                                                {line.amount >= 0 ? '+' : ''}{formatIDR(line.amount)}
                                            </span>
                                        </td>
                                        <td className="p-2 border border-neutral-100 text-center">
                                            <StatusTag status={line.status === 'Matched' ? 'Success' : 'Warning'} label={line.status} />
                                        </td>
                                        <td className="p-2 border border-neutral-100 text-center">
                                            {line.status === 'Unmatched' ? (
                                                matchingLineId === line.id ? (
                                                    <div className="flex items-center gap-1">
                                                        <input
                                                            type="text"
                                                            placeholder="Transaction ID"
                                                            className="h-7 w-28 px-2 text-xs border border-neutral-300 rounded"
                                                            value={matchTxnId}
                                                            onChange={(e) => setMatchTxnId(e.target.value)}
                                                        />
                                                        <Button
                                                            text="OK"
                                                            size="small"
                                                            variant="primary"
                                                            onClick={() => {
                                                                if (matchTxnId) {
                                                                    manualMatch.mutate({ statementLineId: line.id, txnId: matchTxnId });
                                                                    setMatchingLineId('');
                                                                    setMatchTxnId('');
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                ) : (
                                                    <Button
                                                        text="Match"
                                                        size="small"
                                                        variant="secondary"
                                                        disabled={!canCreate}
                                                        onClick={() => { setMatchingLineId(line.id); setMatchTxnId(''); }}
                                                    />
                                                )
                                            ) : (
                                                <span className="text-xs text-neutral-400">Matched</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* ── Import modal ──────────────────────────────────────────────── */}
            <Modal
                isOpen={importModalOpen}
                onClose={() => { setImportModalOpen(false); setImportError(''); setImportFile(null); }}
                title="Import Bank Statement"
                size="sm"
            >
                <div className="space-y-4">
                    {importError && (
                        <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
                            {importError}
                        </div>
                    )}
                    <div>
                        <label className="form-label">Bank Account</label>
                        <select
                            className="block w-full px-3 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                            value={importAccountId}
                            onChange={(e) => setImportAccountId(e.target.value)}
                        >
                            <option value="">Select bank account</option>
                            {bankAccounts.map((acc) => (
                                <option key={acc.id} value={acc.id}>{acc.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="form-label">Statement File</label>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv,.ofx,.qfx"
                            className="block w-full text-sm text-neutral-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                            onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                        />
                        <div className="mt-1 text-xs text-neutral-500">Accepted: .csv, .ofx, .qfx</div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button text="Cancel" variant="secondary" onClick={() => { setImportModalOpen(false); setImportError(''); }} />
                        <Button
                            text={importStatement.isPending ? 'Importing...' : 'Import'}
                            variant="primary"
                            disabled={importStatement.isPending}
                            onClick={async () => {
                                if (!importFile) { setImportError('Please select a file.'); return; }
                                if (!importAccountId) { setImportError('Please select a bank account.'); return; }
                                setImportError('');
                                const fd = new FormData();
                                fd.append('file', importFile);
                                fd.append('bankAccountId', importAccountId);
                                try {
                                    const result = await importStatement.mutateAsync(fd);
                                    setActiveStatementId(result.id);
                                    setImportModalOpen(false);
                                    setImportFile(null);
                                } catch (err) {
                                    setImportError((err as Error)?.message ?? 'Import failed.');
                                }
                            }}
                        />
                    </div>
                </div>
            </Modal>
        </ListPage>
    );
};

export default Banking;

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import { Plus, Search } from 'lucide-react';
import ListPage from '../../components/Layout/ListPage';
import { useJournalEntries } from '../../hooks/useGL';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { formatIDR, formatDateID } from '../../utils/formatters';

const PERIODS = [
    { value: '2026-01', label: 'Jan 2026' },
    { value: '2026-02', label: 'Feb 2026' },
    { value: '2026-03', label: 'Mar 2026' },
    { value: '2026-04', label: 'Apr 2026' },
];



// columns defined inside component to have access to navigate

const JournalEntries = () => {
    const navigate = useNavigate();
    const { canCreate, canEdit } = useModulePermissions('gl_journal');

    const columns = [
        { key: 'entryNo',     label: 'Entry No.',   sortable: true },
        { key: 'date',        label: 'Date',        sortable: true, render: (val) => formatDateID(val) },
        { key: 'period',      label: 'Period',      sortable: true },
        { key: 'memo',        label: 'Memo' },
        { key: 'status',      label: 'Status',      render: (val) => <StatusTag status={val} /> },
        { key: 'totalDebit',  label: 'Total Debit', align: 'right', render: (val) => formatIDR(val) },
        { key: 'totalCredit', label: 'Total Credit', align: 'right', render: (val) => formatIDR(val) },
        {
            key: 'actions',
            label: '',
            render: (_, row) => (
                <Button
                    text={row.status === 'Draft' ? 'Edit' : 'View'}
                    size="small"
                    variant="tertiary"
                    disabled={row.status === 'Draft' && !canEdit}
                    onClick={(e) => {
                        e.stopPropagation();
                        navigate('/gl/journals/edit', {
                            state: { mode: row.status === 'Draft' ? 'edit' : 'view', entryNo: row.entryNo, id: row.id }
                        });
                    }}
                />
            )
        },
    ];

    const [searchTerm, setSearchTerm] = useState('');
    const [periodFilter, setPeriodFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    // Fetch from API; pass status filter server-side, period is client-side only
    const apiStatusFilter = statusFilter === 'Posted' ? 'POSTED' : statusFilter === 'Draft' ? 'DRAFT' : undefined;
    const { data: jeResult, isLoading } = useJournalEntries(apiStatusFilter ? { status: apiStatusFilter } : {});
    const entries = jeResult?.data ?? [];

    const filteredEntries = useMemo(() => {
        const keyword = searchTerm.toLowerCase();
        return entries.filter((entry) => {
            const matchesSearch =
                entry.entryNo.toLowerCase().includes(keyword) ||
                entry.memo.toLowerCase().includes(keyword);
            const matchesPeriod = periodFilter ? entry.period === periodFilter : true;
            const matchesStatus = statusFilter ? entry.status === statusFilter : true;
            return matchesSearch && matchesPeriod && matchesStatus;
        });
    }, [entries, searchTerm, periodFilter, statusFilter]);

    return (
        <ListPage
            containerClassName=""
            title="Journal Entries"
            subtitle="Review and record manual journal entries to the General Ledger."
            actions={
                <Button
                    text="New Journal Entry"
                    variant="primary"
                    icon={<Plus size={16} />}
                    disabled={!canCreate}
                    onClick={() => navigate('/gl/journals/new')}
                />
            }
        >
            <div className="grid grid-cols-[minmax(280px,1fr)_220px_220px] gap-2.5 items-center bg-neutral-0 border border-neutral-200 rounded-lg p-3 mb-4">
                <div className="relative flex items-center">
                    <Search size={18} className="absolute left-2.5 text-neutral-400 pointer-events-none" />
                    <input
                        className="block w-full pl-[34px] px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        placeholder="Search entry no. or memo..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="min-w-0">
                    <select
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={periodFilter}
                        onChange={(e) => setPeriodFilter(e.target.value)}
                    >
                        <option value="">All Periods</option>
                        {PERIODS.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                    </select>
                </div>
                <div className="min-w-0">
                    <select
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="">All Statuses</option>
                        <option value="Posted">Posted</option>
                        <option value="Draft">Draft</option>
                    </select>
                </div>
            </div>

            <Card title="All Journal Entries" padding={false}>
                <Table
                    columns={columns}
                    data={filteredEntries}
                    showCount
                    countLabel="entries"
                    isLoading={isLoading}
                    loadingLabel="Loading journal entries..."
                />
            </Card>
        </ListPage>
    );
};

export default JournalEntries;

import React, { useState, useMemo } from 'react';
import { Plus, Calculator, Send, Eye, Trash2, Download, ArrowLeft } from 'lucide-react';
import ListPage from '../../components/Layout/ListPage';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import StatusTag from '../../components/UI/StatusTag';
import { formatIDR } from '../../utils/formatters';
import {
    usePayrollRuns, usePayrollRun, useCreatePayrollRun,
    useCalculatePayroll, usePostPayroll, useDeletePayrollRun,
} from '../../hooks/useHR';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { exportToCsv } from '../../utils/exportCsv';

const MONTH_NAMES = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

const STATUS_LABELS: Record<string, string> = {
    DRAFT: 'Draft',
    CALCULATED: 'Calculated',
    REVIEWED: 'Reviewed',
    POSTED: 'Posted',
    VOID: 'Void',
};

function getMonthRange(month: number, year: number): { start: string; end: string } {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
}

const PayrollRun = () => {
    const { canCreate, canEdit, canDelete } = useModulePermissions('hr_payroll');
    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createMonth, setCreateMonth] = useState(new Date().getMonth() + 1);
    const [createYear, setCreateYear] = useState(new Date().getFullYear());
    const [createNotes, setCreateNotes] = useState('');

    const { data: runsResult, isLoading: runsLoading } = usePayrollRuns();
    const payrollRuns = runsResult?.data ?? [];
    const { data: selectedRun, isLoading: runLoading } = usePayrollRun(selectedRunId ?? undefined);
    const createPayrollRun = useCreatePayrollRun();
    const calculatePayroll = useCalculatePayroll();
    const postPayroll = usePostPayroll();
    const deletePayrollRun = useDeletePayrollRun();

    const handleCreate = async () => {
        const { start, end } = getMonthRange(createMonth, createYear);
        try {
            const result = await createPayrollRun.mutateAsync({
                month: createMonth,
                year: createYear,
                periodStart: start,
                periodEnd: end,
                notes: createNotes || undefined,
            });
            setShowCreateModal(false);
            setCreateNotes('');
            setSelectedRunId((result as any).id);
        } catch {
            // handled
        }
    };

    const handleCalculate = async () => {
        if (!selectedRunId) return;
        if (!confirm('Calculate payroll? This will recompute every payroll line.')) return;
        try {
            await calculatePayroll.mutateAsync(selectedRunId);
        } catch {
            // handled
        }
    };

    const handlePost = async () => {
        if (!selectedRunId) return;
        if (!confirm('Post payroll to GL? This creates a journal entry and cannot be undone.')) return;
        try {
            await postPayroll.mutateAsync(selectedRunId);
        } catch {
            // handled
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this payroll run?')) return;
        try {
            await deletePayrollRun.mutateAsync(id);
            if (selectedRunId === id) setSelectedRunId(null);
        } catch {
            // handled
        }
    };

    const handleExportLines = () => {
        if (!selectedRun?.lines) return;
        exportToCsv(`payroll-${selectedRun.number}`, selectedRun.lines.map((l: any) => ({
            employeeNo: l.employee?.employeeNo || '',
            name: l.employee?.name || '',
            basicSalary: Number(l.basicSalary),
            allowances: Number(l.totalAllowances),
            overtime: Number(l.overtimePay),
            grossPay: Number(l.grossPay),
            deductions: Number(l.totalDeductions),
            bpjsEmployee: Number(l.totalBpjsEmployee),
            pph21: Number(l.pph21),
            netPay: Number(l.netPay),
            presentDays: l.presentDays,
            absentDays: l.absentDays,
        })), [
            { label: 'Employee No.', key: 'employeeNo' },
            { label: 'Name', key: 'name' },
            { label: 'Basic Salary', key: 'basicSalary' },
            { label: 'Allowances', key: 'allowances' },
            { label: 'Overtime', key: 'overtime' },
            { label: 'Gross Pay', key: 'grossPay' },
            { label: 'Deductions', key: 'deductions' },
            { label: 'BPJS (Employee)', key: 'bpjsEmployee' },
            { label: 'PPh 21', key: 'pph21' },
            { label: 'Net Pay', key: 'netPay' },
            { label: 'Days Present', key: 'presentDays' },
            { label: 'Days Absent', key: 'absentDays' },
        ]);
    };

    // ── Detail View ──────────────────────────────────────────────────────────

    if (selectedRunId && selectedRun) {
        const lines = selectedRun.lines || [];

        const summaryCards = [
            { label: 'Total Gross', value: formatIDR(Number(selectedRun.totalGross)), color: 'text-neutral-900' },
            { label: 'Total Deductions', value: formatIDR(Number(selectedRun.totalDeductions)), color: 'text-danger-500' },
            { label: 'Total PPh 21', value: formatIDR(Number(selectedRun.totalTax)), color: 'text-warning-600' },
            { label: 'Total BPJS', value: formatIDR(Number(selectedRun.totalBpjs)), color: 'text-info-600' },
            { label: 'Total Net', value: formatIDR(Number(selectedRun.totalNet)), color: 'text-green-600' },
        ];

        const lineColumns: TableColumn<any>[] = [
            {
                key: 'employee',
                label: 'Employee',
                render: (_v: unknown, row: any) => (
                    <div>
                        <div className="font-medium text-sm">{row.employee?.name}</div>
                        <div className="text-xs text-neutral-500">{row.employee?.employeeNo}</div>
                    </div>
                ),
            },
            {
                key: 'basicSalary',
                label: 'Basic Salary',
                align: 'right',
                render: (v: unknown) => formatIDR(Number(v)),
            },
            {
                key: 'totalAllowances',
                label: 'Allowances',
                align: 'right',
                render: (v: unknown) => formatIDR(Number(v)),
            },
            {
                key: 'overtimePay',
                label: 'Overtime',
                align: 'right',
                render: (v: unknown) => Number(v) > 0 ? formatIDR(Number(v)) : '-',
            },
            {
                key: 'grossPay',
                label: 'Gross',
                align: 'right',
                render: (v: unknown) => <span className="font-medium">{formatIDR(Number(v))}</span>,
            },
            {
                key: 'totalDeductions',
                label: 'Deductions',
                align: 'right',
                render: (v: unknown) => Number(v) > 0 ? formatIDR(Number(v)) : '-',
            },
            {
                key: 'totalBpjsEmployee',
                label: 'BPJS',
                align: 'right',
                render: (v: unknown) => formatIDR(Number(v)),
            },
            {
                key: 'pph21',
                label: 'PPh 21',
                align: 'right',
                render: (v: unknown) => formatIDR(Number(v)),
            },
            {
                key: 'netPay',
                label: 'Net',
                align: 'right',
                render: (v: unknown) => <span className="font-bold text-green-700">{formatIDR(Number(v))}</span>,
            },
            {
                key: 'presentDays',
                label: 'Present',
                align: 'right',
                render: (v: unknown, row: any) => `${v}/${row.workingDays}`,
            },
        ];

        return (
            <ListPage
                containerClassName="hr-module"
                title={
                    <div className="flex items-center gap-3">
                        <button onClick={() => setSelectedRunId(null)} className="text-neutral-400 hover:text-neutral-700">
                            <ArrowLeft size={20} />
                        </button>
                        <span>Payroll {MONTH_NAMES[selectedRun.month]} {selectedRun.year}</span>
                    </div>
                }
                subtitle={`${selectedRun.number} - ${STATUS_LABELS[selectedRun.status] || selectedRun.status}`}
                actions={
                    <div className="flex gap-2">
                        <Button variant="secondary" size="small" icon={<Download size={16} />} text="Export" onClick={handleExportLines} />
                        {canEdit && selectedRun.status !== 'POSTED' && (
                            <>
                                <Button
                                    variant="secondary"
                                    size="small"
                                    icon={<Calculator size={16} />}
                                    text={calculatePayroll.isPending ? 'Calculating...' : 'Calculate'}
                                    onClick={handleCalculate}
                                    disabled={calculatePayroll.isPending}
                                />
                                {(selectedRun.status === 'CALCULATED' || selectedRun.status === 'REVIEWED') && (
                                    <Button
                                        size="small"
                                        icon={<Send size={16} />}
                                        text={postPayroll.isPending ? 'Posting...' : 'Post to GL'}
                                        onClick={handlePost}
                                        disabled={postPayroll.isPending}
                                    />
                                )}
                            </>
                        )}
                    </div>
                }
            >
                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                    {summaryCards.map((card) => (
                        <Card key={card.label}>
                            <div className="p-3">
                                <div className="text-xs text-neutral-500 mb-1">{card.label}</div>
                                <div className={`text-lg font-bold ${card.color}`}>{card.value}</div>
                            </div>
                        </Card>
                    ))}
                </div>

                {/* Payroll Lines */}
                <Card>
                    <Table
                        columns={lineColumns}
                        data={lines}
                        isLoading={runLoading}
                        showCount
                        countLabel="employees"
                    />
                </Card>

                {selectedRun.journalEntryId && (
                    <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                        Journal entry posted: {selectedRun.journalEntryId}
                    </div>
                )}
            </ListPage>
        );
    }

    // ── List View ────────────────────────────────────────────────────────────

    const listColumns: TableColumn<any>[] = [
        { key: 'number', label: 'Number' },
        {
            key: 'month',
            label: 'Period',
            render: (v: unknown, row: any) => `${MONTH_NAMES[v as number]} ${row.year}`,
        },
        {
            key: 'status',
            label: 'Status',
            render: (v: unknown) => <StatusTag status={STATUS_LABELS[v as string] || (v as string)} />,
        },
        {
            key: 'totalGross',
            label: 'Total Gross',
            align: 'right',
            render: (v: unknown) => formatIDR(Number(v)),
        },
        {
            key: 'totalNet',
            label: 'Total Net',
            align: 'right',
            render: (v: unknown) => <span className="font-semibold">{formatIDR(Number(v))}</span>,
        },
        {
            key: '_count',
            label: 'Employees',
            align: 'right',
            render: (v: unknown) => (v as any)?.lines ?? 0,
        },
        {
            key: 'actions',
            label: '',
            render: (_v: unknown, row: any) => (
                <div className="flex gap-2">
                    <button
                        className="text-xs text-primary-700 hover:text-primary-900"
                        onClick={(e) => { e.stopPropagation(); setSelectedRunId(row.id); }}
                    >
                        <Eye size={14} />
                    </button>
                    {canDelete && row.status === 'DRAFT' && (
                        <button
                            className="text-xs text-danger-500 hover:text-danger-700"
                            onClick={(e) => { e.stopPropagation(); handleDelete(row.id); }}
                        >
                            <Trash2 size={14} />
                        </button>
                    )}
                </div>
            ),
        },
    ];

    return (
        <ListPage
            containerClassName="hr-module"
            title="Payroll Run"
            subtitle="Create, calculate, and post payroll."
            actions={
                canCreate ? (
                    <Button size="small" icon={<Plus size={16} />} text="Create Payroll" onClick={() => setShowCreateModal(true)} />
                ) : null
            }
        >
            <Card>
                <Table
                    columns={listColumns}
                    data={payrollRuns}
                    isLoading={runsLoading}
                    onRowClick={(row: any) => setSelectedRunId(row.id)}
                    showCount
                    countLabel="payroll runs"
                />
            </Card>

            {/* Create Modal */}
            <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create New Payroll Run" size="sm">
                <div className="p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">Month</label>
                            <select
                                value={createMonth}
                                onChange={(e) => setCreateMonth(Number(e.target.value))}
                                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                            >
                                {MONTH_NAMES.slice(1).map((name, i) => (
                                    <option key={i + 1} value={i + 1}>{name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">Year</label>
                            <select
                                value={createYear}
                                onChange={(e) => setCreateYear(Number(e.target.value))}
                                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                            >
                                {[2024, 2025, 2026, 2027].map((y) => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-1">Notes</label>
                        <textarea
                            value={createNotes}
                            onChange={(e) => setCreateNotes(e.target.value)}
                            rows={2}
                            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="Optional notes..."
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="secondary" text="Cancel" onClick={() => setShowCreateModal(false)} />
                        <Button
                            text={createPayrollRun.isPending ? 'Creating...' : 'Create'}
                            onClick={handleCreate}
                            disabled={createPayrollRun.isPending}
                        />
                    </div>
                </div>
            </Modal>
        </ListPage>
    );
};

export default PayrollRun;

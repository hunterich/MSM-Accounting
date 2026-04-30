import React, { useState, useMemo } from 'react';
import { Plus, Check, X, RefreshCw, Download } from 'lucide-react';
import ListPage from '../../components/Layout/ListPage';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import StatusTag from '../../components/UI/StatusTag';
import {
    useLeaveTypes, useCreateLeaveType, useUpdateLeaveType, useDeleteLeaveType,
    useLeaveRequests, useCreateLeaveRequest, useApproveLeave, useRejectLeave,
    useLeaveBalances, useInitializeLeaveBalances,
    useEmployees,
} from '../../hooks/useHR';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { exportToCsv } from '../../utils/exportCsv';

type Tab = 'requests' | 'types' | 'balances';

const CATEGORY_LABELS: Record<string, string> = {
    ANNUAL: 'Annual',
    SICK: 'Sick',
    MATERNITY: 'Maternity',
    PATERNITY: 'Paternity',
    UNPAID: 'Unpaid',
    OTHER: 'Other',
};

const STATUS_LABELS: Record<string, string> = {
    PENDING: 'Pending',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    CANCELLED: 'Cancelled',
};

const LeaveManagement = () => {
    const { canCreate, canEdit, canDelete } = useModulePermissions('hr_attendance');
    const [activeTab, setActiveTab] = useState<Tab>('requests');

    return (
        <ListPage
            containerClassName="hr-module"
            title="Leave Management"
            subtitle="Manage leave types, leave requests, and employee leave balances."
        >
            {/* Tab bar */}
            <div className="flex border-b border-neutral-200 mb-4">
                {([
                    { key: 'requests' as Tab, label: 'Leave Requests' },
                    { key: 'types' as Tab, label: 'Leave Types' },
                    { key: 'balances' as Tab, label: 'Leave Balances' },
                ]).map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === tab.key
                                ? 'border-primary-700 text-primary-700'
                                : 'border-transparent text-neutral-500 hover:text-neutral-700'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {activeTab === 'requests' && <LeaveRequestsTab canCreate={canCreate} canEdit={canEdit} />}
            {activeTab === 'types' && <LeaveTypesTab canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />}
            {activeTab === 'balances' && <LeaveBalancesTab canCreate={canCreate} />}
        </ListPage>
    );
};

// ── Leave Requests Tab ────────────────────────────────────────────────────────

function LeaveRequestsTab({ canCreate, canEdit }: { canCreate: boolean; canEdit: boolean }) {
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [form, setForm] = useState({
        employeeId: '',
        leaveTypeId: '',
        startDate: '',
        endDate: '',
        totalDays: 1,
        reason: '',
    });

    const filters: Record<string, unknown> = {};
    if (statusFilter) filters.status = statusFilter;

    const { data: result, isLoading } = useLeaveRequests(filters);
    const requests = result?.data ?? [];
    const { data: empResult } = useEmployees();
    const employees = empResult?.data ?? [];
    const { data: ltResult } = useLeaveTypes();
    const leaveTypes = ltResult?.data ?? [];
    const createRequest = useCreateLeaveRequest();
    const approveLeave = useApproveLeave();
    const rejectLeave = useRejectLeave();

    const handleCreate = async () => {
        try {
            await createRequest.mutateAsync(form);
            setShowCreateModal(false);
            setForm({ employeeId: '', leaveTypeId: '', startDate: '', endDate: '', totalDays: 1, reason: '' });
        } catch {
            // handled by react-query
        }
    };

    // Auto-calculate days when dates change
    const updateDates = (startDate: string, endDate: string) => {
        let totalDays = 1;
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            let count = 0;
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                if (d.getDay() !== 0 && d.getDay() !== 6) count++;
            }
            totalDays = Math.max(1, count);
        }
        setForm((f) => ({ ...f, startDate, endDate, totalDays }));
    };

    const handleExport = () => {
        exportToCsv('leave-requests', requests.map((r: any) => ({
            employee: r.employee?.name || '',
            leaveType: r.leaveType?.name || '',
            startDate: r.startDate ? new Date(r.startDate).toLocaleDateString('id-ID') : '',
            endDate: r.endDate ? new Date(r.endDate).toLocaleDateString('id-ID') : '',
            totalDays: r.totalDays,
            status: STATUS_LABELS[r.status] || r.status,
            reason: r.reason || '',
        })), [
            { label: 'Employee', key: 'employee' },
            { label: 'Leave Type', key: 'leaveType' },
            { label: 'Start', key: 'startDate' },
            { label: 'End', key: 'endDate' },
            { label: 'Days', key: 'totalDays' },
            { label: 'Status', key: 'status' },
            { label: 'Reason', key: 'reason' },
        ]);
    };

    const columns: TableColumn<any>[] = [
        {
            key: 'employee',
            label: 'Employee',
            render: (_v: unknown, row: any) => (
                <div>
                    <div className="font-medium">{row.employee?.name}</div>
                    <div className="text-xs text-neutral-500">{row.employee?.employeeNo}</div>
                </div>
            ),
        },
        {
            key: 'leaveType',
            label: 'Leave Type',
            render: (_v: unknown, row: any) => row.leaveType?.name || '-',
        },
        {
            key: 'startDate',
            label: 'Start',
            render: (v: unknown) => v ? new Date(v as string).toLocaleDateString('id-ID') : '-',
        },
        {
            key: 'endDate',
            label: 'End',
            render: (v: unknown) => v ? new Date(v as string).toLocaleDateString('id-ID') : '-',
        },
        {
            key: 'totalDays',
            label: 'Days',
            align: 'right',
        },
        {
            key: 'status',
            label: 'Status',
            render: (v: unknown) => <StatusTag status={STATUS_LABELS[v as string] || (v as string)} />,
        },
        {
            key: 'actions',
            label: 'Actions',
            render: (_v: unknown, row: any) => {
                if (row.status !== 'PENDING' || !canEdit) return null;
                return (
                    <div className="flex gap-1">
                        <button
                            className="text-xs text-green-600 hover:text-green-800 px-2 py-1 rounded hover:bg-green-50"
                            onClick={(e) => { e.stopPropagation(); approveLeave.mutate({ id: row.id }); }}
                        >
                            Approve
                        </button>
                        <button
                            className="text-xs text-danger-500 hover:text-danger-700 px-2 py-1 rounded hover:bg-danger-50"
                            onClick={(e) => { e.stopPropagation(); rejectLeave.mutate({ id: row.id }); }}
                        >
                            Reject
                        </button>
                    </div>
                );
            },
        },
    ];

    return (
        <>
            <div className="flex items-center justify-between mb-3">
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                >
                    <option value="">All Statuses</option>
                    <option value="PENDING">Pending</option>
                    <option value="APPROVED">Approved</option>
                    <option value="REJECTED">Rejected</option>
                </select>
                <div className="flex gap-2">
                    <Button variant="secondary" size="small" icon={<Download size={16} />} text="Export" onClick={handleExport} />
                    {canCreate && (
                        <Button size="small" icon={<Plus size={16} />} text="Request Leave" onClick={() => setShowCreateModal(true)} />
                    )}
                </div>
            </div>

            <Card>
                <Table columns={columns} data={requests} isLoading={isLoading} showCount countLabel="requests" />
            </Card>

            <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Submit Leave Request" size="md">
                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-1">Employee</label>
                        <select
                            value={form.employeeId}
                            onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                        >
                            <option value="">Select employee...</option>
                            {employees.map((emp: any) => (
                                <option key={emp.id} value={emp.id}>{emp.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-1">Leave Type</label>
                        <select
                            value={form.leaveTypeId}
                            onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}
                            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                        >
                            <option value="">Select leave type...</option>
                            {leaveTypes.map((lt: any) => (
                                <option key={lt.id} value={lt.id}>{lt.name} ({CATEGORY_LABELS[lt.category] || lt.category})</option>
                            ))}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">Start Date</label>
                            <input
                                type="date"
                                value={form.startDate}
                                onChange={(e) => updateDates(e.target.value, form.endDate)}
                                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">End Date</label>
                            <input
                                type="date"
                                value={form.endDate}
                                onChange={(e) => updateDates(form.startDate, e.target.value)}
                                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-1">Total Days: <span className="font-bold">{form.totalDays}</span></label>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-1">Reason</label>
                        <textarea
                            value={form.reason}
                            onChange={(e) => setForm({ ...form, reason: e.target.value })}
                            rows={3}
                            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="Reason for leave request..."
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="secondary" text="Cancel" onClick={() => setShowCreateModal(false)} />
                        <Button
                            text={createRequest.isPending ? 'Saving...' : 'Submit'}
                            onClick={handleCreate}
                            disabled={createRequest.isPending || !form.employeeId || !form.leaveTypeId || !form.startDate || !form.endDate}
                        />
                    </div>
                </div>
            </Modal>
        </>
    );
}

// ── Leave Types Tab ───────────────────────────────────────────────────────────

function LeaveTypesTab({ canCreate, canEdit, canDelete }: { canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({
        name: '',
        category: 'ANNUAL',
        entitlementDays: 12,
        carryOver: false,
        maxCarryDays: 0,
    });

    const { data: result, isLoading } = useLeaveTypes();
    const leaveTypes = result?.data ?? [];
    const createLeaveType = useCreateLeaveType();
    const updateLeaveType = useUpdateLeaveType();
    const deleteLeaveType = useDeleteLeaveType();

    const openCreate = () => {
        setEditingId(null);
        setForm({ name: '', category: 'ANNUAL', entitlementDays: 12, carryOver: false, maxCarryDays: 0 });
        setShowModal(true);
    };

    const openEdit = (lt: any) => {
        setEditingId(lt.id);
        setForm({
            name: lt.name,
            category: lt.category,
            entitlementDays: lt.entitlementDays,
            carryOver: lt.carryOver,
            maxCarryDays: lt.maxCarryDays,
        });
        setShowModal(true);
    };

    const handleSave = async () => {
        try {
            if (editingId) {
                await updateLeaveType.mutateAsync({ id: editingId, ...form });
            } else {
                await createLeaveType.mutateAsync(form);
            }
            setShowModal(false);
        } catch {
            // handled
        }
    };

    const columns: TableColumn<any>[] = [
        { key: 'name', label: 'Name' },
        {
            key: 'category',
            label: 'Category',
            render: (v: unknown) => CATEGORY_LABELS[v as string] || (v as string),
        },
        { key: 'entitlementDays', label: 'Entitlement (Days)', align: 'right' },
        {
            key: 'carryOver',
            label: 'Carry Over',
            render: (v: unknown, row: any) => v ? `Yes (max ${row.maxCarryDays} days)` : 'No',
        },
        {
            key: 'isActive',
            label: 'Status',
            render: (v: unknown) => <StatusTag status={v ? 'Active' : 'Inactive'} />,
        },
        {
            key: 'actions',
            label: '',
            render: (_v: unknown, row: any) => (
                <div className="flex gap-2">
                    {canEdit && (
                        <button
                            className="text-xs text-primary-700 hover:text-primary-900"
                            onClick={(e) => { e.stopPropagation(); openEdit(row); }}
                        >
                            Edit
                        </button>
                    )}
                    {canDelete && (
                        <button
                            className="text-xs text-danger-500 hover:text-danger-700"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (confirm('Delete this leave type?')) deleteLeaveType.mutate(row.id);
                            }}
                        >
                            Delete
                        </button>
                    )}
                </div>
            ),
        },
    ];

    return (
        <>
            <div className="flex justify-end mb-3">
                {canCreate && (
                    <Button size="small" icon={<Plus size={16} />} text="Add Leave Type" onClick={openCreate} />
                )}
            </div>

            <Card>
                <Table columns={columns} data={leaveTypes} isLoading={isLoading} showCount countLabel="leave types" />
            </Card>

            <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingId ? 'Edit Leave Type' : 'Add Leave Type'} size="md">
                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-1">Name</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="Example: Annual Leave"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">Category</label>
                            <select
                                value={form.category}
                                onChange={(e) => setForm({ ...form, category: e.target.value })}
                                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                            >
                                {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                                    <option key={val} value={val}>{label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">Entitlement (Days/Year)</label>
                            <input
                                type="number"
                                value={form.entitlementDays}
                                onChange={(e) => setForm({ ...form, entitlementDays: Number(e.target.value) })}
                                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                                min={0}
                            />
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={form.carryOver}
                                onChange={(e) => setForm({ ...form, carryOver: e.target.checked })}
                                className="rounded border-neutral-300"
                            />
                            Carry Over
                        </label>
                        {form.carryOver && (
                            <div className="flex items-center gap-2">
                                <label className="text-sm text-neutral-600">Max:</label>
                                <input
                                    type="number"
                                    value={form.maxCarryDays}
                                    onChange={(e) => setForm({ ...form, maxCarryDays: Number(e.target.value) })}
                                    className="w-20 border border-neutral-300 rounded-lg px-2 py-1 text-sm"
                                    min={0}
                                />
                                <span className="text-sm text-neutral-500">days</span>
                            </div>
                        )}
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="secondary" text="Cancel" onClick={() => setShowModal(false)} />
                        <Button
                            text={editingId ? 'Save' : 'Add'}
                            onClick={handleSave}
                            disabled={!form.name || createLeaveType.isPending || updateLeaveType.isPending}
                        />
                    </div>
                </div>
            </Modal>
        </>
    );
}

// ── Leave Balances Tab ────────────────────────────────────────────────────────

function LeaveBalancesTab({ canCreate }: { canCreate: boolean }) {
    const currentYear = new Date().getFullYear();
    const [year, setYear] = useState(currentYear);
    const { data: result, isLoading } = useLeaveBalances(undefined, year);
    const balances = result?.data ?? [];
    const initBalances = useInitializeLeaveBalances();

    const handleInit = async () => {
        if (confirm(`Initialize leave balances for ${year}? This will create balances for all active employees based on existing leave types.`)) {
            try {
                await initBalances.mutateAsync({ year });
            } catch {
                // handled
            }
        }
    };

    // Group by employee
    const grouped = useMemo(() => {
        const map = new Map<string, { employee: any; balances: any[] }>();
        for (const b of balances) {
            const key = b.employeeId || b.employee?.id;
            if (!map.has(key)) {
                map.set(key, { employee: b.employee, balances: [] });
            }
            map.get(key)!.balances.push(b);
        }
        return Array.from(map.values());
    }, [balances]);

    const columns: TableColumn<any>[] = [
        {
            key: 'employee',
            label: 'Employee',
            render: (_v: unknown, row: any) => (
                <div>
                    <div className="font-medium">{row.employee?.name}</div>
                    <div className="text-xs text-neutral-500">{row.employee?.employeeNo}</div>
                </div>
            ),
        },
        {
            key: 'leaveType',
            label: 'Leave Type',
            render: (_v: unknown, row: any) => row.leaveType?.name || '-',
        },
        { key: 'entitlement', label: 'Entitlement', align: 'right' },
        { key: 'carried', label: 'Carry Over', align: 'right' },
        { key: 'used', label: 'Used', align: 'right' },
        {
            key: 'remaining',
            label: 'Remaining',
            align: 'right',
            render: (v: unknown) => (
                <span className={`font-semibold ${Number(v) <= 0 ? 'text-danger-500' : Number(v) <= 3 ? 'text-warning-600' : 'text-green-600'}`}>
                    {String(v)}
                </span>
            ),
        },
    ];

    return (
        <>
            <div className="flex items-center justify-between mb-3">
                <select
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                >
                    {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                        <option key={y} value={y}>{y}</option>
                    ))}
                </select>
                {canCreate && (
                    <Button
                        size="small"
                        icon={<RefreshCw size={16} />}
                        text={initBalances.isPending ? 'Processing...' : `Initialize ${year}`}
                        onClick={handleInit}
                        disabled={initBalances.isPending}
                    />
                )}
            </div>

            <Card>
                <Table columns={columns} data={balances} isLoading={isLoading} showCount countLabel="leave balances" />
            </Card>

            {initBalances.isSuccess && initBalances.data && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                    Created {(initBalances.data as any).created} new leave balances.
                    {(initBalances.data as any).skipped > 0 && ` (${(initBalances.data as any).skipped} already existed)`}
                </div>
            )}
        </>
    );
}

export default LeaveManagement;

import React, { useMemo, useState } from 'react';
import { Calendar, Users, Clock, AlertTriangle, Download, Plus, Check } from 'lucide-react';
import ListPage from '../../components/Layout/ListPage';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import StatusTag from '../../components/UI/StatusTag';
import { useAttendance, useCreateAttendance, useEmployees, useDeleteAttendance } from '../../hooks/useHR';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { exportToCsv } from '../../utils/exportCsv';

type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'SICK' | 'LEAVE' | 'LATE' | 'HALF_DAY';

const STATUS_OPTIONS: { value: AttendanceStatus | ''; label: string }[] = [
    { value: '', label: 'All Statuses' },
    { value: 'PRESENT', label: 'Present' },
    { value: 'ABSENT', label: 'Absent' },
    { value: 'SICK', label: 'Sick' },
    { value: 'LEAVE', label: 'Leave' },
    { value: 'LATE', label: 'Late' },
    { value: 'HALF_DAY', label: 'Half Day' },
];

const STATUS_LABELS: Record<string, string> = {
    PRESENT: 'Present',
    ABSENT: 'Absent',
    SICK: 'Sick',
    LEAVE: 'Leave',
    LATE: 'Late',
    HALF_DAY: 'Half Day',
};

function formatTime(dateStr: string | null | undefined): string {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr);
        return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '-';
    }
}

function getMonthDateRange(year: number, month: number): { start: string; end: string } {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
}

const Attendance = () => {
    const { canCreate } = useModulePermissions('hr_attendance');
    const today = new Date();
    const [selectedYear, setSelectedYear] = useState(today.getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
    const [selectedDate, setSelectedDate] = useState(today.toISOString().slice(0, 10));
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkDate, setBulkDate] = useState(today.toISOString().slice(0, 10));
    const [bulkCheckIn, setBulkCheckIn] = useState('08:00');
    const [bulkCheckOut, setBulkCheckOut] = useState('17:00');
    const [bulkStatus, setBulkStatus] = useState<AttendanceStatus>('PRESENT');
    const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());

    const { start, end } = getMonthDateRange(selectedYear, selectedMonth);
    const filters: Record<string, unknown> = {
        startDate: start,
        endDate: end,
        limit: 200,
    };
    if (statusFilter) filters.status = statusFilter;

    const { data: attendanceResult, isLoading } = useAttendance(filters);
    const attendanceList = attendanceResult?.data ?? [];
    const { data: empResult } = useEmployees();
    const employeeList = empResult?.data ?? [];
    const createAttendance = useCreateAttendance();
    const deleteAttendance = useDeleteAttendance();

    // Filter by selected date within the month view
    const filteredData = useMemo(() => {
        if (!selectedDate) return attendanceList;
        return attendanceList.filter((a: any) => {
            const dateStr = a.date ? new Date(a.date).toISOString().slice(0, 10) : '';
            return dateStr === selectedDate;
        });
    }, [attendanceList, selectedDate]);

    // Monthly summary stats
    const monthlySummary = useMemo(() => {
        const total = attendanceList.length;
        const present = attendanceList.filter((a: any) => a.status === 'PRESENT' || a.status === 'LATE').length;
        const absent = attendanceList.filter((a: any) => a.status === 'ABSENT').length;
        const late = attendanceList.filter((a: any) => a.status === 'LATE').length;
        const sick = attendanceList.filter((a: any) => a.status === 'SICK').length;
        const leave = attendanceList.filter((a: any) => a.status === 'LEAVE').length;
        return { total, present, absent, late, sick, leave };
    }, [attendanceList]);

    // Generate calendar dates for the month
    const calendarDates = useMemo(() => {
        const dates: string[] = [];
        const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
        for (let d = 1; d <= lastDay; d++) {
            dates.push(`${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
        }
        return dates;
    }, [selectedYear, selectedMonth]);

    // Count attendance per date for calendar highlighting
    const dateCountMap = useMemo(() => {
        const map: Record<string, number> = {};
        for (const a of attendanceList) {
            const dateStr = a.date ? new Date(a.date).toISOString().slice(0, 10) : '';
            map[dateStr] = (map[dateStr] || 0) + 1;
        }
        return map;
    }, [attendanceList]);

    const handleBulkCreate = async () => {
        const employeeIds = selectedEmployeeIds.size > 0
            ? Array.from(selectedEmployeeIds)
            : employeeList.map((e: any) => e.id);

        const records = employeeIds.map((employeeId) => ({
            employeeId,
            date: bulkDate,
            checkIn: bulkCheckIn,
            checkOut: bulkCheckOut,
            status: bulkStatus,
        }));

        try {
            await createAttendance.mutateAsync(records);
            setShowBulkModal(false);
            setSelectedEmployeeIds(new Set());
        } catch (e) {
            // error handled by react-query
        }
    };

    const handleExport = () => {
        exportToCsv(`attendance-${selectedYear}-${selectedMonth}`, attendanceList.map((a: any) => ({
            employeeNo: a.employee?.employeeNo || '',
            name: a.employee?.name || '',
            date: a.date ? new Date(a.date).toISOString().slice(0, 10) : '',
            checkIn: formatTime(a.checkIn),
            checkOut: formatTime(a.checkOut),
            hoursWorked: a.hoursWorked ?? '',
            overtimeHours: a.overtimeHours ?? 0,
            status: STATUS_LABELS[a.status] || a.status,
            notes: a.notes || '',
        })), [
            { label: 'No. Karyawan', key: 'employeeNo' },
            { label: 'Nama', key: 'name' },
            { label: 'Tanggal', key: 'date' },
            { label: 'Masuk', key: 'checkIn' },
            { label: 'Keluar', key: 'checkOut' },
            { label: 'Jam Kerja', key: 'hoursWorked' },
            { label: 'Lembur', key: 'overtimeHours' },
            { label: 'Status', key: 'status' },
            { label: 'Catatan', key: 'notes' },
        ]);
    };

    const columns: TableColumn<any>[] = [
        {
            key: 'employee',
            label: 'Karyawan',
            render: (_v: unknown, row: any) => (
                <div>
                    <div className="font-medium text-neutral-900">{row.employee?.name}</div>
                    <div className="text-xs text-neutral-500">{row.employee?.employeeNo}</div>
                </div>
            ),
        },
        {
            key: 'date',
            label: 'Tanggal',
            render: (v: unknown) => v ? new Date(v as string).toLocaleDateString('id-ID') : '-',
        },
        {
            key: 'checkIn',
            label: 'Masuk',
            render: (v: unknown) => formatTime(v as string),
        },
        {
            key: 'checkOut',
            label: 'Keluar',
            render: (v: unknown) => formatTime(v as string),
        },
        {
            key: 'hoursWorked',
            label: 'Jam Kerja',
            align: 'right',
            render: (v: unknown) => v != null ? `${Number(v).toFixed(1)}h` : '-',
        },
        {
            key: 'overtimeHours',
            label: 'Lembur',
            align: 'right',
            render: (v: unknown) => Number(v) > 0 ? `${Number(v).toFixed(1)}h` : '-',
        },
        {
            key: 'status',
            label: 'Status',
            render: (v: unknown) => <StatusTag status={STATUS_LABELS[v as string] || (v as string)} />,
        },
        {
            key: 'actions',
            label: '',
            render: (_v: unknown, row: any) => canCreate ? (
                <button
                    className="text-xs text-danger-500 hover:text-danger-700"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('Hapus catatan kehadiran ini?')) {
                            deleteAttendance.mutate(row.id);
                        }
                    }}
                >
                    Hapus
                </button>
            ) : null,
        },
    ];

    const monthNames = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
    ];

    return (
        <ListPage
            containerClassName="hr-module"
            title="Kehadiran"
            subtitle="Kelola catatan kehadiran karyawan."
            actions={
                <div className="flex gap-2">
                    <Button
                        variant="secondary"
                        size="small"
                        icon={<Download size={16} />}
                        text="Export CSV"
                        onClick={handleExport}
                    />
                    {canCreate && (
                        <Button
                            size="small"
                            icon={<Plus size={16} />}
                            text="Entri Massal"
                            onClick={() => setShowBulkModal(true)}
                        />
                    )}
                </div>
            }
        >
            {/* Monthly summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <Card>
                    <div className="p-3 flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary-100 flex items-center justify-center">
                            <Users size={20} className="text-primary-700" />
                        </div>
                        <div>
                            <div className="text-2xl font-bold text-neutral-900">{monthlySummary.present}</div>
                            <div className="text-xs text-neutral-500">Hadir</div>
                        </div>
                    </div>
                </Card>
                <Card>
                    <div className="p-3 flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-danger-100 flex items-center justify-center">
                            <AlertTriangle size={20} className="text-danger-500" />
                        </div>
                        <div>
                            <div className="text-2xl font-bold text-neutral-900">{monthlySummary.absent}</div>
                            <div className="text-xs text-neutral-500">Tidak Hadir</div>
                        </div>
                    </div>
                </Card>
                <Card>
                    <div className="p-3 flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-warning-100 flex items-center justify-center">
                            <Clock size={20} className="text-warning-500" />
                        </div>
                        <div>
                            <div className="text-2xl font-bold text-neutral-900">{monthlySummary.late}</div>
                            <div className="text-xs text-neutral-500">Terlambat</div>
                        </div>
                    </div>
                </Card>
                <Card>
                    <div className="p-3 flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-info-100 flex items-center justify-center">
                            <Calendar size={20} className="text-info-500" />
                        </div>
                        <div>
                            <div className="text-2xl font-bold text-neutral-900">{monthlySummary.sick + monthlySummary.leave}</div>
                            <div className="text-xs text-neutral-500">Sakit / Cuti</div>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Month/Year selector and calendar strip */}
            <Card>
                <div className="p-4">
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                        <select
                            value={selectedMonth}
                            onChange={(e) => setSelectedMonth(Number(e.target.value))}
                            className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                        >
                            {monthNames.map((name, i) => (
                                <option key={i} value={i + 1}>{name}</option>
                            ))}
                        </select>
                        <select
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(Number(e.target.value))}
                            className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                        >
                            {[2024, 2025, 2026, 2027].map((y) => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                        >
                            {STATUS_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Calendar date strip */}
                    <div className="flex gap-1 overflow-x-auto pb-2">
                        {calendarDates.map((dateStr) => {
                            const d = new Date(dateStr);
                            const dayNum = d.getDate();
                            const dayName = d.toLocaleDateString('id-ID', { weekday: 'short' });
                            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                            const isSelected = dateStr === selectedDate;
                            const count = dateCountMap[dateStr] || 0;

                            return (
                                <button
                                    key={dateStr}
                                    onClick={() => setSelectedDate(dateStr)}
                                    className={`flex flex-col items-center min-w-[40px] px-1 py-1.5 rounded-lg text-xs transition-colors
                                        ${isSelected ? 'bg-primary-700 text-white' : isWeekend ? 'bg-neutral-50 text-neutral-400' : 'hover:bg-neutral-100 text-neutral-700'}
                                    `}
                                >
                                    <span className="text-[10px]">{dayName}</span>
                                    <span className="font-semibold text-sm">{dayNum}</span>
                                    {count > 0 && (
                                        <span className={`text-[9px] mt-0.5 ${isSelected ? 'text-white/80' : 'text-primary-600'}`}>
                                            {count}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </Card>

            {/* Attendance table */}
            <div className="mt-4">
                <Card>
                    <Table
                        columns={columns}
                        data={filteredData}
                        isLoading={isLoading}
                        showCount
                        countLabel="catatan kehadiran"
                    />
                </Card>
            </div>

            {/* Bulk Entry Modal */}
            <Modal
                isOpen={showBulkModal}
                onClose={() => setShowBulkModal(false)}
                title="Entri Kehadiran Massal"
                size="lg"
            >
                <div className="p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">Tanggal</label>
                            <input
                                type="date"
                                value={bulkDate}
                                onChange={(e) => setBulkDate(e.target.value)}
                                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">Status</label>
                            <select
                                value={bulkStatus}
                                onChange={(e) => setBulkStatus(e.target.value as AttendanceStatus)}
                                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                            >
                                {STATUS_OPTIONS.filter((o) => o.value).map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">Jam Masuk</label>
                            <input
                                type="time"
                                value={bulkCheckIn}
                                onChange={(e) => setBulkCheckIn(e.target.value)}
                                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-1">Jam Keluar</label>
                            <input
                                type="time"
                                value={bulkCheckOut}
                                onChange={(e) => setBulkCheckOut(e.target.value)}
                                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                            />
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-medium text-neutral-700">
                                Pilih Karyawan ({selectedEmployeeIds.size > 0 ? `${selectedEmployeeIds.size} dipilih` : 'semua'})
                            </label>
                            <button
                                className="text-xs text-primary-700 hover:text-primary-800"
                                onClick={() => {
                                    if (selectedEmployeeIds.size === employeeList.length) {
                                        setSelectedEmployeeIds(new Set());
                                    } else {
                                        setSelectedEmployeeIds(new Set(employeeList.map((e: any) => e.id)));
                                    }
                                }}
                            >
                                {selectedEmployeeIds.size === employeeList.length ? 'Batalkan Semua' : 'Pilih Semua'}
                            </button>
                        </div>
                        <div className="max-h-48 overflow-y-auto border border-neutral-200 rounded-lg">
                            {employeeList.map((emp: any) => (
                                <label
                                    key={emp.id}
                                    className="flex items-center gap-2 px-3 py-2 hover:bg-neutral-50 cursor-pointer border-b border-neutral-100 last:border-0"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedEmployeeIds.has(emp.id)}
                                        onChange={(e) => {
                                            const next = new Set(selectedEmployeeIds);
                                            if (e.target.checked) next.add(emp.id);
                                            else next.delete(emp.id);
                                            setSelectedEmployeeIds(next);
                                        }}
                                        className="rounded border-neutral-300"
                                    />
                                    <span className="text-sm">{emp.name}</span>
                                    <span className="text-xs text-neutral-400">{emp.employeeNo}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="secondary" text="Batal" onClick={() => setShowBulkModal(false)} />
                        <Button
                            text={createAttendance.isPending ? 'Menyimpan...' : 'Simpan Kehadiran'}
                            icon={<Check size={16} />}
                            onClick={handleBulkCreate}
                            disabled={createAttendance.isPending}
                        />
                    </div>
                </div>
            </Modal>
        </ListPage>
    );
};

export default Attendance;

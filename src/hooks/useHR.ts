import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import type { ListResponse, Employee, RawEmployee, EmployeeStatus } from '../types';

export const HR_KEYS = {
    employees: ['hrEmployees'] as const,
    employee:  (id: string) => ['hrEmployees', id] as const,
    attendance: ['hrAttendance'] as const,
    leaveTypes: ['hrLeaveTypes'] as const,
    leaveRequests: ['hrLeaveRequests'] as const,
    leaveBalances: ['hrLeaveBalances'] as const,
    payrollRuns: ['hrPayrollRuns'] as const,
    payrollRun: (id: string) => ['hrPayrollRuns', id] as const,
};

// ── Status maps ───────────────────────────────────────────────────────────────

const EMP_STATUS_DOWN: Record<string, EmployeeStatus> = {
    ACTIVE: 'Active', INACTIVE: 'Inactive', ON_LEAVE: 'On Leave',
};
const EMP_STATUS_UP: Record<string, string> = {
    Active: 'ACTIVE', Inactive: 'INACTIVE', 'On Leave': 'ON_LEAVE',
};

// ── Normalizer ────────────────────────────────────────────────────────────────

function normalizeEmployee(raw: RawEmployee): Employee {
    const dept = raw.department;
    const pos  = raw.position;
    const compensationItems = raw.compensationItems || [];
    const allowances = (raw.allowances && raw.allowances.length > 0
        ? raw.allowances
        : compensationItems.filter((item) => item.type === 'ALLOWANCE')
    ).map((item, index) => ({
        id: String(item.id || `allowance-${index + 1}`),
        name: String(item.name || ''),
        amount: Number(item.amount ?? 0),
    }));
    const deductions = (raw.deductions && raw.deductions.length > 0
        ? raw.deductions
        : compensationItems.filter((item) => item.type === 'DEDUCTION')
    ).map((item, index) => ({
        id: String(item.id || `deduction-${index + 1}`),
        name: String(item.name || ''),
        amount: Number(item.amount ?? 0),
    }));
    return {
        id:           raw.id,
        employeeNo:   raw.employeeNo || '',
        name:         raw.name       || '',
        email:        raw.email      || '',
        phone:        raw.phone      || '',
        department:   (typeof dept === 'object' && dept !== null ? dept.name : dept) || '',
        departmentId: raw.departmentId || (typeof dept === 'object' && dept !== null ? dept.id : '') || '',
        position:     (typeof pos  === 'object' && pos  !== null ? pos.name  : pos)  || '',
        positionId:   raw.positionId   || (typeof pos  === 'object' && pos  !== null ? pos.id   : '') || '',
        status:       EMP_STATUS_DOWN[raw.status ?? ''] ?? (raw.status as EmployeeStatus),
        basicSalary:  Number(raw.basicSalary ?? 0),
        joinDate:     raw.joinDate ? String(raw.joinDate).slice(0, 10) : '',
        address:      raw.address || '',
        allowances,
        deductions,
    };
}

// ── Employees ─────────────────────────────────────────────────────────────────

export function useEmployees(filters: Record<string, unknown> = {}) {
    return useQuery({
        queryKey: [...HR_KEYS.employees, filters],
        queryFn:  () => api.get<ListResponse<RawEmployee>>('/api/v1/employees', filters),
        select:   (res) => ({
            ...res,
            data: (res.data || []).map(normalizeEmployee),
        }),
        staleTime: 30_000,
    });
}

export function useEmployee(id: string | undefined) {
    return useQuery({
        queryKey: HR_KEYS.employee(id ?? ''),
        queryFn:  () => api.get<RawEmployee>(`/api/v1/employees/${id}`),
        select:   normalizeEmployee,
        enabled:  Boolean(id),
        staleTime: 30_000,
    });
}

export function useCreateEmployee() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: Partial<Employee>) => api.post('/api/v1/employees', {
            ...body,
            status: EMP_STATUS_UP[body.status ?? ''] ?? body.status,
        }),
        onSuccess: () => qc.invalidateQueries({ queryKey: HR_KEYS.employees }),
    });
}

export function useUpdateEmployee() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }: Partial<Employee> & { id: string }) =>
            api.put(`/api/v1/employees/${id}`, {
                ...updates,
                ...(updates.status && { status: EMP_STATUS_UP[updates.status] ?? updates.status }),
            }),
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: HR_KEYS.employees });
            qc.invalidateQueries({ queryKey: HR_KEYS.employee(vars.id) });
        },
    });
}

export function useDeleteEmployee() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/employees/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: HR_KEYS.employees }),
    });
}

// ── Attendance ───────────────────────────────────────────────────────────────

export function useAttendance(filters: Record<string, unknown> = {}) {
    return useQuery({
        queryKey: [...HR_KEYS.attendance, filters],
        queryFn: () => api.get<ListResponse<any>>('/api/v1/attendance', filters),
        staleTime: 30_000,
    });
}

export function useCreateAttendance() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: any) => api.post('/api/v1/attendance', body),
        onSuccess: () => qc.invalidateQueries({ queryKey: HR_KEYS.attendance }),
    });
}

export function useUpdateAttendance() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }: any) => api.put(`/api/v1/attendance/${id}`, updates),
        onSuccess: () => qc.invalidateQueries({ queryKey: HR_KEYS.attendance }),
    });
}

export function useDeleteAttendance() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/attendance/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: HR_KEYS.attendance }),
    });
}

// ── Leave Types ──────────────────────────────────────────────────────────────

export function useLeaveTypes() {
    return useQuery({
        queryKey: HR_KEYS.leaveTypes,
        queryFn: () => api.get<ListResponse<any>>('/api/v1/leave-types'),
        staleTime: 60_000,
    });
}

export function useCreateLeaveType() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: any) => api.post('/api/v1/leave-types', body),
        onSuccess: () => qc.invalidateQueries({ queryKey: HR_KEYS.leaveTypes }),
    });
}

export function useUpdateLeaveType() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }: any) => api.put(`/api/v1/leave-types/${id}`, updates),
        onSuccess: () => qc.invalidateQueries({ queryKey: HR_KEYS.leaveTypes }),
    });
}

export function useDeleteLeaveType() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/leave-types/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: HR_KEYS.leaveTypes }),
    });
}

// ── Leave Requests ───────────────────────────────────────────────────────────

export function useLeaveRequests(filters: Record<string, unknown> = {}) {
    return useQuery({
        queryKey: [...HR_KEYS.leaveRequests, filters],
        queryFn: () => api.get<ListResponse<any>>('/api/v1/leave-requests', filters),
        staleTime: 30_000,
    });
}

export function useCreateLeaveRequest() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: any) => api.post('/api/v1/leave-requests', body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: HR_KEYS.leaveRequests });
            qc.invalidateQueries({ queryKey: HR_KEYS.leaveBalances });
        },
    });
}

export function useApproveLeave() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, reviewNote }: { id: string; reviewNote?: string }) =>
            api.put(`/api/v1/leave-requests/${id}`, { status: 'APPROVED', reviewNote }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: HR_KEYS.leaveRequests });
            qc.invalidateQueries({ queryKey: HR_KEYS.leaveBalances });
        },
    });
}

export function useRejectLeave() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, reviewNote }: { id: string; reviewNote?: string }) =>
            api.put(`/api/v1/leave-requests/${id}`, { status: 'REJECTED', reviewNote }),
        onSuccess: () => qc.invalidateQueries({ queryKey: HR_KEYS.leaveRequests }),
    });
}

// ── Leave Balances ───────────────────────────────────────────────────────────

export function useLeaveBalances(employeeId?: string, year?: number) {
    const filters: Record<string, unknown> = {};
    if (employeeId) filters.employeeId = employeeId;
    if (year) filters.year = year;

    return useQuery({
        queryKey: [...HR_KEYS.leaveBalances, filters],
        queryFn: () => api.get<ListResponse<any>>('/api/v1/leave-balances', filters),
        staleTime: 30_000,
    });
}

export function useInitializeLeaveBalances() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: { year: number; employeeIds?: string[] }) =>
            api.post('/api/v1/leave-balances', body),
        onSuccess: () => qc.invalidateQueries({ queryKey: HR_KEYS.leaveBalances }),
    });
}

// ── Payroll Runs ─────────────────────────────────────────────────────────────

export function usePayrollRuns(filters: Record<string, unknown> = {}) {
    return useQuery({
        queryKey: [...HR_KEYS.payrollRuns, filters],
        queryFn: () => api.get<ListResponse<any>>('/api/v1/payroll-runs', filters),
        staleTime: 30_000,
    });
}

export function usePayrollRun(id: string | undefined) {
    return useQuery({
        queryKey: HR_KEYS.payrollRun(id ?? ''),
        queryFn: () => api.get<any>(`/api/v1/payroll-runs/${id}`),
        enabled: Boolean(id),
        staleTime: 30_000,
    });
}

export function useCreatePayrollRun() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: any) => api.post('/api/v1/payroll-runs', body),
        onSuccess: () => qc.invalidateQueries({ queryKey: HR_KEYS.payrollRuns }),
    });
}

export function useCalculatePayroll() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.post(`/api/v1/payroll-runs/${id}/calculate`, {}),
        onSuccess: (_, id) => {
            qc.invalidateQueries({ queryKey: HR_KEYS.payrollRuns });
            qc.invalidateQueries({ queryKey: HR_KEYS.payrollRun(id) });
        },
    });
}

export function usePostPayroll() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.post(`/api/v1/payroll-runs/${id}/post`, {}),
        onSuccess: (_, id) => {
            qc.invalidateQueries({ queryKey: HR_KEYS.payrollRuns });
            qc.invalidateQueries({ queryKey: HR_KEYS.payrollRun(id) });
        },
    });
}

export function useDeletePayrollRun() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/payroll-runs/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: HR_KEYS.payrollRuns }),
    });
}

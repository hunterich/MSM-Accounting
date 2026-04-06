import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';
import type { ListResponse, Employee, RawEmployee, EmployeeStatus } from '../types';

export const HR_KEYS = {
    employees: ['hrEmployees'] as const,
    employee:  (id: string) => ['hrEmployees', id] as const,
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

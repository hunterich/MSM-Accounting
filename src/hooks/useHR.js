import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';

export const HR_KEYS = {
    employees: ['hrEmployees'],
    employee:  (id) => ['hrEmployees', id],
};

// ── Status maps ───────────────────────────────────────────────────────────────

const EMP_STATUS_DOWN = { ACTIVE: 'Active', INACTIVE: 'Inactive', ON_LEAVE: 'On Leave' };
const EMP_STATUS_UP   = { Active: 'ACTIVE', Inactive: 'INACTIVE', 'On Leave': 'ON_LEAVE' };

// ── Normalizer ────────────────────────────────────────────────────────────────

function normalizeEmployee(raw) {
    return {
        id:           raw.id,
        employeeNo:   raw.employeeNo || '',
        name:         raw.name       || '',
        email:        raw.email      || '',
        phone:        raw.phone      || '',
        // Department/Position come as relations — flatten for UI compatibility
        department:   raw.department?.name || raw.department || '',
        departmentId: raw.departmentId     || raw.department?.id  || '',
        position:     raw.position?.name   || raw.position   || '',
        positionId:   raw.positionId       || raw.position?.id    || '',
        status:       EMP_STATUS_DOWN[raw.status] ?? raw.status,
        basicSalary:  Number(raw.basicSalary ?? 0),
        joinDate:     raw.joinDate ? String(raw.joinDate).slice(0, 10) : '',
        address:      raw.address || '',
    };
}

// ── Employees ─────────────────────────────────────────────────────────────────

export function useEmployees(filters = {}) {
    return useQuery({
        queryKey: [...HR_KEYS.employees, filters],
        queryFn:  () => api.get('/api/v1/employees', filters),
        select:   (res) => ({
            ...res,
            data: (res.data || []).map(normalizeEmployee),
        }),
        staleTime: 30_000,
    });
}

export function useEmployee(id) {
    return useQuery({
        queryKey: HR_KEYS.employee(id),
        queryFn:  () => api.get(`/api/v1/employees/${id}`),
        select:   normalizeEmployee,
        enabled:  Boolean(id),
        staleTime: 30_000,
    });
}

export function useCreateEmployee() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body) => api.post('/api/v1/employees', {
            ...body,
            status: EMP_STATUS_UP[body.status] ?? body.status,
        }),
        onSuccess: () => qc.invalidateQueries({ queryKey: HR_KEYS.employees }),
    });
}

export function useUpdateEmployee() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, ...updates }) => api.put(`/api/v1/employees/${id}`, {
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
        mutationFn: (id) => api.delete(`/api/v1/employees/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: HR_KEYS.employees }),
    });
}

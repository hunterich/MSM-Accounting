import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const departmentsSeed = ['Human Resources', 'Finance', 'Operations', 'Sales', 'IT'];
const positionsSeed = ['HR Staff', 'Accounting Staff', 'Supervisor', 'Manager'];

const employeesSeed = [
    {
        id: 'EMP-0001',
        name: 'Rina Pratama',
        ktp: '3174011505930001',
        dob: '1993-05-15',
        phone: '+62-812-1111-2233',
        email: 'rina.pratama@msm.com',
        address: 'Jl. Melati No. 10, Jakarta',
        joinDate: '2024-01-08',
        department: 'Finance',
        position: 'Accounting Staff',
        status: 'Active',
        type: 'Full-time',
        bankName: 'BCA',
        accountNumber: '1234567890',
        accountHolder: 'Rina Pratama',
        npwp: '12.345.678.9-012.000',
        bpjsKesehatan: '0001234567890',
        bpjsKetenagakerjaan: 'KTK0001234567',
        basicSalary: 7800000,
        allowances: [
            { id: 'allw-1', name: 'Transport', amount: 500000 },
            { id: 'allw-2', name: 'Meal', amount: 300000 }
        ],
        deductions: [
            { id: 'ded-1', name: 'BPJS', amount: 160000 }
        ]
    }
];

export const useHRStore = create(
    persist(
        (set, get) => ({
            employees: employeesSeed,
            departments: departmentsSeed,
            positions: positionsSeed,
            isLoading: false,
            error: null,

            addEmployee: async (employee) => {
                set((state) => ({ employees: [...state.employees, employee] }));
            },
            updateEmployee: async (id, updates) => {
                set((state) => ({
                    employees: state.employees.map((employee) =>
                        employee.id === id ? { ...employee, ...updates } : employee
                    ),
                }));
            },
            deleteEmployee: async (id) => {
                set((state) => ({
                    employees: state.employees.filter((employee) => employee.id !== id),
                }));
            },

            addDepartment: async (department) => {
                const value = (department || '').trim();
                if (!value) return;

                set((state) => {
                    if (state.departments.includes(value)) return state;
                    return { departments: [...state.departments, value] };
                });
            },
            addPosition: async (position) => {
                const value = (position || '').trim();
                if (!value) return;

                set((state) => {
                    if (state.positions.includes(value)) return state;
                    return { positions: [...state.positions, value] };
                });
            },

            getEmployeeById: (id) => get().employees.find((employee) => employee.id === id),
        }),
        {
            name: 'msm-hr',
            version: 1,
        }
    )
);

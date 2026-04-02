import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { List, Plus, Search } from 'lucide-react';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import StatusTag from '../../components/UI/StatusTag';
import { formatIDR } from '../../utils/formatters';
import { useEmployees } from '../../hooks/useHR';
import { useModulePermissions } from '../../hooks/useModulePermissions';

const Employees = () => {
    const navigate = useNavigate();
    const { canCreate, canEdit } = useModulePermissions('hr_employees');
    const { data: empResult, isLoading } = useEmployees();
    const employeeList = empResult?.data ?? [];
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ department: '', status: '' });

    // Build department list dynamically from API data (department.name already flattened)
    const departments = useMemo(() => {
        return Array.from(new Set(employeeList.map((e) => e.department).filter(Boolean))).sort();
    }, [employeeList]);

    const filteredData = useMemo(() => {
        const keyword = searchTerm.trim().toLowerCase();

        return employeeList.filter((employee) => {
            const matchesSearch =
                employee.name.toLowerCase().includes(keyword) ||
                (employee.employeeNo || '').toLowerCase().includes(keyword);
            const matchesDepartment = filters.department ? employee.department === filters.department : true;
            const matchesStatus = filters.status ? employee.status === filters.status : true;
            return matchesSearch && matchesDepartment && matchesStatus;
        });
    }, [employeeList, filters, searchTerm]);

    const columns = [
        { key: 'employeeNo', label: 'Employee ID' },
        { key: 'name', label: 'Name', sortable: true },
        { key: 'department', label: 'Department', sortable: true },
        { key: 'position', label: 'Position', sortable: true },
        { key: 'basicSalary', label: 'Basic Salary', align: 'right', render: (value) => formatIDR(value || 0) },
        { key: 'status', label: 'Status', render: (value) => <StatusTag status={value} /> },
        {
            key: 'actions',
            label: '',
            render: (_, row) => (
                <div className="flex gap-1.5 justify-end">
                    <Button
                        text="View"
                        size="small"
                        variant="tertiary"
                        onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/hr/employees/edit?employeeId=${row.id}&mode=view`);
                        }}
                    />
                    <Button
                        text="Edit"
                        size="small"
                        variant="tertiary"
                        disabled={!canEdit}
                        onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/hr/employees/edit?employeeId=${row.id}&mode=edit`);
                        }}
                    />
                </div>
            )
        }
    ];

    return (
        <div className="max-w-full mx-auto hr-module">
            <div className="flex flex-col gap-1.5 mb-2 relative z-[2]">
                <div className="flex gap-1.5 flex-nowrap items-center">
                    <button
                        className="border border-[#b9ddff] bg-[#e8f4ff] text-primary-700 py-2 px-3 rounded-t-lg inline-flex items-center gap-2 font-semibold cursor-pointer"
                        onClick={() => {
                            setSearchTerm('');
                            setFilters({ department: '', status: '' });
                        }}
                    >
                        <List size={16} />
                        Catalog
                    </button>
                    <button
                        className={`border border-primary-700 bg-primary-700 text-neutral-0 py-2 px-3 rounded-t-lg inline-flex items-center gap-2 font-semibold ${canCreate ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                        onClick={() => navigate('/hr/employees/new?mode=create')}
                        disabled={!canCreate}
                    >
                        <Plus size={16} />
                        New Employee
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-[minmax(280px,1fr)_220px_220px] gap-2.5 items-center bg-neutral-0 border border-neutral-200 rounded-lg p-3 mb-4">
                <div className="relative flex items-center">
                    <Search size={18} className="absolute left-2.5 text-neutral-400 pointer-events-none" />
                    <input
                        type="text"
                        className="block w-full pl-[34px] px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        placeholder="Search employee ID or name..."
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                    />
                </div>
                <div className="min-w-0">
                    <select
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={filters.department}
                        onChange={(event) => setFilters((prev) => ({ ...prev, department: event.target.value }))}
                    >
                        <option value="">Filter by Department</option>
                        {departments.map((department) => (
                            <option key={department} value={department}>{department}</option>
                        ))}
                    </select>
                </div>
                <div className="min-w-0">
                    <select
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={filters.status}
                        onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                    >
                        <option value="">Filter by Status</option>
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                    </select>
                </div>
            </div>

            <Card padding={false}>
                <Table
                    columns={columns}
                    data={filteredData}
                    onRowClick={(row) => navigate(`/hr/employees/edit?employeeId=${row.id}&mode=view`)}
                    showCount
                    countLabel="employees"
                    isLoading={isLoading}
                    loadingLabel="Loading employees..."
                />
            </Card>
        </div>
    );
};

export default Employees;

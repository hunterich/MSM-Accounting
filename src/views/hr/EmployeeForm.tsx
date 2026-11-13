import { selectCashAccounts } from '../../../lib/cash-accounts';
import { useChartOfAccounts } from '../../hooks/useGL';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { employeeSchema, zodToFormErrors } from '../../utils/formSchemas';
import FormPage from '../../components/Layout/FormPage';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import { formatIDR } from '../../utils/formatters';
import {
    useCreateEmployee,
    useUpdateEmployee,
    useEmployee,
    useDepartments,
    usePositions,
} from '../../hooks/useHR';

interface EmployeeLineItem {
    postingAccountId?: string | null;
    isFixed?: boolean | null;
    id: string;
    name: string;
    amount: number;
}

interface EmployeeFormData {
    employmentEndDate: string;
    contractEndDate: string;
    leavingReason: string;
    ptkpStatus: string;
    ptkpYear: number;
    workWeekDays: number;
    id: string;
    name: string;
    ktp: string;
    dob: string;
    phone: string;
    email: string;
    address: string;
    joinDate: string;
    department: string;
    position: string;
    status: string;
    type: string;
    bankName: string;
    accountNumber: string;
    accountHolder: string;
    npwp: string;
    bpjsKesehatan: string;
    bpjsKetenagakerjaan: string;
    basicSalary: number;
    allowances: EmployeeLineItem[];
    deductions: EmployeeLineItem[];
}

type EmployeeBucket = 'allowances' | 'deductions';
type EmployeeErrors = Record<string, string | null | undefined>;

const toNumber = (value: string | number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const createLineItem = (): EmployeeLineItem => ({
    id: `line-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    name: '',
    amount: 0,
});

const buildEmployeeState = (employee: any): EmployeeFormData => {
    if (!employee) {
        return {
            employmentEndDate: '',
            contractEndDate: '',
            leavingReason: '',
            ptkpStatus: '',
            ptkpYear: new Date().getFullYear(),
            workWeekDays: 5,
            id: '',
            name: '',
            ktp: '',
            dob: '',
            phone: '',
            email: '',
            address: '',
            joinDate: '',
            department: '',
            position: '',
            status: 'Active',
            type: 'Full-time',
            bankName: '',
            accountNumber: '',
            accountHolder: '',
            npwp: '',
            bpjsKesehatan: '',
            bpjsKetenagakerjaan: '',
            basicSalary: 0,
            allowances: [{ ...createLineItem(), name: 'Transport' }],
            deductions: [{ ...createLineItem(), name: 'BPJS' }],
        };
    }

    return {
        employmentEndDate: employee.employmentEndDate || '',
        contractEndDate: employee.contractEndDate || '',
        leavingReason: employee.leavingReason || '',
        ptkpStatus: employee.ptkpStatus || '',
        ptkpYear: employee.ptkpYear || new Date().getFullYear(),
        workWeekDays: employee.workWeekDays || 5,
        id: employee.id || '',
        name: employee.name || '',
        ktp: employee.ktp || '',
        dob: employee.dob || '',
        phone: employee.phone || '',
        email: employee.email || '',
        address: employee.address || '',
        joinDate: employee.joinDate || '',
        department: employee.department || '',
        position: employee.position || '',
        status: employee.status || 'Active',
        type: employee.type || 'Full-time',
        bankName: employee.bankName || '',
        accountNumber: employee.accountNumber || '',
        accountHolder: employee.accountHolder || '',
        npwp: employee.npwp || '',
        bpjsKesehatan: employee.bpjsKesehatan || '',
        bpjsKetenagakerjaan: employee.bpjsKetenagakerjaan || '',
        basicSalary: toNumber(employee.basicSalary),
        allowances: (employee.allowances || []).map(
            (item: any, index: number) => ({
                id: item.id || `allw-${index + 1}`,
                name: item.name || '',
                amount: toNumber(item.amount),
                postingAccountId: item.postingAccountId || null,
                isFixed: item.isFixed ?? null,
            }),
        ),
        deductions: (employee.deductions || []).map(
            (item: any, index: number) => ({
                id: item.id || `ded-${index + 1}`,
                name: item.name || '',
                amount: toNumber(item.amount),
                postingAccountId: item.postingAccountId || null,
                isFixed: item.isFixed ?? null,
            }),
        ),
    };
};

const EmployeeForm = () => {
    const navigate = useNavigate();
    const { data: deductionAccounts = [] } = useChartOfAccounts({
        withControlFlags: 1,
    });
    const [endingEmployment, setEndingEmployment] = useState(false);
    const deductionChoices = deductionAccounts.filter(
        (a) =>
            a.isActive &&
            a.isPostable &&
            !a.isPartyControlAccount &&
            !selectCashAccounts(deductionAccounts).some((c) => c.id === a.id) &&
            ['Asset', 'Liability'].includes(a.type),
    );
    const [searchParams] = useSearchParams();

    const employeeId = searchParams.get('employeeId') || '';
    const rawMode = searchParams.get('mode') || 'create';
    const mode = rawMode === 'view' || rawMode === 'edit' ? rawMode : 'create';
    const isViewMode = mode === 'view';
    const isEditMode = mode === 'edit';
    const isCreateMode = mode === 'create';

    // The employee being edited, from the API — the same source the employee
    // list links from. This used to look the id up in a browser-local store of
    // fixtures whose ids no saved employee ever matched, so View and Edit both
    // opened an empty form.
    const { data: selectedEmployee = null, isLoading: employeeLoading } =
        useEmployee(isCreateMode ? undefined : employeeId || undefined);
    const { data: departments = [] } = useDepartments();
    const { data: positions = [] } = usePositions();

    const createEmployee = useCreateEmployee();
    const updateEmployee = useUpdateEmployee();

    const isSaving = createEmployee.isPending || updateEmployee.isPending;

    const [formData, setFormData] = useState<EmployeeFormData>(() =>
        buildEmployeeState(null),
    );
    const [errors, setErrors] = useState<EmployeeErrors>({});

    // The record arrives after the first render, so seed the form when it lands.
    useEffect(() => {
        if (!selectedEmployee) return;
        setFormData(buildEmployeeState(selectedEmployee));
        setEndingEmployment(!!selectedEmployee.employmentEndDate);
    }, [selectedEmployee]);

    const handleChange = (
        event: React.ChangeEvent<
            HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >,
    ) => {
        const name = event.target.name as keyof EmployeeFormData;
        const { value } = event.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        setErrors((prev) => ({ ...prev, [name]: null }));
    };

    const handleNumberChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const name = event.target.name as keyof EmployeeFormData;
        const { value } = event.target;
        setFormData((prev) => ({ ...prev, [name]: toNumber(value) }));
        setErrors((prev) => ({ ...prev, [name]: null }));
    };

    const updateLineItem = (
        bucket: EmployeeBucket,
        id: string,
        field: keyof EmployeeLineItem,
        value: string,
    ) => {
        setFormData((prev) => ({
            ...prev,
            [bucket]: prev[bucket].map((item) =>
                item.id === id
                    ? ({
                          ...item,
                          [field]:
                              field === 'amount'
                                  ? toNumber(value)
                                  : field === 'isFixed'
                                    ? value === ''
                                        ? null
                                        : value === 'true'
                                    : value,
                      } as EmployeeLineItem)
                    : item,
            ),
        }));
    };

    const addLineItem = (bucket: EmployeeBucket) => {
        setFormData((prev) => ({
            ...prev,
            [bucket]: [...prev[bucket], createLineItem()],
        }));
    };

    const removeLineItem = (bucket: EmployeeBucket, id: string) => {
        setFormData((prev) => ({
            ...prev,
            [bucket]: prev[bucket].filter((item) => item.id !== id),
        }));
    };

    const handleSave = async () => {
        if (
            (endingEmployment || formData.status === 'Inactive') &&
            !formData.employmentEndDate
        ) {
            setErrors({ employmentEndDate: 'Enter the last working day.' });
            return;
        }
        if (formData.type === 'Contract' && !formData.contractEndDate) {
            setErrors({ contractEndDate: 'Enter the contract end date.' });
            return;
        }
        if (!formData.ptkpStatus) {
            setErrors({
                ptkpStatus: 'Select the PTKP status for this tax year.',
            });
            return;
        }
        const result = employeeSchema.safeParse(formData);
        if (!result.success) {
            setErrors(zodToFormErrors(result.error));
            return;
        }

        const normalized = {
            ...formData,
            dob: formData.dob,
            employmentEndDate: formData.employmentEndDate || null,
            contractEndDate: formData.contractEndDate || null,
            // The API assigns employeeNo itself (nextNumber). This used to send a
            // client-invented "EMP-nnnn" derived from the fixture store, which
            // the create route discarded.
            id: formData.id,
            name: formData.name.trim(),
            department: formData.department.trim(),
            position: formData.position.trim(),
            basicSalary: toNumber(formData.basicSalary),
            allowances: formData.allowances
                .filter((item) => item.name.trim() || toNumber(item.amount) > 0)
                .map((item) => ({
                    ...item,
                    name: item.name.trim(),
                    amount: toNumber(item.amount),
                    postingAccountId: item.postingAccountId || null,
                    isFixed: item.isFixed ?? null,
                })),
            deductions: formData.deductions
                .filter((item) => item.name.trim() || toNumber(item.amount) > 0)
                .map((item) => ({
                    ...item,
                    name: item.name.trim(),
                    amount: toNumber(item.amount),
                    postingAccountId: item.postingAccountId || null,
                    isFixed: item.isFixed ?? null,
                })),
        };

        try {
            if (isCreateMode) {
                await createEmployee.mutateAsync(normalized as any);
            } else if (isEditMode) {
                await updateEmployee.mutateAsync(normalized as any);
            }
            navigate('/hr/employees');
        } catch (err) {
            alert(
                `Failed to save employee: ${err instanceof Error ? err.message : 'Unknown error'}`,
            );
        }
    };

    const totalAllowances = useMemo(
        () =>
            formData.allowances.reduce(
                (sum: number, item: EmployeeLineItem) =>
                    sum + toNumber(item.amount),
                0,
            ),
        [formData.allowances],
    );
    const totalDeductions = useMemo(
        () =>
            formData.deductions.reduce(
                (sum: number, item: EmployeeLineItem) =>
                    sum + toNumber(item.amount),
                0,
            ),
        [formData.deductions],
    );
    const grossSalary =
        toNumber(formData.basicSalary) + totalAllowances - totalDeductions;

    const pageTitle = isViewMode
        ? `View Employee${employeeId ? ` ${employeeId}` : ''}`
        : isEditMode
          ? `Edit Employee${employeeId ? ` ${employeeId}` : ''}`
          : 'New Employee';

    return (
        <FormPage
            containerClassName="hr-module"
            title={pageTitle}
            backTo="/hr/employees"
            backLabel="Back to Employees"
            isLoading={employeeLoading}
            actions={
                isViewMode ? (
                    <Button
                        text="Close"
                        variant="primary"
                        onClick={() => navigate('/hr/employees')}
                    />
                ) : (
                    <>
                        <Button
                            text="Cancel"
                            variant="secondary"
                            onClick={() => navigate('/hr/employees')}
                            disabled={isSaving}
                        />
                        <Button
                            text={
                                isSaving
                                    ? 'Saving...'
                                    : isEditMode
                                      ? 'Update Employee'
                                      : 'Save Employee'
                            }
                            variant="primary"
                            onClick={handleSave}
                            disabled={isSaving}
                        />
                    </>
                )
            }
        >
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5 mt-4 border-t-3 border-t-primary-500">
                <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12">
                        <h3 className="form-section-title">
                            Personal Information
                        </h3>
                    </div>
                    <div className="col-span-4">
                        <Input
                            label="Employee Name *"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder="e.g. Andi Saputra"
                            error={errors.name}
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-2">
                        <Input
                            label="Employee ID"
                            name="id"
                            value={formData.id}
                            onChange={handleChange}
                            placeholder={isCreateMode ? 'Auto-generated' : ''}
                            disabled
                        />
                    </div>
                    <div className="col-span-3">
                        <Input
                            label="KTP"
                            name="ktp"
                            value={formData.ktp}
                            onChange={handleChange}
                            placeholder="16-digit KTP"
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-3">
                        <Input
                            label="Date of Birth"
                            type="date"
                            name="dob"
                            value={formData.dob}
                            onChange={handleChange}
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-4">
                        <Input
                            label="Phone"
                            name="phone"
                            value={formData.phone}
                            onChange={handleChange}
                            placeholder="+62-..."
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-4">
                        <Input
                            label="Email"
                            type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            placeholder="employee@msm.com"
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-4">
                        <label className="block mb-2 text-sm font-medium text-neutral-700">
                            Address
                        </label>
                        <textarea
                            name="address"
                            className="block w-full px-3 py-2 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-[78px] transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                            value={formData.address}
                            onChange={handleChange}
                            placeholder="Full address"
                            disabled={isViewMode}
                        />
                    </div>

                    <div className="col-span-12">
                        <hr className="form-divider" />
                        <h3 className="form-section-title">
                            Employment Information
                        </h3>
                    </div>
                    <div className="col-span-3">
                        <Input
                            label="Join Date *"
                            type="date"
                            name="joinDate"
                            value={formData.joinDate}
                            onChange={handleChange}
                            error={errors.joinDate}
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-3">
                        <label className="block mb-2 text-sm font-medium text-neutral-700">
                            Department *
                        </label>
                        <input
                            list="department-options"
                            name="department"
                            value={formData.department}
                            onChange={handleChange}
                            disabled={isViewMode}
                            className={`block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] ${errors.department ? 'border-danger-500' : 'border-neutral-300'}`}
                            placeholder="Select or type department"
                        />
                        <datalist id="department-options">
                            {departments.map((department) => (
                                <option
                                    key={department.id}
                                    value={department.name}
                                />
                            ))}
                        </datalist>
                        {errors.department ? (
                            <div className="w-full mt-1 text-xs text-danger-500">
                                {errors.department}
                            </div>
                        ) : null}
                    </div>
                    <div className="col-span-3">
                        <label className="block mb-2 text-sm font-medium text-neutral-700">
                            Position *
                        </label>
                        <input
                            list="position-options"
                            name="position"
                            value={formData.position}
                            onChange={handleChange}
                            disabled={isViewMode}
                            className={`block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] ${errors.position ? 'border-danger-500' : 'border-neutral-300'}`}
                            placeholder="Select or type position"
                        />
                        <datalist id="position-options">
                            {positions.map((position) => (
                                <option
                                    key={position.id}
                                    value={position.name}
                                />
                            ))}
                        </datalist>
                        {errors.position ? (
                            <div className="w-full mt-1 text-xs text-danger-500">
                                {errors.position}
                            </div>
                        ) : null}
                    </div>
                    <div className="col-span-3">
                        <label className="block mb-2 text-sm font-medium text-neutral-700">
                            Employment Type
                        </label>
                        <select
                            className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                            name="type"
                            value={formData.type}
                            onChange={handleChange}
                            disabled={isViewMode}
                        >
                            <option value="Full-time">Full-time</option>
                            <option value="Contract">Contract</option>
                        </select>
                    </div>
                    <div className="col-span-3">
                        <label className="block mb-2 text-sm font-medium text-neutral-700">
                            Status
                        </label>
                        <select
                            className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                            name="status"
                            value={formData.status}
                            onChange={handleChange}
                            disabled={isViewMode}
                        >
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                        </select>
                    </div>

                    <div className="col-span-4">
                        <Input
                            label="Contract end date"
                            type="date"
                            name="contractEndDate"
                            value={formData.contractEndDate}
                            onChange={handleChange}
                            error={errors.contractEndDate}
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-4">
                        <label>
                            PTKP status (tax year)
                            <select
                                aria-label="PTKP status"
                                name="ptkpStatus"
                                value={formData.ptkpStatus}
                                onChange={handleChange}
                                disabled={isViewMode}
                                className="block border rounded p-2 w-full"
                            >
                                <option value="">Select PTKP status</option>
                                {[
                                    'TK/0',
                                    'TK/1',
                                    'TK/2',
                                    'TK/3',
                                    'K/0',
                                    'K/1',
                                    'K/2',
                                    'K/3',
                                ].map((v) => (
                                    <option key={v}>{v}</option>
                                ))}
                            </select>
                        </label>
                        {errors.ptkpStatus && (
                            <span role="alert">{errors.ptkpStatus}</span>
                        )}
                    </div>
                    <div className="col-span-2">
                        <Input
                            label="PTKP year"
                            type="number"
                            name="ptkpYear"
                            value={formData.ptkpYear}
                            onChange={handleNumberChange}
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-2">
                        <label>
                            Working week
                            <select
                                aria-label="Working week"
                                value={formData.workWeekDays}
                                disabled={isViewMode}
                                onChange={(e) =>
                                    setFormData((p) => ({
                                        ...p,
                                        workWeekDays: Number(e.target.value),
                                    }))
                                }
                                className="block border rounded p-2"
                            >
                                <option value={5}>5 days</option>
                                <option value={6}>6 days</option>
                            </select>
                        </label>
                    </div>
                    <div className="col-span-12">
                        <label>
                            <input
                                type="checkbox"
                                checked={
                                    endingEmployment ||
                                    !!formData.employmentEndDate ||
                                    formData.status === 'Inactive'
                                }
                                disabled={isViewMode}
                                onChange={(e) => {
                                    setEndingEmployment(e.target.checked);
                                    if (!e.target.checked)
                                        setFormData((p) => ({
                                            ...p,
                                            employmentEndDate: '',
                                            leavingReason: '',
                                            status: 'Active',
                                        }));
                                }}
                            />{' '}
                            End employment / employee leaving the company
                        </label>
                    </div>
                    {(endingEmployment ||
                        !!formData.employmentEndDate ||
                        formData.status === 'Inactive') && (
                        <>
                            <div className="col-span-4">
                                <Input
                                    label="Last working day (inclusive)"
                                    type="date"
                                    name="employmentEndDate"
                                    value={formData.employmentEndDate}
                                    onChange={handleChange}
                                    error={errors.employmentEndDate}
                                    disabled={isViewMode}
                                />
                            </div>
                            <div className="col-span-8">
                                <Input
                                    label="Leaving reason"
                                    name="leavingReason"
                                    value={formData.leavingReason}
                                    onChange={handleChange}
                                    disabled={isViewMode}
                                />
                            </div>
                        </>
                    )}
                    <div className="col-span-12">
                        <hr className="form-divider" />
                        <h3 className="form-section-title">Bank Information</h3>
                    </div>
                    <div className="col-span-4">
                        <Input
                            label="Bank Name"
                            name="bankName"
                            value={formData.bankName}
                            onChange={handleChange}
                            placeholder="e.g. BCA"
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-4">
                        <Input
                            label="Account Number"
                            name="accountNumber"
                            value={formData.accountNumber}
                            onChange={handleChange}
                            placeholder="Bank account number"
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-4">
                        <Input
                            label="Account Holder"
                            name="accountHolder"
                            value={formData.accountHolder}
                            onChange={handleChange}
                            placeholder="Name on account"
                            disabled={isViewMode}
                        />
                    </div>

                    <div className="col-span-12">
                        <hr className="form-divider" />
                        <h3 className="form-section-title">Government IDs</h3>
                    </div>
                    <div className="col-span-4">
                        <Input
                            label="NPWP"
                            name="npwp"
                            value={formData.npwp}
                            onChange={handleChange}
                            placeholder="00.000.000.0-000.000"
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-4">
                        <Input
                            label="BPJS Kesehatan"
                            name="bpjsKesehatan"
                            value={formData.bpjsKesehatan}
                            onChange={handleChange}
                            placeholder="BPJS Kesehatan ID"
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-4">
                        <Input
                            label="BPJS Ketenagakerjaan"
                            name="bpjsKetenagakerjaan"
                            value={formData.bpjsKetenagakerjaan}
                            onChange={handleChange}
                            placeholder="BPJS Ketenagakerjaan ID"
                            disabled={isViewMode}
                        />
                    </div>

                    <div className="col-span-12">
                        <hr className="form-divider" />
                        <h3 className="form-section-title">Salary Structure</h3>
                    </div>
                    <div className="col-span-4">
                        <Input
                            label="Basic Salary *"
                            type="number"
                            name="basicSalary"
                            value={formData.basicSalary}
                            onChange={handleNumberChange}
                            error={errors.basicSalary}
                            disabled={isViewMode}
                        />
                    </div>

                    <div className="col-span-6">
                        <label className="block mb-2 text-sm font-medium text-neutral-700">
                            Allowances
                        </label>
                        <div className="space-y-2">
                            {formData.allowances.map((item) => (
                                <div
                                    key={item.id}
                                    className="grid grid-cols-[minmax(0,1fr)_130px_minmax(120px,1fr)_auto] gap-2"
                                >
                                    <input
                                        type="text"
                                        value={item.name}
                                        onChange={(event) =>
                                            updateLineItem(
                                                'allowances',
                                                item.id,
                                                'name',
                                                event.target.value,
                                            )
                                        }
                                        placeholder="Allowance name"
                                        disabled={isViewMode}
                                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                    />
                                    <input
                                        type="number"
                                        value={item.amount}
                                        onChange={(event) =>
                                            updateLineItem(
                                                'allowances',
                                                item.id,
                                                'amount',
                                                event.target.value,
                                            )
                                        }
                                        placeholder="0"
                                        disabled={isViewMode}
                                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                    />
                                    <select
                                        aria-label="Allowance classification"
                                        value={
                                            item.isFixed == null
                                                ? ''
                                                : String(item.isFixed)
                                        }
                                        disabled={isViewMode}
                                        onChange={(e) =>
                                            updateLineItem(
                                                'allowances',
                                                item.id,
                                                'isFixed',
                                                e.target.value,
                                            )
                                        }
                                    >
                                        <option value="">
                                            Classify allowance
                                        </option>
                                        <option value="true">Fixed</option>
                                        <option value="false">Variable</option>
                                    </select>
                                    {!isViewMode && (
                                        <Button
                                            text="Remove"
                                            size="small"
                                            variant="tertiary"
                                            onClick={() =>
                                                removeLineItem(
                                                    'allowances',
                                                    item.id,
                                                )
                                            }
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                        {!isViewMode && (
                            <div className="mt-2">
                                <Button
                                    text="Add Allowance"
                                    size="small"
                                    variant="secondary"
                                    onClick={() => addLineItem('allowances')}
                                />
                            </div>
                        )}
                    </div>

                    <div className="col-span-6">
                        <label className="block mb-2 text-sm font-medium text-neutral-700">
                            Other deductions (tax and BPJS are calculated
                            separately)
                        </label>
                        <div className="space-y-2">
                            {formData.deductions.map((item) => (
                                <div
                                    key={item.id}
                                    className="grid grid-cols-[minmax(0,1fr)_130px_minmax(120px,1fr)_auto] gap-2"
                                >
                                    <input
                                        type="text"
                                        value={item.name}
                                        onChange={(event) =>
                                            updateLineItem(
                                                'deductions',
                                                item.id,
                                                'name',
                                                event.target.value,
                                            )
                                        }
                                        placeholder="Deduction name"
                                        disabled={isViewMode}
                                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                    />
                                    <input
                                        type="number"
                                        value={item.amount}
                                        onChange={(event) =>
                                            updateLineItem(
                                                'deductions',
                                                item.id,
                                                'amount',
                                                event.target.value,
                                            )
                                        }
                                        placeholder="0"
                                        disabled={isViewMode}
                                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                    />
                                    <select
                                        aria-label="Deduction posting account"
                                        value={item.postingAccountId || ''}
                                        disabled={isViewMode}
                                        onChange={(e) =>
                                            updateLineItem(
                                                'deductions',
                                                item.id,
                                                'postingAccountId',
                                                e.target.value,
                                            )
                                        }
                                    >
                                        <option value="">
                                            Select receivable/payable
                                        </option>
                                        {item.postingAccountId &&
                                            !deductionChoices.some(
                                                (a) =>
                                                    a.id ===
                                                    item.postingAccountId,
                                            ) && (
                                                <option
                                                    value={
                                                        item.postingAccountId
                                                    }
                                                >
                                                    {item.postingAccountId}{' '}
                                                    (unavailable)
                                                </option>
                                            )}
                                        {deductionChoices.map((a) => (
                                            <option key={a.id} value={a.id}>
                                                {a.code} — {a.name}
                                            </option>
                                        ))}
                                    </select>
                                    {!isViewMode && (
                                        <Button
                                            text="Remove"
                                            size="small"
                                            variant="tertiary"
                                            onClick={() =>
                                                removeLineItem(
                                                    'deductions',
                                                    item.id,
                                                )
                                            }
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                        {!isViewMode && (
                            <div className="mt-2">
                                <Button
                                    text="Add Deduction"
                                    size="small"
                                    variant="secondary"
                                    onClick={() => addLineItem('deductions')}
                                />
                            </div>
                        )}
                    </div>

                    <div className="col-span-12">
                        <div className="bg-neutral-50 border border-neutral-200 rounded-md px-4 py-3 flex items-center justify-between">
                            <span className="text-sm text-neutral-600">
                                Basic:{' '}
                                {formatIDR(toNumber(formData.basicSalary))} |
                                Allowances: {formatIDR(totalAllowances)} |
                                Deductions: {formatIDR(totalDeductions)}
                            </span>
                            <strong className="text-lg text-primary-800">
                                Net Salary: {formatIDR(grossSalary)}
                            </strong>
                        </div>
                    </div>
                </div>
            </div>
        </FormPage>
    );
};

export default EmployeeForm;

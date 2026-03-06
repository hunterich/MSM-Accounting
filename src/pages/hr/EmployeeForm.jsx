import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import FormPage from '../../components/Layout/FormPage';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import { formatIDR } from '../../utils/formatters';
import { useHRStore } from '../../stores/useHRStore';

const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const createLineItem = () => ({
    id: `line-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    name: '',
    amount: 0,
});

const buildEmployeeState = (employee) => {
    if (!employee) {
        return {
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
            deductions: [{ ...createLineItem(), name: 'BPJS' }]
        };
    }

    return {
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
        allowances: (employee.allowances || []).map((item, index) => ({
            id: item.id || `allw-${index + 1}`,
            name: item.name || '',
            amount: toNumber(item.amount)
        })),
        deductions: (employee.deductions || []).map((item, index) => ({
            id: item.id || `ded-${index + 1}`,
            name: item.name || '',
            amount: toNumber(item.amount)
        }))
    };
};

const EmployeeForm = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const employeeId = searchParams.get('employeeId') || '';
    const rawMode = searchParams.get('mode') || 'create';
    const mode = rawMode === 'view' || rawMode === 'edit' ? rawMode : 'create';
    const isViewMode = mode === 'view';
    const isEditMode = mode === 'edit';
    const isCreateMode = mode === 'create';

    const employees = useHRStore((state) => state.employees);
    const departments = useHRStore((state) => state.departments);
    const positions = useHRStore((state) => state.positions);
    const addEmployee = useHRStore((state) => state.addEmployee);
    const updateEmployee = useHRStore((state) => state.updateEmployee);
    const addDepartment = useHRStore((state) => state.addDepartment);
    const addPosition = useHRStore((state) => state.addPosition);

    const selectedEmployee = useMemo(
        () => employees.find((employee) => employee.id === employeeId) || null,
        [employeeId, employees]
    );

    const [formData, setFormData] = useState(() => buildEmployeeState(selectedEmployee));
    const [errors, setErrors] = useState({});

    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        setErrors((prev) => ({ ...prev, [name]: null }));
    };

    const handleNumberChange = (event) => {
        const { name, value } = event.target;
        setFormData((prev) => ({ ...prev, [name]: toNumber(value) }));
        setErrors((prev) => ({ ...prev, [name]: null }));
    };

    const updateLineItem = (bucket, id, field, value) => {
        setFormData((prev) => ({
            ...prev,
            [bucket]: prev[bucket].map((item) =>
                item.id === id
                    ? { ...item, [field]: field === 'amount' ? toNumber(value) : value }
                    : item
            )
        }));
    };

    const addLineItem = (bucket) => {
        setFormData((prev) => ({
            ...prev,
            [bucket]: [...prev[bucket], createLineItem()]
        }));
    };

    const removeLineItem = (bucket, id) => {
        setFormData((prev) => ({
            ...prev,
            [bucket]: prev[bucket].filter((item) => item.id !== id)
        }));
    };

    const nextEmployeeId = () => {
        const lastSeq = employees.reduce((max, employee) => {
            const match = /^EMP-(\d+)$/i.exec(employee.id || '');
            if (!match) return max;
            return Math.max(max, Number(match[1]));
        }, 0);

        return `EMP-${String(lastSeq + 1).padStart(4, '0')}`;
    };

    const handleSave = async () => {
        const nextErrors = {};
        if (!formData.name.trim()) nextErrors.name = 'Employee name is required.';
        if (!formData.department) nextErrors.department = 'Department is required.';
        if (!formData.position) nextErrors.position = 'Position is required.';
        if (!formData.joinDate) nextErrors.joinDate = 'Join date is required.';
        if (toNumber(formData.basicSalary) < 0) nextErrors.basicSalary = 'Basic salary cannot be negative.';

        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
        }

        const normalized = {
            ...formData,
            id: isCreateMode ? nextEmployeeId() : formData.id,
            name: formData.name.trim(),
            department: formData.department.trim(),
            position: formData.position.trim(),
            basicSalary: toNumber(formData.basicSalary),
            allowances: formData.allowances
                .filter((item) => item.name.trim() || toNumber(item.amount) > 0)
                .map((item) => ({
                    ...item,
                    name: item.name.trim(),
                    amount: toNumber(item.amount)
                })),
            deductions: formData.deductions
                .filter((item) => item.name.trim() || toNumber(item.amount) > 0)
                .map((item) => ({
                    ...item,
                    name: item.name.trim(),
                    amount: toNumber(item.amount)
                }))
        };

        await addDepartment(normalized.department);
        await addPosition(normalized.position);

        if (isCreateMode) {
            await addEmployee(normalized);
        } else if (isEditMode) {
            await updateEmployee(normalized.id, normalized);
        }

        navigate('/hr/employees');
    };

    const totalAllowances = useMemo(
        () => formData.allowances.reduce((sum, item) => sum + toNumber(item.amount), 0),
        [formData.allowances]
    );
    const totalDeductions = useMemo(
        () => formData.deductions.reduce((sum, item) => sum + toNumber(item.amount), 0),
        [formData.deductions]
    );
    const grossSalary = toNumber(formData.basicSalary) + totalAllowances - totalDeductions;

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
            actions={
                isViewMode ? (
                    <Button text="Close" variant="primary" onClick={() => navigate('/hr/employees')} />
                ) : (
                    <>
                        <Button text="Cancel" variant="secondary" onClick={() => navigate('/hr/employees')} />
                        <Button text={isEditMode ? 'Update Employee' : 'Save Employee'} variant="primary" onClick={handleSave} />
                    </>
                )
            }
        >
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5 mt-4 border-t-3 border-t-primary-500">
                <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12">
                        <h3 className="form-section-title">Personal Information</h3>
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
                        <label className="block mb-2 text-sm font-medium text-neutral-700">Address</label>
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
                        <h3 className="form-section-title">Employment Information</h3>
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
                        <label className="block mb-2 text-sm font-medium text-neutral-700">Department *</label>
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
                                <option key={department} value={department} />
                            ))}
                        </datalist>
                        {errors.department ? <div className="w-full mt-1 text-xs text-danger-500">{errors.department}</div> : null}
                    </div>
                    <div className="col-span-3">
                        <label className="block mb-2 text-sm font-medium text-neutral-700">Position *</label>
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
                                <option key={position} value={position} />
                            ))}
                        </datalist>
                        {errors.position ? <div className="w-full mt-1 text-xs text-danger-500">{errors.position}</div> : null}
                    </div>
                    <div className="col-span-3">
                        <label className="block mb-2 text-sm font-medium text-neutral-700">Employment Type</label>
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
                        <label className="block mb-2 text-sm font-medium text-neutral-700">Status</label>
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
                        <label className="block mb-2 text-sm font-medium text-neutral-700">Allowances</label>
                        <div className="space-y-2">
                            {formData.allowances.map((item) => (
                                <div key={item.id} className="grid grid-cols-[1fr_180px_auto] gap-2">
                                    <input
                                        type="text"
                                        value={item.name}
                                        onChange={(event) => updateLineItem('allowances', item.id, 'name', event.target.value)}
                                        placeholder="Allowance name"
                                        disabled={isViewMode}
                                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                    />
                                    <input
                                        type="number"
                                        value={item.amount}
                                        onChange={(event) => updateLineItem('allowances', item.id, 'amount', event.target.value)}
                                        placeholder="0"
                                        disabled={isViewMode}
                                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                    />
                                    {!isViewMode && (
                                        <Button text="Remove" size="small" variant="tertiary" onClick={() => removeLineItem('allowances', item.id)} />
                                    )}
                                </div>
                            ))}
                        </div>
                        {!isViewMode && (
                            <div className="mt-2">
                                <Button text="Add Allowance" size="small" variant="secondary" onClick={() => addLineItem('allowances')} />
                            </div>
                        )}
                    </div>

                    <div className="col-span-6">
                        <label className="block mb-2 text-sm font-medium text-neutral-700">Deductions</label>
                        <div className="space-y-2">
                            {formData.deductions.map((item) => (
                                <div key={item.id} className="grid grid-cols-[1fr_180px_auto] gap-2">
                                    <input
                                        type="text"
                                        value={item.name}
                                        onChange={(event) => updateLineItem('deductions', item.id, 'name', event.target.value)}
                                        placeholder="Deduction name"
                                        disabled={isViewMode}
                                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                    />
                                    <input
                                        type="number"
                                        value={item.amount}
                                        onChange={(event) => updateLineItem('deductions', item.id, 'amount', event.target.value)}
                                        placeholder="0"
                                        disabled={isViewMode}
                                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                    />
                                    {!isViewMode && (
                                        <Button text="Remove" size="small" variant="tertiary" onClick={() => removeLineItem('deductions', item.id)} />
                                    )}
                                </div>
                            ))}
                        </div>
                        {!isViewMode && (
                            <div className="mt-2">
                                <Button text="Add Deduction" size="small" variant="secondary" onClick={() => addLineItem('deductions')} />
                            </div>
                        )}
                    </div>

                    <div className="col-span-12">
                        <div className="bg-neutral-50 border border-neutral-200 rounded-md px-4 py-3 flex items-center justify-between">
                            <span className="text-sm text-neutral-600">
                                Basic: {formatIDR(toNumber(formData.basicSalary))} | Allowances: {formatIDR(totalAllowances)} | Deductions: {formatIDR(totalDeductions)}
                            </span>
                            <strong className="text-lg text-primary-800">Net Salary: {formatIDR(grossSalary)}</strong>
                        </div>
                    </div>
                </div>
            </div>
        </FormPage>
    );
};

export default EmployeeForm;

import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { vendorSchema, zodToFormErrors } from '../../utils/formSchemas';
import FormPage from '../../components/Layout/FormPage';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import { useVendors, useCreateVendor, useUpdateVendor } from '../../hooks/useAP';
import { useChartOfAccounts } from '../../hooks/useGL';

const buildVendorState = (vendor) => {
    if (!vendor) {
        return {
            id: '',
            name: '',
            category: '',
            email: '',
            phone: '',
            paymentTerms: 'Net 30',
            npwp: '',
            defaultApAccountId: 'COA-2100',
            status: 'Active'
        };
    }

    return {
        id: vendor.id || '',
        name: vendor.name || '',
        category: vendor.category || '',
        email: vendor.email || '',
        phone: vendor.phone || '',
        paymentTerms: vendor.paymentTerms || 'Net 30',
        npwp: vendor.npwp || '',
        defaultApAccountId: vendor.defaultApAccountId || 'COA-2100',
        status: vendor.status || 'Active'
    };
};

const VendorForm = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const vendorId = searchParams.get('vendorId') || '';
    const rawMode = searchParams.get('mode') || 'create';
    const mode = rawMode === 'view' || rawMode === 'edit' ? rawMode : 'create';
    const isViewMode = mode === 'view';
    const isEditMode = mode === 'edit';
    const isCreateMode = mode === 'create';

    const { data: vendorsData, isLoading: vendorsLoading } = useVendors();
    const vendors = vendorsData?.data || [];

    const { data: chartOfAccounts = [], isLoading: chartOfAccountsLoading } = useChartOfAccounts();

    const createVendor = useCreateVendor();
    const updateVendor = useUpdateVendor();

    const selectedVendor = useMemo(() => vendors.find((vendor) => vendor.id === vendorId) || null, [vendorId, vendors]);
    const [formData, setFormData] = useState(() => buildVendorState(selectedVendor));
    const [errors, setErrors] = useState({});

    const apAccountOptions = useMemo(() => {
        return chartOfAccounts.filter(
            (account) => account.isActive && account.isPostable && account.type === 'Liability'
        );
    }, [chartOfAccounts]);

    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        setErrors((prev) => ({ ...prev, [name]: null }));
    };

    const handleSave = async () => {
        const result = vendorSchema.safeParse(formData);
        if (!result.success) { setErrors(zodToFormErrors(result.error)); return; }

        try {
            if (isCreateMode) {
                const newId = formData.id || `VEND-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
                await createVendor.mutateAsync({ ...formData, id: newId });
            } else if (isEditMode) {
                await updateVendor.mutateAsync({ id: formData.id, ...formData });
            }
            navigate('/ap/vendors');
        } catch (err) {
            window.alert(`Failed to save vendor: ${err?.message || 'Unknown error'}`);
        }
    };

    const isPending = createVendor.isPending || updateVendor.isPending;
    const isPageLoading = vendorsLoading || chartOfAccountsLoading;

    const pageTitle = isViewMode
        ? `View Vendor${vendorId ? ` ${vendorId}` : ''}`
        : mode === 'edit'
            ? `Edit Vendor${vendorId ? ` ${vendorId}` : ''}`
            : 'New Vendor';

    return (
        <FormPage
            containerClassName="ap-module"
            title={pageTitle}
            backTo="/ap/vendors"
            backLabel="Back to Vendors"
            isLoading={isPageLoading}
            actions={
                isViewMode ? (
                    <Button text="Close" variant="primary" onClick={() => navigate('/ap/vendors')} />
                ) : (
                    <>
                        <Button text="Cancel" variant="secondary" onClick={() => navigate('/ap/vendors')} />
                        <Button
                            text={isPending ? 'Saving...' : (mode === 'edit' ? 'Update Vendor' : 'Save Vendor')}
                            variant="primary"
                            onClick={handleSave}
                            disabled={isPending}
                        />
                    </>
                )
            }
        >
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5 mt-4 border-t-3 border-t-primary-500">
                <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-4">
                        <Input
                            label="Vendor Name *"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder="e.g. PT Sumber Makmur"
                            error={errors.name}
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-2">
                        <Input
                            label="Vendor Code"
                            name="id"
                            value={formData.id}
                            onChange={handleChange}
                            placeholder="e.g. VEND-005"
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-3">
                        <Input
                            label="Category *"
                            name="category"
                            value={formData.category}
                            onChange={handleChange}
                            placeholder="e.g. Utilities"
                            error={errors.category}
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-3">
                        <label className="block mb-2 text-sm font-medium text-neutral-700" style={{ display: 'block', marginBottom: '8px' }}>Status</label>
                        <select className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]" name="status" value={formData.status} onChange={handleChange} disabled={isViewMode}>
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                        </select>
                    </div>

                    <div className="col-span-4">
                        <Input
                            label="Email"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            placeholder="ap@vendor.com"
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-3">
                        <Input
                            label="Phone"
                            name="phone"
                            value={formData.phone}
                            onChange={handleChange}
                            placeholder="+62-21-xxxx"
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-3">
                        <label className="block mb-2 text-sm font-medium text-neutral-700" style={{ display: 'block', marginBottom: '8px' }}>Payment Terms</label>
                        <select className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]" name="paymentTerms" value={formData.paymentTerms} onChange={handleChange} disabled={isViewMode}>
                            <option>Due on Receipt</option>
                            <option>Net 15</option>
                            <option>Net 30</option>
                            <option>Net 45</option>
                        </select>
                    </div>
                    <div className="col-span-2">
                        <Input
                            label="NPWP"
                            name="npwp"
                            value={formData.npwp}
                            onChange={handleChange}
                            placeholder="00.000.000.0-000.000"
                            disabled={isViewMode}
                        />
                    </div>

                    <div className="col-span-6">
                        <label className="block mb-2 text-sm font-medium text-neutral-700">Default A/P Control Account *</label>
                        <select
                            className={`block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] ${errors.defaultApAccountId ? 'border-danger-500' : ''}`}
                            name="defaultApAccountId"
                            value={formData.defaultApAccountId}
                            onChange={handleChange}
                            disabled={isViewMode}
                        >
                            {apAccountOptions.map((account) => (
                                <option key={account.id} value={account.id}>
                                    {account.code} - {account.name}
                                </option>
                            ))}
                        </select>
                        {errors.defaultApAccountId ? <div className="w-full mt-1 text-xs text-danger-500">{errors.defaultApAccountId}</div> : null}
                    </div>
                </div>
            </div>
        </FormPage>
    );
};

export default VendorForm;

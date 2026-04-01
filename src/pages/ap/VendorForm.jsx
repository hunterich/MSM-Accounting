import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Button from '../../components/UI/Button';
import FormPage from '../../components/Layout/FormPage';
import Input from '../../components/UI/Input';
import { useCreateVendor, useUpdateVendor, useVendorCategories, useVendors } from '../../hooks/useAP';
import { useChartOfAccounts } from '../../hooks/useGL';

const buildNextVendorCode = (vendors) => {
    const nextNumber = vendors.reduce((max, vendor) => {
        const match = String(vendor.code || '').match(/^VND-(\d+)$/);
        return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    return `VND-${String(nextNumber).padStart(4, '0')}`;
};

const buildVendorState = (vendor, vendorCategories, fallbackAccountId, nextCode) => {
    if (!vendor) {
        return {
            recordId: '',
            code: nextCode,
            name: '',
            categoryId: vendorCategories[0]?.id || '',
            email: '',
            phone: '',
            paymentTerms: 'Net 30',
            npwp: '',
            defaultApAccountId: fallbackAccountId,
            status: 'Active',
        };
    }

    const matchedCategoryId =
        vendor.categoryId ||
        vendorCategories.find((category) => category.name === vendor.category)?.id ||
        '';

    return {
        recordId: vendor.id || '',
        code: vendor.code || nextCode,
        name: vendor.name || '',
        categoryId: matchedCategoryId,
        email: vendor.email || '',
        phone: vendor.phone || '',
        paymentTerms: vendor.paymentTerms || 'Net 30',
        npwp: vendor.npwp || '',
        defaultApAccountId: vendor.defaultApAccountId || fallbackAccountId,
        status: vendor.status || 'Active',
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
    const { data: vendorCategories = [], isLoading: vendorCategoriesLoading } = useVendorCategories();
    const { data: chartOfAccounts = [], isLoading: chartOfAccountsLoading } = useChartOfAccounts();

    const vendors = vendorsData?.data || [];
    const selectedVendor = useMemo(() => vendors.find((vendor) => vendor.id === vendorId) || null, [vendorId, vendors]);

    const apAccountOptions = useMemo(
        () => chartOfAccounts.filter(
            (account) => account.isActive && account.isPostable && String(account.type).toLowerCase() === 'liability'
        ),
        [chartOfAccounts]
    );
    const fallbackAccountId = apAccountOptions[0]?.id || '';
    const nextVendorCode = useMemo(() => buildNextVendorCode(vendors), [vendors]);

    const createVendor = useCreateVendor();
    const updateVendor = useUpdateVendor();

    const [formData, setFormData] = useState(() =>
        buildVendorState(selectedVendor, vendorCategories, fallbackAccountId, nextVendorCode)
    );
    const [errors, setErrors] = useState({});

    useEffect(() => {
        if (isCreateMode) {
            setFormData((prev) => ({
                ...prev,
                code: prev.code || nextVendorCode,
                categoryId: prev.categoryId || vendorCategories[0]?.id || '',
                defaultApAccountId: prev.defaultApAccountId || fallbackAccountId,
            }));
            return;
        }

        if (selectedVendor) {
            setFormData(buildVendorState(selectedVendor, vendorCategories, fallbackAccountId, nextVendorCode));
        }
    }, [fallbackAccountId, isCreateMode, nextVendorCode, selectedVendor, vendorCategories]);

    const handleChange = (event) => {
        const { name, value } = event.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        setErrors((prev) => ({ ...prev, [name]: null }));
    };

    const handleCategoryChange = (event) => {
        const categoryId = event.target.value;
        const selectedCategory = vendorCategories.find((category) => category.id === categoryId);
        setFormData((prev) => ({
            ...prev,
            categoryId,
            paymentTerms: selectedCategory?.defaultPaymentTerms || prev.paymentTerms,
            defaultApAccountId: selectedCategory?.defaultApAccountId || prev.defaultApAccountId || fallbackAccountId,
        }));
        setErrors((prev) => ({ ...prev, categoryId: null }));
    };

    const handleSave = async () => {
        const nextErrors = {};
        if (!formData.name.trim()) nextErrors.name = 'Vendor name is required.';
        if (!formData.code.trim()) nextErrors.code = 'Vendor code is required.';
        if (!formData.categoryId) nextErrors.categoryId = 'Category is required.';
        if (!formData.defaultApAccountId) nextErrors.defaultApAccountId = 'Default A/P account is required.';
        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
        }

        const payload = {
            code: formData.code.trim().toUpperCase(),
            name: formData.name.trim(),
            categoryId: formData.categoryId,
            email: formData.email.trim() || null,
            phone: formData.phone.trim() || null,
            paymentTerms: formData.paymentTerms || null,
            npwp: formData.npwp.trim() || null,
            defaultApAccountId: formData.defaultApAccountId,
            status: formData.status,
        };

        try {
            if (isCreateMode) {
                await createVendor.mutateAsync(payload);
            } else if (isEditMode && formData.recordId) {
                await updateVendor.mutateAsync({ id: formData.recordId, ...payload });
            }
            navigate('/ap/vendors');
        } catch (error) {
            window.alert(`Failed to save vendor: ${error?.message || 'Unknown error'}`);
        }
    };

    const isPending = createVendor.isPending || updateVendor.isPending;
    const isPageLoading = vendorsLoading || vendorCategoriesLoading || chartOfAccountsLoading;

    const pageTitle = isViewMode
        ? `View Vendor${formData.code ? ` ${formData.code}` : ''}`
        : isEditMode
            ? `Edit Vendor${formData.code ? ` ${formData.code}` : ''}`
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
                            text={isPending ? 'Saving...' : (isEditMode ? 'Update Vendor' : 'Save Vendor')}
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
                            label="Vendor Code *"
                            name="code"
                            value={formData.code}
                            onChange={handleChange}
                            placeholder="e.g. VND-0005"
                            error={errors.code}
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-3">
                        <label className="block mb-2 text-sm font-medium text-neutral-700">Category *</label>
                        <select
                            className={`block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] ${errors.categoryId ? 'border-danger-500' : 'border-neutral-300'}`}
                            name="categoryId"
                            value={formData.categoryId}
                            onChange={handleCategoryChange}
                            disabled={isViewMode}
                        >
                            <option value="">Select category</option>
                            {vendorCategories.map((category) => (
                                <option key={category.id} value={category.id}>
                                    {category.name}
                                </option>
                            ))}
                        </select>
                        {errors.categoryId ? <div className="w-full mt-1 text-xs text-danger-500">{errors.categoryId}</div> : null}
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
                        <label className="block mb-2 text-sm font-medium text-neutral-700">Payment Terms</label>
                        <select
                            className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                            name="paymentTerms"
                            value={formData.paymentTerms}
                            onChange={handleChange}
                            disabled={isViewMode}
                        >
                            <option value="Due on Receipt">Due on Receipt</option>
                            <option value="Net 15">Net 15</option>
                            <option value="Net 30">Net 30</option>
                            <option value="Net 45">Net 45</option>
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
                            className={`block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] ${errors.defaultApAccountId ? 'border-danger-500' : 'border-neutral-300'}`}
                            name="defaultApAccountId"
                            value={formData.defaultApAccountId}
                            onChange={handleChange}
                            disabled={isViewMode}
                        >
                            <option value="">Select control account</option>
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

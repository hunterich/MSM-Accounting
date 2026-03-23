import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import FormPage from '../../components/Layout/FormPage';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import { useCustomerStore } from '../../stores/useCustomerStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useCustomers, useCreateCustomer, useUpdateCustomer } from '../../hooks/useAR';

// Mock store for categories (in a real app this would be in a context or redux)
// We'll use the imported initial data for now, assuming read-only for the form unless we wire it up fully.
// Since the user might have added categories in the previous step (in memory), we can't easily share state without a real store.
// For this task, we will stick to using the imported data and acknowledge that new categories created in the other page won't appear here without a refresh/context.
// However, to make it work better for the demo, let's try to read from localStorage if we implemented it there?
// The user didn't ask for localStorage persistence, so I'll stick to the imported mock data + local state pattern.

const buildCustomerState = (customer, masterCreditSettings) => {
    if (!customer) {
        return {
            id: '',
            name: '',
            category: '', // Should default to first category if available?
            email: '',
            phone: '',
            website: '',
            paymentTerms: masterCreditSettings.defaultPaymentTerms,
            defaultDiscount: 0,
            creditLimit: masterCreditSettings.defaultLimit,
            useCategoryDefaults: false,
            address1: '',
            city: '',
            province: '',
            contactPerson: '',
            taxable: false,
            initialBalance: 0,
            status: 'Active'
        };
    }

    return {
        id: customer.id || '',
        name: customer.name || '',
        category: customer.category || '',
        email: customer.email || '',
        phone: customer.phone || '',
        website: customer.website || '',
        paymentTerms: customer.paymentTerms || 0,
        defaultDiscount: customer.defaultDiscount || 0,
        creditLimit: customer.creditLimit || 0,
        useCategoryDefaults: customer.useCategoryDefaults ?? true,
        address1: customer.address1 || customer.billingAddress || '',
        city: customer.city || '',
        province: customer.province || '',
        contactPerson: customer.contactPerson || '',
        taxable: customer.taxable || false,
        initialBalance: customer.balance || 0,
        status: customer.status || 'Active'
    };
};

const CustomerForm = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const customerId = searchParams.get('id') || '';
    const rawMode = searchParams.get('mode') || 'create';
    const mode = rawMode === 'view' || rawMode === 'edit' ? rawMode : 'create';
    const isViewMode = mode === 'view';
    const isEditMode = mode === 'edit';
    const isCreateMode = mode === 'create';

    const { data: customersData, isLoading: customersLoading } = useCustomers();
    const customers = customersData?.data || [];
    const categories = useCustomerStore(state => state.customerCategories);
    const masterCreditSettings = useSettingsStore((state) => state.customerCreditSettings);
    const createCustomer = useCreateCustomer();
    const updateCustomerMutation = useUpdateCustomer();

    const selectedCustomer = useMemo(() => customers.find((c) => c.id === customerId) || null, [customerId, customers]);
    const [formData, setFormData] = useState(() => buildCustomerState(selectedCustomer, masterCreditSettings));
    const [errors, setErrors] = useState({});

    useEffect(() => {
        if ((isEditMode || isViewMode) && selectedCustomer) {
            setFormData(buildCustomerState(selectedCustomer, masterCreditSettings));
        }
    }, [selectedCustomer, isEditMode, isViewMode, masterCreditSettings]);

    // Effect to apply category defaults when category changes
    useEffect(() => {
        if (isCreateMode && formData.category && formData.useCategoryDefaults) {
            const cat = categories.find(c => c.name === formData.category);
            if (cat) {
                setFormData(prev => ({
                    ...prev,
                    paymentTerms: cat.defaultPaymentTerms,
                    defaultDiscount: cat.defaultDiscount,
                    creditLimit: cat.defaultCreditLimit,
                    // If we want to auto-generate ID based on prefix:
                    // id: `${cat.prefix}-${Date.now().toString().slice(-4)}` // Simple auto-gen
                }));
                // We only auto-gen ID if it's empty or looks like an auto-gen
                if (!formData.id || formData.id.startsWith('CUST-') || formData.id.includes('-')) {
                    // logic to generate ID could be here, but let's do it on save or just hint it
                }
            }
        }
    }, [formData.category, formData.useCategoryDefaults, isCreateMode, categories, formData.id]);

    // Initialize default category if none selected
    useEffect(() => {
        if (isCreateMode && !formData.category && categories.length > 0) {
            setFormData(prev => ({ ...prev, category: categories[0].name }));
        }
    }, [isCreateMode, categories, formData.category]);

    // Auto-generate ID when category changes (simple version)
    useEffect(() => {
        if (isCreateMode && formData.category) {
            const cat = categories.find(c => c.name === formData.category);
            if (cat) {
                // Generate a random ID for demo purposes
                const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
                setFormData(prev => ({ ...prev, id: `${cat.prefix}-${randomNum}` }));
            }
        }
    }, [formData.category, isCreateMode, categories]);

    const handleChange = (event) => {
        const { name, value, type, checked } = event.target;
        if (name === 'useCategoryDefaults') {
            setFormData((prev) => ({
                ...prev,
                useCategoryDefaults: checked,
                ...(checked ? {} : {
                    paymentTerms: masterCreditSettings.defaultPaymentTerms,
                    creditLimit: masterCreditSettings.defaultLimit,
                }),
            }));
            setErrors((prev) => ({ ...prev, [name]: null }));
            return;
        }

        setFormData((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
        setErrors((prev) => ({ ...prev, [name]: null }));
    };

    const isSaving = createCustomer.isPending || updateCustomerMutation.isPending;
    const isPageLoading = customersLoading;

    const handleSave = async () => {
        const nextErrors = {};
        if (!formData.name.trim()) nextErrors.name = 'Customer name is required.';
        if (!formData.category) nextErrors.category = 'Category is required.';

        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
        }

        try {
            if (isCreateMode) {
                await createCustomer.mutateAsync(formData);
            } else if (isEditMode) {
                await updateCustomerMutation.mutateAsync({ id: formData.id, ...formData });
            }
            navigate('/ar/customers');
        } catch (err) {
            window.alert(`Failed to save customer: ${err?.message || 'Unknown error'}`);
        }
    };

    const pageTitle = isViewMode
        ? `View Customer${customerId ? ` ${customerId}` : ''}`
        : isEditMode
            ? `Edit Customer${customerId ? ` ${customerId}` : ''}`
            : 'New Customer';

    return (
        <FormPage
            containerClassName="ar-module"
            title={pageTitle}
            backTo="/ar/customers"
            backLabel="Back to Customers"
            isLoading={isPageLoading}
            actions={
                isViewMode ? (
                    <Button text="Close" variant="primary" onClick={() => navigate('/ar/customers')} />
                ) : (
                    <>
                        <Button text="Cancel" variant="secondary" onClick={() => navigate('/ar/customers')} disabled={isSaving} />
                        <Button text={isSaving ? 'Saving...' : (isEditMode ? 'Update Customer' : 'Save Customer')} variant="primary" onClick={handleSave} disabled={isSaving} />
                    </>
                )
            }
        >
            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5 mt-4 border-t-3 border-t-primary-500">
                <div className="grid grid-cols-12 gap-4">
                    {/* Row 1: Basic Info */}
                    <div className="col-span-4">
                        <Input
                            label="Customer Name *"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder="e.g. Acme Corp"
                            error={errors.name}
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-2">
                        <Input
                            label="Customer ID"
                            name="id"
                            value={formData.id}
                            onChange={handleChange}
                            placeholder="Auto-generated"
                            disabled={isViewMode || isCreateMode} // Usually ID is auto-gen or locked
                            helperText={isCreateMode ? "Auto-generated based on category" : ""}
                        />
                    </div>
                    <div className="col-span-3">
                        <div className="mb-4">
                            <label className="block mb-2 text-sm font-medium text-neutral-700">Category *</label>
                            <select
                                className={`block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 bg-clip-padding border ${errors.category ? 'border-danger-500' : 'border-neutral-300'} rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]`}
                                name="category"
                                value={formData.category}
                                onChange={handleChange}
                                disabled={isViewMode}
                            >
                                {categories.map(cat => (
                                    <option key={cat.id} value={cat.name}>{cat.name}</option>
                                ))}
                            </select>
                            {errors.category && <div className="w-full mt-1 text-xs text-danger-500">{errors.category}</div>}
                        </div>
                    </div>
                    <div className="col-span-3">
                        <div className="mb-4">
                            <label className="block mb-2 text-sm font-medium text-neutral-700">Status</label>
                            <select
                                className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 bg-clip-padding border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                name="status"
                                value={formData.status}
                                onChange={handleChange}
                                disabled={isViewMode}
                            >
                                <option value="Active">Active</option>
                                <option value="Inactive">Inactive</option>
                            </select>
                        </div>
                    </div>

                    {/* Row 2: Contact Info */}
                    <div className="col-span-12">
                        <hr className="form-divider" />
                        <h3 className="form-section-title">Contact Information</h3>
                    </div>

                    <div className="col-span-4">
                        <Input
                            label="Contact Person"
                            name="contactPerson"
                            value={formData.contactPerson}
                            onChange={handleChange}
                            placeholder="Primary contact name"
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-4">
                        <Input
                            label="Email"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            placeholder="billing@company.com"
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
                    <div className="col-span-6">
                        <Input
                            label="Website"
                            name="website"
                            value={formData.website}
                            onChange={handleChange}
                            placeholder="https://..."
                            disabled={isViewMode}
                        />
                    </div>

                    {/* Row 3: Financial Settings */}
                    <div className="col-span-12">
                        <hr className="form-divider" />
                        <h3 className="form-section-title">Financial Settings</h3>
                    </div>

                    <div className="col-span-12 mb-4 flex gap-6">
                        <label className="flex items-center gap-2 text-sm font-medium text-neutral-700 cursor-pointer">
                            <input
                                type="checkbox"
                                name="useCategoryDefaults"
                                checked={formData.useCategoryDefaults}
                                onChange={handleChange}
                                disabled={isViewMode}
                                className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                            />
                            <span>Use Category Defaults for Credit Limit, Terms, and Discount</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm font-medium text-neutral-700 cursor-pointer">
                            <input
                                type="checkbox"
                                name="taxable"
                                checked={formData.taxable}
                                onChange={handleChange}
                                disabled={isViewMode}
                                className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                            />
                            <span>Customer is Taxable (PPN)</span>
                        </label>
                    </div>

                    <div className="col-span-3">
                        <label className="block mb-2 text-sm font-medium text-neutral-700">Payment Terms (Days)</label>
                        <Input
                            type="number"
                            name="paymentTerms"
                            value={formData.paymentTerms}
                            onChange={handleChange}
                            disabled={isViewMode || formData.useCategoryDefaults}
                            placeholder="0"
                            helperText={!formData.useCategoryDefaults ? 'Using master credit terms from Settings.' : ''}
                        />
                    </div>
                    <div className="col-span-3">
                        <label className="block mb-2 text-sm font-medium text-neutral-700">Discount (%)</label>
                        <Input
                            type="number"
                            name="defaultDiscount"
                            value={formData.defaultDiscount}
                            onChange={handleChange}
                            disabled={isViewMode || formData.useCategoryDefaults}
                            placeholder="0"
                        />
                    </div>
                    <div className="col-span-3">
                        <label className="block mb-2 text-sm font-medium text-neutral-700">Credit Limit</label>
                        <Input
                            type="number"
                            name="creditLimit"
                            value={formData.creditLimit}
                            onChange={handleChange}
                            disabled={isViewMode || formData.useCategoryDefaults}
                            placeholder="0"
                            helperText={!formData.useCategoryDefaults ? 'Using master credit limit from Settings.' : ''}
                        />
                    </div>

                    {isCreateMode && (
                        <div className="col-span-3">
                            <label className="block mb-2 text-sm font-medium text-neutral-700">Initial Balance</label>
                            <Input
                                type="number"
                                name="initialBalance"
                                value={formData.initialBalance}
                                onChange={handleChange}
                                placeholder="0"
                                helperText="Opening balance for new customer"
                            />
                        </div>
                    )}

                    {/* Row 4: Address */}
                    <div className="col-span-12">
                        <hr className="form-divider" />
                        <h3 className="form-section-title">Address Details</h3>
                    </div>

                    <div className="col-span-12">
                        <label className="block mb-2 text-sm font-medium text-neutral-700">Address 1 (Street)</label>
                        <textarea
                            className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] py-2"
                            rows="2"
                            name="address1"
                            value={formData.address1}
                            onChange={handleChange}
                            disabled={isViewMode}
                            placeholder="Street address, building, suite..."
                        />
                    </div>
                    <div className="col-span-6">
                        <Input
                            label="City / Municipality"
                            name="city"
                            value={formData.city}
                            onChange={handleChange}
                            placeholder="e.g. Jakarta Selatan"
                            disabled={isViewMode}
                        />
                    </div>
                    <div className="col-span-6">
                        <Input
                            label="Province / Region"
                            name="province"
                            value={formData.province}
                            onChange={handleChange}
                            placeholder="e.g. DKI Jakarta"
                            disabled={isViewMode}
                        />
                    </div>
                </div>
            </div>
        </FormPage>
    );
};

export default CustomerForm;

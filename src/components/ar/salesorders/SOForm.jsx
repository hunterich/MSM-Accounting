import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import FormPage from '../../../components/Layout/FormPage';
import Input from '../../../components/UI/Input';
import Button from '../../../components/UI/Button';
import SearchableSelect from '../../../components/UI/SearchableSelect';
import { formatIDR } from '../../../utils/formatters';
import { useCustomerStore } from '../../../stores/useCustomerStore';
import { useSalesOrderStore } from '../../../stores/useSalesOrderStore';

const todayString = () => new Date().toISOString().slice(0, 10);

const emptyForm = {
    customerId: '',
    customerName: '',
    date: todayString(),
    expectedDate: '',
    status: 'Draft',
    currency: 'IDR',
    notes: '',
    shippingAddress: '',
    deliveryNotes: '',
};

const newLine = () => ({
    id: `li-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    description: '',
    qty: 1,
    unit: 'PCS',
    price: 0,
    discount: 0,
});

const calculateLineTotal = (line) => {
    const qty = Number(line.qty || 0);
    const price = Number(line.price || 0);
    const discount = Number(line.discount || 0);
    const gross = qty * price;
    return gross - (gross * (discount / 100));
};

const buildInitialForm = (salesOrder) => {
    if (!salesOrder) return emptyForm;

    return {
        customerId: salesOrder.customerId || '',
        customerName: salesOrder.customerName || '',
        date: salesOrder.date || todayString(),
        expectedDate: salesOrder.expectedDate || '',
        status: salesOrder.status || 'Draft',
        currency: salesOrder.currency || 'IDR',
        notes: salesOrder.notes || '',
        shippingAddress: salesOrder.shippingAddress || '',
        deliveryNotes: salesOrder.deliveryNotes || '',
    };
};

const SOForm = ({ mode = 'create' }) => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const soId = searchParams.get('soId') || '';

    const customers = useCustomerStore((s) => s.customers) || [];

    const salesOrders = useSalesOrderStore((s) => s.salesOrders);
    const soItemTemplates = useSalesOrderStore((s) => s.soItemTemplates);
    const addSalesOrder = useSalesOrderStore((s) => s.addSalesOrder);
    const updateSalesOrder = useSalesOrderStore((s) => s.updateSalesOrder);
    const setSoItemTemplates = useSalesOrderStore((s) => s.setSoItemTemplates);

    const selectedSalesOrder = useMemo(
        () => salesOrders.find((so) => so.id === soId) || null,
        [salesOrders, soId]
    );

    const [formData, setFormData] = useState(() => buildInitialForm(selectedSalesOrder));
    const [lineItems, setLineItems] = useState(() => {
        if (!selectedSalesOrder) return [newLine()];
        return (soItemTemplates[selectedSalesOrder.id] || []).map((line) => ({
            ...line,
            id: line.id || `li-${Date.now()}-${Math.round(Math.random() * 1000)}`,
        }));
    });
    const [errors, setErrors] = useState({});

    useEffect(() => {
        setFormData(buildInitialForm(selectedSalesOrder));

        if (selectedSalesOrder) {
            const lines = (soItemTemplates[selectedSalesOrder.id] || []).map((line) => ({
                ...line,
                id: line.id || `li-${Date.now()}-${Math.round(Math.random() * 1000)}`,
            }));
            setLineItems(lines.length > 0 ? lines : [newLine()]);
        } else {
            setLineItems([newLine()]);
        }

        setErrors({});
    }, [selectedSalesOrder, soItemTemplates]);

    const customerOptions = useMemo(() => customers.map((customer) => ({
        value: customer.id,
        label: customer.name,
        subLabel: customer.email || customer.phone || customer.id,
    })), [customers]);

    const totalAmount = useMemo(
        () => lineItems.reduce((sum, line) => sum + calculateLineTotal(line), 0),
        [lineItems]
    );

    const handleCustomerChange = (customerId) => {
        const customer = customers.find((item) => item.id === customerId);
        setFormData((prev) => ({
            ...prev,
            customerId,
            customerName: customer?.name || '',
        }));
        setErrors((prev) => ({ ...prev, customerId: null }));
    };

    const handleChange = (key, value) => {
        setFormData((prev) => ({ ...prev, [key]: value }));
        setErrors((prev) => ({ ...prev, [key]: null }));
    };

    const handleLineChange = (lineId, key, value) => {
        setLineItems((prev) => prev.map((line) => (
            line.id === lineId
                ? {
                    ...line,
                    [key]: key === 'description' || key === 'unit' ? value : Number(value || 0),
                }
                : line
        )));
    };

    const handleAddLine = () => {
        setLineItems((prev) => [...prev, newLine()]);
    };

    const handleRemoveLine = (lineId) => {
        setLineItems((prev) => {
            const next = prev.filter((line) => line.id !== lineId);
            return next.length > 0 ? next : [newLine()];
        });
    };

    const validate = () => {
        const nextErrors = {};

        if (!formData.customerId) nextErrors.customerId = 'Customer is required.';
        if (!formData.date) nextErrors.date = 'Order date is required.';
        if (!formData.expectedDate) nextErrors.expectedDate = 'Expected delivery date is required.';

        const validLines = lineItems.filter((line) => line.description.trim());
        if (validLines.length === 0) nextErrors.lineItems = 'At least one line item is required.';

        if (validLines.some((line) => Number(line.qty || 0) <= 0)) {
            nextErrors.lineItems = 'Line qty must be greater than 0.';
        }

        return nextErrors;
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        const nextErrors = validate();
        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
        }

        const cleanedLines = lineItems
            .filter((line) => line.description.trim())
            .map((line) => ({
                id: line.id,
                description: line.description.trim(),
                qty: Number(line.qty || 0),
                unit: line.unit || 'PCS',
                price: Number(line.price || 0),
                discount: Number(line.discount || 0),
            }));

        const payload = {
            customerId: formData.customerId,
            customerName: formData.customerName,
            date: formData.date,
            expectedDate: formData.expectedDate,
            status: formData.status,
            currency: formData.currency,
            amount: totalAmount,
            notes: formData.notes,
            shippingAddress: formData.shippingAddress,
            deliveryNotes: formData.deliveryNotes,
            convertedInvoiceId: selectedSalesOrder?.convertedInvoiceId || null,
        };

        if (mode === 'edit' && selectedSalesOrder) {
            await updateSalesOrder(selectedSalesOrder.id, payload);
            await setSoItemTemplates(selectedSalesOrder.id, cleanedLines);
        } else {
            const created = await addSalesOrder(payload);
            await setSoItemTemplates(created.id, cleanedLines);
        }

        navigate('/ar/sales-orders');
    };

    const isEditMode = mode === 'edit';

    return (
        <FormPage
            containerClassName="sales-order-form"
            title={isEditMode ? `Edit Sales Order${soId ? ` ${soId}` : ''}` : 'New Sales Order'}
            backTo="/ar/sales-orders"
            backLabel="Back to Sales Orders"
            actions={(
                <>
                    <Button text="Cancel" variant="secondary" onClick={() => navigate('/ar/sales-orders')} />
                    <Button text={isEditMode ? 'Update Sales Order' : 'Save Sales Order'} variant="primary" type="submit" form="sales-order-form-main" />
                </>
            )}
        >
            <form id="sales-order-form-main" onSubmit={handleSubmit} className="grid grid-cols-12 gap-4">
                {isEditMode && soId && !selectedSalesOrder ? (
                    <div className="col-span-12">
                        <div className="journal-warning-banner">
                            Sales Order `{soId}` not found. Create a new order instead.
                        </div>
                    </div>
                ) : null}

                <div className="col-span-12">
                    <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5 mt-4 border-t-3 border-t-primary-500">
                        <div className="grid grid-cols-12 gap-4">
                            <div className="col-span-6">
                                <SearchableSelect
                                    label="Customer"
                                    options={customerOptions}
                                    value={formData.customerId}
                                    onChange={handleCustomerChange}
                                    placeholder="Select customer..."
                                />
                                {errors.customerId ? <div className="w-full -mt-2 mb-2 text-xs text-danger-500">{errors.customerId}</div> : null}
                            </div>
                            <div className="col-span-3">
                                <Input
                                    label="Order Date"
                                    type="date"
                                    value={formData.date}
                                    onChange={(event) => handleChange('date', event.target.value)}
                                    error={errors.date}
                                />
                            </div>
                            <div className="col-span-3">
                                <Input
                                    label="Expected Delivery Date"
                                    type="date"
                                    value={formData.expectedDate}
                                    onChange={(event) => handleChange('expectedDate', event.target.value)}
                                    error={errors.expectedDate}
                                />
                            </div>
                            <div className="col-span-3">
                                <label className="block mb-2 text-sm font-medium text-neutral-700">Currency</label>
                                <select
                                    className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                    value={formData.currency}
                                    onChange={(event) => handleChange('currency', event.target.value)}
                                >
                                    <option value="IDR">IDR</option>
                                </select>
                            </div>
                            <div className="col-span-3">
                                <label className="block mb-2 text-sm font-medium text-neutral-700">Status</label>
                                <select
                                    className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                    value={formData.status}
                                    onChange={(event) => handleChange('status', event.target.value)}
                                >
                                    <option value="Draft">Draft</option>
                                    <option value="Confirmed">Confirmed</option>
                                    <option value="Delivered">Delivered</option>
                                    <option value="Invoiced">Invoiced</option>
                                    <option value="Closed">Closed</option>
                                </select>
                            </div>
                            <div className="col-span-6">
                                <label className="block mb-2 text-sm font-medium text-neutral-700">Notes</label>
                                <textarea
                                    className="block w-full px-3 py-2 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md transition-[border-color,box-shadow] duration-150 min-h-10 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                    rows={2}
                                    value={formData.notes}
                                    onChange={(event) => handleChange('notes', event.target.value)}
                                />
                            </div>
                            <div className="col-span-6">
                                <label className="block mb-2 text-sm font-medium text-neutral-700">Shipping Address</label>
                                <textarea
                                    className="block w-full px-3 py-2 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md transition-[border-color,box-shadow] duration-150 min-h-10 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                    rows={2}
                                    value={formData.shippingAddress}
                                    onChange={(event) => handleChange('shippingAddress', event.target.value)}
                                />
                            </div>
                            <div className="col-span-6">
                                <label className="block mb-2 text-sm font-medium text-neutral-700">Delivery Notes</label>
                                <textarea
                                    className="block w-full px-3 py-2 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md transition-[border-color,box-shadow] duration-150 min-h-10 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                                    rows={2}
                                    value={formData.deliveryNotes}
                                    onChange={(event) => handleChange('deliveryNotes', event.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-span-12">
                    <div className="bg-neutral-0 border border-neutral-200 rounded-lg overflow-hidden">
                        <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
                            <h3 className="text-base font-semibold text-neutral-800">Line Items</h3>
                            <Button text="Add Line" size="small" variant="secondary" onClick={handleAddLine} />
                        </div>

                        <div className="overflow-auto">
                            <table className="w-full border-collapse text-sm">
                                <thead>
                                    <tr>
                                        <th className="text-left p-2 border-b border-neutral-200 bg-neutral-50">Description</th>
                                        <th className="text-right p-2 border-b border-neutral-200 bg-neutral-50 w-24">Qty</th>
                                        <th className="text-left p-2 border-b border-neutral-200 bg-neutral-50 w-24">Unit</th>
                                        <th className="text-right p-2 border-b border-neutral-200 bg-neutral-50 w-40">Price</th>
                                        <th className="text-right p-2 border-b border-neutral-200 bg-neutral-50 w-24">Disc %</th>
                                        <th className="text-right p-2 border-b border-neutral-200 bg-neutral-50 w-40">Line Total</th>
                                        <th className="text-right p-2 border-b border-neutral-200 bg-neutral-50 w-24"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lineItems.map((line) => (
                                        <tr key={line.id}>
                                            <td className="p-2 border-b border-neutral-200">
                                                <input
                                                    type="text"
                                                    className="block w-full px-2 py-1 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                                                    value={line.description}
                                                    onChange={(event) => handleLineChange(line.id, 'description', event.target.value)}
                                                />
                                            </td>
                                            <td className="p-2 border-b border-neutral-200 text-right">
                                                <input
                                                    type="number"
                                                    className="block w-full px-2 py-1 text-sm leading-normal text-right text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                                                    value={line.qty}
                                                    min="0"
                                                    onChange={(event) => handleLineChange(line.id, 'qty', event.target.value)}
                                                />
                                            </td>
                                            <td className="p-2 border-b border-neutral-200">
                                                <input
                                                    type="text"
                                                    className="block w-full px-2 py-1 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                                                    value={line.unit}
                                                    onChange={(event) => handleLineChange(line.id, 'unit', event.target.value)}
                                                />
                                            </td>
                                            <td className="p-2 border-b border-neutral-200 text-right">
                                                <input
                                                    type="number"
                                                    className="block w-full px-2 py-1 text-sm leading-normal text-right text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                                                    value={line.price}
                                                    min="0"
                                                    onChange={(event) => handleLineChange(line.id, 'price', event.target.value)}
                                                />
                                            </td>
                                            <td className="p-2 border-b border-neutral-200 text-right">
                                                <input
                                                    type="number"
                                                    className="block w-full px-2 py-1 text-sm leading-normal text-right text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0"
                                                    value={line.discount}
                                                    min="0"
                                                    max="100"
                                                    onChange={(event) => handleLineChange(line.id, 'discount', event.target.value)}
                                                />
                                            </td>
                                            <td className="p-2 border-b border-neutral-200 text-right font-semibold">{formatIDR(calculateLineTotal(line))}</td>
                                            <td className="p-2 border-b border-neutral-200 text-right">
                                                <Button text="Del" size="small" variant="tertiary" onClick={() => handleRemoveLine(line.id)} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {errors.lineItems ? <div className="px-4 py-2 text-xs text-danger-500">{errors.lineItems}</div> : null}

                        <div className="px-4 py-3 border-t border-neutral-200 flex justify-end items-center gap-3">
                            <span className="text-neutral-700">Total</span>
                            <strong className="text-lg text-primary-700">{formatIDR(totalAmount)}</strong>
                        </div>
                    </div>
                </div>
            </form>
        </FormPage>
    );
};

export default SOForm;

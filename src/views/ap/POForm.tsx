import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { poSchema, zodToFormErrors } from '../../utils/formSchemas';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import SearchableSelect from '../../components/UI/SearchableSelect';
import Tabs from '../../components/UI/Tabs';
import DocumentActionBar from '../../components/UI/DocumentActionBar';
import PrintPreviewModal from '../../components/UI/PrintPreviewModal';
import PurchaseOrderPrintTemplate from '../../components/print/PurchaseOrderPrintTemplate';
import { formatIDR } from '../../utils/formatters';
import FormPage from '../../components/Layout/FormPage';
import { usePurchaseOrders, useCreatePurchaseOrder, useUpdatePurchaseOrder } from '../../hooks/useAP';
import { useVendors, useCreateVendor } from '../../hooks/useAP';
import { useChartOfAccounts } from '../../hooks/useGL';
import { usePurchaseOrderStore } from '../../stores/usePurchaseOrderStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import { X } from 'lucide-react';
import type { Account, PurchaseOrder } from '../../types';

type POFormData = {
    id: string;
    vendorId: string;
    date: string;
    expectedDate: string;
    notes: string;
};

type POTemplateLine = {
    id?: string;
    accountId?: string;
    description?: string;
    qty?: number;
    unit?: string;
    price?: number;
    discount?: number;
};

type POItem = {
    id: string;
    accountId: string;
    description: string;
    qty: number;
    unit: string;
    price: number;
    discount: number;
};

type POTemplateMap = Record<string, POTemplateLine[]>;
type FormErrors = Record<string, string | undefined>;

const buildFormData = (po: PurchaseOrder | null): POFormData => {
    if (!po) {
        return { id: '', vendorId: '', date: new Date().toISOString().split('T')[0], expectedDate: '', notes: '' };
    }
    return {
        id: po.id || '',
        vendorId: po.vendorId || '',
        date: po.date || '',
        expectedDate: po.expectedDate || '',
        notes: po.notes || ''
    };
};

const buildItems = (poId: string, expenseAccounts: Account[], templates: POTemplateMap): POItem[] => {
    const defaultAccountId = expenseAccounts[0]?.id || '';
    const source = templates[poId] || [];
    if (source.length > 0) {
        return source.map((line, index) => ({
            id: line.id || `line-${index}-${Date.now()}`,
            accountId: line.accountId || defaultAccountId,
            description: line.description || '',
            qty: line.qty || 1,
            unit: line.unit || 'pcs',
            price: line.price || 0,
            discount: Number(line.discount || 0),
        }));
    }
    return [{ id: `line-0-${Date.now()}`, accountId: defaultAccountId, description: '', qty: 1, unit: 'pcs', price: 0, discount: 0 }];
};

const POForm = () => {
    const navigate = useNavigate();
    const { canEdit } = useModulePermissions('ap_pos');
    const [searchParams] = useSearchParams();
    const poId = searchParams.get('poId') || '';
    const rawMode = searchParams.get('mode');
    const mode = rawMode === 'view' || rawMode === 'edit' ? rawMode : 'new';
    const isViewMode = mode === 'view';

    const [activeTab, setActiveTab] = useState<'items' | 'other'>('items');
    const [printOpen, setPrintOpen] = useState(false);

    const { data: posData, isLoading: purchaseOrdersLoading } = usePurchaseOrders();
    const purchaseOrders = posData?.data || [];

    const poItemTemplates = usePurchaseOrderStore((s) => s.poItemTemplates) as POTemplateMap;
    const setPoItemTemplates = usePurchaseOrderStore(s => s.setPoItemTemplates);
    const company = useSettingsStore((s) => s.companyInfo);

    const { data: chartOfAccounts = [], isLoading: chartOfAccountsLoading } = useChartOfAccounts();
    const { data: vendorsData, isLoading: vendorsLoading } = useVendors();
    const vendors = vendorsData?.data || [];

    const createPurchaseOrder = useCreatePurchaseOrder();
    const updatePurchaseOrder = useUpdatePurchaseOrder();
    const createVendor = useCreateVendor();

    const [showNewVendor, setShowNewVendor] = useState(false);
    const [newVendorName, setNewVendorName] = useState('');
    const [newVendorError, setNewVendorError] = useState('');

    const handleQuickCreateVendor = async () => {
        const trimmed = newVendorName.trim();
        if (!trimmed) { setNewVendorError('Name is required.'); return; }
        const autoCode = trimmed.replace(/\s+/g, '-').toUpperCase().slice(0, 10);
        try {
            const created = await createVendor.mutateAsync({ name: trimmed, code: autoCode }) as { id: string };
            setFormData(prev => ({ ...prev, vendorId: created.id }));
            setShowNewVendor(false);
            setNewVendorName('');
            setNewVendorError('');
            if (errors.vendorId) setErrors(prev => ({ ...prev, vendorId: undefined }));
        } catch (e) {
            setNewVendorError(e instanceof Error ? e.message : 'Failed to create vendor.');
        }
    };

    const selectedPO = useMemo<PurchaseOrder | null>(() => purchaseOrders.find((po) => po.id === poId) || null, [poId, purchaseOrders]);
    const vendorOptions = useMemo(() => vendors.map(v => ({ value: v.id, label: v.name, subLabel: v.code || '' })), [vendors]);

    const accountMap = useMemo<Record<string, Account>>(() => {
        return chartOfAccounts.reduce<Record<string, Account>>((map, account) => {
            map[account.id] = account;
            return map;
        }, {});
    }, [chartOfAccounts]);

    const expenseTargetAccounts = useMemo<Account[]>(() => {
        return chartOfAccounts.filter(
            (account) => account.isPostable && account.isActive && (account.type === 'Expense' || account.type === 'Asset')
        );
    }, [chartOfAccounts]);

    const [formData, setFormData] = useState<POFormData>(() => buildFormData(selectedPO));
    const [items, setItems] = useState<POItem[]>(() => buildItems(poId, expenseTargetAccounts, poItemTemplates));
    const [errors, setErrors] = useState<FormErrors>({});

    const globalTaxSettings = useSettingsStore(s => s.taxSettings);
    const [taxSettings, setTaxSettings] = useState({
        taxable: globalTaxSettings.enabled,
        taxInclusive: globalTaxSettings.inclusiveByDefault,
        rate: globalTaxSettings.defaultRate,
    });

    useEffect(() => {
        setFormData(buildFormData(selectedPO));
        setItems(buildItems(poId, expenseTargetAccounts, poItemTemplates));
        setErrors({});
    }, [selectedPO, poId, expenseTargetAccounts, poItemTemplates]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        if (errors[name]) setErrors((prev) => ({ ...prev, [name]: undefined }));
    };

    const updateLine = (id: string, field: keyof POItem, value: string | number) => {
        setItems((prev) => prev.map((line) => (line.id === id ? { ...line, [field]: value } : line)));
    };

    const addLine = () => {
        setItems((prev) => [
            ...prev,
            { id: `line-${prev.length}-${Date.now()}`, accountId: expenseTargetAccounts[0]?.id || '', description: '', qty: 1, unit: 'pcs', price: 0, discount: 0 }
        ]);
    };

    const removeLine = (id: string) => {
        if (items.length > 1) setItems((prev) => prev.filter((line) => line.id !== id));
    };

    const lineGross = (line: POItem) => line.qty * line.price;
    const lineTotal = (line: POItem) => Math.round(lineGross(line) * (1 - (line.discount || 0) / 100) * 100) / 100;
    const subtotalGross = items.reduce((sum, line) => sum + lineGross(line), 0);
    const subtotal = items.reduce((sum, line) => sum + lineTotal(line), 0);
    const discountTotal = Math.round((subtotalGross - subtotal) * 100) / 100;

    const taxAmount = (() => {
        if (!taxSettings.taxable) return 0;
        const rate = taxSettings.rate / 100;
        if (taxSettings.taxInclusive) return subtotal - (subtotal / (1 + rate));
        return subtotal * rate;
    })();
    const totalAmount = taxSettings.taxable && !taxSettings.taxInclusive ? subtotal + taxAmount : subtotal;

    const savePO = async (saveAsDraft = false) => {
        if (isViewMode) { navigate('/ap/pos'); return; }
        const validItems = items.filter((line) => line.description.trim() || line.price > 0 || line.qty > 1);
        const result = poSchema.safeParse({ ...formData, items: validItems });
        if (!result.success) { setErrors(zodToFormErrors(result.error)); return; }

        const newId = formData.id || `PO-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
        const finalId = isViewMode ? poId : newId;

        const finalPO = {
            vendorId: formData.vendorId,
            date: formData.date,
            expectedDate: formData.expectedDate,
            status: mode === 'edit' ? selectedPO?.status : (saveAsDraft ? ('Draft' as const) : ('Approved' as const)),
            taxRate: taxSettings.taxable ? taxSettings.rate : 0,
            taxable: taxSettings.taxable,
            taxInclusive: taxSettings.taxInclusive,
            subtotal,
            taxAmount,
            totalAmount,
            notes: formData.notes,
            lines: validItems.map((line, idx) => ({
                lineNo: idx + 1,
                ...(line.accountId && { accountId: line.accountId }),
                description: line.description.trim(),
                quantity: Number(line.qty || 0),
                unit: line.unit || 'PCS',
                price: Number(line.price || 0),
                discountPct: Number(line.discount || 0),
                lineTotal: lineTotal(line),
            })),
        };

        try {
            if (mode === 'edit' && selectedPO) {
                await updatePurchaseOrder.mutateAsync({ id: selectedPO._id || selectedPO.id, ...finalPO });
            } else {
                await createPurchaseOrder.mutateAsync(finalPO);
            }
            setPoItemTemplates(finalId, validItems);
            navigate('/ap/pos');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            window.alert(`Failed to save purchase order: ${message}`);
        }
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        await savePO(false);
    };

    const isPending = createPurchaseOrder.isPending || updatePurchaseOrder.isPending;
    const isPageLoading = purchaseOrdersLoading || chartOfAccountsLoading || vendorsLoading;
    const entityId = mode === 'new' ? undefined : (selectedPO?._id || selectedPO?.id);

    const viewExtraActions = isViewMode ? (
        <Button text="Edit Purchase Order" variant="primary" disabled={!canEdit} onClick={() => navigate(`/ap/pos/edit?poId=${poId}&mode=edit`)} />
    ) : undefined;

    return (
        <FormPage
            title={mode === 'new' ? 'New Purchase Order' : `Purchase Order ${selectedPO?.id || ''}`}
            backTo="/ap/pos"
            isLoading={isPageLoading}
            sticky
            actions={(
                <DocumentActionBar
                    entityType="PurchaseOrder"
                    entityId={entityId}
                    isSaving={isPending}
                    saveLabel={mode === 'edit' ? 'Update Purchase Order' : 'Save & Approve'}
                    onSave={isViewMode ? undefined : () => { void savePO(false); }}
                    onSaveDraft={mode === 'new' ? () => { void savePO(true); } : undefined}
                    extraActions={viewExtraActions}
                    onPrint={() => setPrintOpen(true)}
                />
            )}
        >
            <Tabs
                className="mb-1"
                active={activeTab}
                onChange={(id) => setActiveTab(id as 'items' | 'other')}
                tabs={[
                    { id: 'items', label: <>Items <span className="text-neutral-400">· {items.length}</span></> },
                    { id: 'other', label: 'Other Info' },
                ]}
            />

            <form onSubmit={handleSubmit} className="grid grid-cols-12 gap-5">
                {activeTab === 'items' && (
                    <>
                        <div className="col-span-12">
                            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5 mt-4 border-t-3 border-t-primary-500">
                                <div className="grid grid-cols-12 gap-x-5 gap-y-4">
                                    <div className="col-span-6">
                                        <label className="form-label block mb-1">Vendor <span className="text-danger-500">*</span></label>
                                        <SearchableSelect
                                            options={vendorOptions}
                                            value={formData.vendorId}
                                            onChange={(val) => {
                                                setFormData(prev => ({ ...prev, vendorId: val }));
                                                if (errors.vendorId) setErrors(prev => ({ ...prev, vendorId: undefined }));
                                                setShowNewVendor(false);
                                            }}
                                            placeholder="Select Vendor..."
                                            disabled={isViewMode}
                                            footerAction={isViewMode ? undefined : { label: 'Add new vendor', onAction: () => setShowNewVendor(v => !v) }}
                                            className="!mb-0"
                                        />
                                        {errors.vendorId && <span className="text-danger-500 text-xs mt-1 block">{errors.vendorId}</span>}
                                        {showNewVendor && (
                                            <div className="mt-2 rounded-lg border border-primary-200 bg-primary-50 p-3">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-xs font-semibold text-primary-700 uppercase tracking-wide">New Vendor</span>
                                                    <button type="button" onClick={() => { setShowNewVendor(false); setNewVendorName(''); setNewVendorError(''); }} className="text-neutral-400 hover:text-neutral-600"><X size={14} /></button>
                                                </div>
                                                <Input placeholder="Vendor name *" value={newVendorName} onChange={e => { setNewVendorName(e.target.value); setNewVendorError(''); }} className="mb-2" />
                                                {newVendorError && <div className="form-feedback invalid-feedback mb-2">{newVendorError}</div>}
                                                <Button text={createVendor.isPending ? 'Creating...' : 'Create & Select'} variant="primary" size="small" disabled={createVendor.isPending} onClick={handleQuickCreateVendor} />
                                            </div>
                                        )}
                                    </div>
                                    <div className="col-span-3">
                                        <Input label="PO Number (auto if empty)" name="id" placeholder="Auto-generate" value={formData.id} onChange={handleChange} disabled={isViewMode || mode === 'edit'} />
                                    </div>
                                    <div className="col-span-3">
                                        <Input label="Date *" name="date" type="date" value={formData.date} onChange={handleChange} disabled={isViewMode} error={errors.date} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="col-span-12">
                            <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5 mt-4">
                                <div className="flex justify-between items-center mb-4 pb-3 border-b border-neutral-100">
                                    <div className="text-base font-semibold text-neutral-800">Order Items</div>
                                    <Button text="Add Line" size="small" variant="secondary" onClick={addLine} disabled={isViewMode} />
                                </div>
                                {errors.items ? <div className="w-full mt-1 text-xs text-danger-500 mb-3">{errors.items}</div> : null}
                                <table className="w-full border-collapse text-sm">
                                    <thead>
                                        <tr>
                                            <th className="text-left p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[24%]">Description</th>
                                            <th className="text-left p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[22%]">Target Account</th>
                                            <th className="text-center p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[8%]">Qty</th>
                                            <th className="text-center p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[8%]">Unit</th>
                                            <th className="text-right p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[13%]">Price</th>
                                            <th className="text-right p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[8%]">Disc %</th>
                                            <th className="text-right p-2 border-b border-neutral-200 font-semibold text-neutral-600 w-[13%]">Line Total</th>
                                            <th className="p-2 border-b border-neutral-200 w-[4%]"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.length === 0 ? (
                                            <tr><td colSpan={8} className="text-center p-6 text-neutral-400">No items added</td></tr>
                                        ) : items.map((line) => (
                                            <tr key={line.id} className="border-b border-neutral-100">
                                                <td className="p-2">
                                                    <Input value={line.description} onChange={(e) => updateLine(line.id, 'description', e.target.value)} placeholder="Description" disabled={isViewMode} />
                                                </td>
                                                <td className="p-2">
                                                    <select
                                                        className="block w-full px-2 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-8 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] disabled:bg-neutral-100 disabled:cursor-not-allowed"
                                                        value={line.accountId}
                                                        onChange={(e) => updateLine(line.id, 'accountId', e.target.value)}
                                                        disabled={isViewMode}
                                                    >
                                                        {expenseTargetAccounts.map((account) => (
                                                            <option key={account.id} value={account.id}>{account.code} - {account.name}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td className="p-2">
                                                    <Input type="number" value={line.qty} onChange={(e) => updateLine(line.id, 'qty', Number(e.target.value))} inputClassName="min-h-8 px-2 text-sm text-center" disabled={isViewMode} />
                                                </td>
                                                <td className="p-2">
                                                    <Input value={line.unit} onChange={(e) => updateLine(line.id, 'unit', e.target.value)} inputClassName="min-h-8 px-2 text-sm text-center" disabled={isViewMode} />
                                                </td>
                                                <td className="p-2">
                                                    <Input type="number" value={line.price} onChange={(e) => updateLine(line.id, 'price', Number(e.target.value))} inputClassName="min-h-8 px-2 text-sm text-right" disabled={isViewMode} />
                                                </td>
                                                <td className="p-2">
                                                    <Input type="number" value={line.discount} onChange={(e) => updateLine(line.id, 'discount', Number(e.target.value))} inputClassName="min-h-8 px-2 text-sm text-right" disabled={isViewMode} />
                                                </td>
                                                <td className="p-2 text-right font-semibold text-neutral-800">{formatIDR(lineTotal(line))}</td>
                                                <td className="p-2 text-center">
                                                    <button onClick={() => removeLine(line.id)} className="text-danger-500 hover:text-danger-700 text-lg font-bold bg-transparent border-0 cursor-pointer" title="Remove" disabled={isViewMode}>×</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="col-span-12 flex justify-end mt-1">
                            <div className="w-[320px]">
                                <div className="p-5 bg-neutral-50 border border-neutral-200 rounded-lg">
                                    <div className="flex justify-between items-center mb-2.5">
                                        <span className="text-neutral-600">Subtotal</span>
                                        <span className="font-semibold">{formatIDR(subtotal)}</span>
                                    </div>
                                    {discountTotal > 0 && (
                                        <div className="flex justify-between items-center mb-2.5">
                                            <span className="text-neutral-600">Discount</span>
                                            <span className="font-semibold text-neutral-600">-{formatIDR(discountTotal)}</span>
                                        </div>
                                    )}
                                    {taxSettings.taxable && (
                                        <div className="flex justify-between items-center mb-2.5">
                                            <span className="text-neutral-600">Tax ({taxSettings.rate}%){taxSettings.taxInclusive ? ' incl.' : ''}</span>
                                            <span className="font-semibold text-neutral-600">{formatIDR(taxAmount)}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between items-baseline mt-2 pt-2 border-t border-neutral-200">
                                        <span className="text-[1.1rem] font-bold text-neutral-800">Total</span>
                                        <span className="text-[1.4rem] font-extrabold text-primary-700">{formatIDR(totalAmount)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {activeTab === 'other' && (
                    <div className="col-span-12 mt-4">
                        <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5">
                            <div className="grid grid-cols-12 gap-6">
                                <div className="col-span-6 flex flex-col gap-4">
                                    <Input label="Expected Date" name="expectedDate" type="date" value={formData.expectedDate} onChange={handleChange} disabled={isViewMode} />
                                    <Input label="Internal Notes" name="notes" placeholder="Notes" value={formData.notes} onChange={handleChange} disabled={isViewMode} />
                                </div>
                                <div className="col-span-6">
                                    <div className="text-sm font-semibold text-neutral-800 mb-2">Info Pajak</div>
                                    <label className="flex items-start gap-2.5 text-sm text-neutral-700 cursor-pointer py-2 border-b border-neutral-100">
                                        <input type="checkbox" checked={taxSettings.taxable}
                                            onChange={(e) => setTaxSettings(p => ({ ...p, taxable: e.target.checked }))}
                                            disabled={isViewMode} className="mt-0.5 w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500" />
                                        <span>Kena Pajak <span className="text-neutral-400 text-xs">(taxable)</span><br /><span className="text-xs text-neutral-400">Default from Settings (PPN {taxSettings.rate}%). Uncheck for a non-PKP vendor.</span></span>
                                    </label>
                                    <label className="flex items-start gap-2.5 text-sm text-neutral-700 cursor-pointer py-2 border-b border-neutral-100">
                                        <input type="checkbox" checked={taxSettings.taxInclusive}
                                            onChange={(e) => setTaxSettings(p => ({ ...p, taxInclusive: e.target.checked }))}
                                            disabled={isViewMode} className="mt-0.5 w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500" />
                                        <span>Total termasuk Pajak <span className="text-neutral-400 text-xs">(tax inclusive)</span><br /><span className="text-xs text-neutral-400">Check when the price already includes PPN.</span></span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </form>

            <PrintPreviewModal
                isOpen={printOpen}
                onClose={() => setPrintOpen(false)}
                title="Purchase Order Print Preview"
                documentTitle={`PurchaseOrder_${formData.id || poId || ''}`}
            >
                <PurchaseOrderPrintTemplate
                    purchaseOrder={{
                        id: formData.id || poId,
                        date: formData.date,
                        expectedDate: formData.expectedDate,
                        notes: formData.notes,
                        subtotal, taxAmount, totalAmount,
                    } as unknown as Record<string, unknown>}
                    lineItems={items.map((l) => ({
                        description: l.description, quantity: l.qty, unit: l.unit, price: l.price, lineTotal: lineTotal(l),
                    })) as unknown as Record<string, unknown>[]}
                    vendorName={vendorOptions.find((v) => v.value === formData.vendorId)?.label || '-'}
                    company={company as unknown as Record<string, unknown>}
                />
            </PrintPreviewModal>
        </FormPage>
    );
};

export default POForm;

import React, { useState, useMemo, useCallback } from 'react';
import Modal from '../../UI/Modal';
import Button from '../../UI/Button';
import Table from '../../UI/Table';
import SearchableSelect from '../../UI/SearchableSelect';
import StatusTag from '../../UI/StatusTag';
import { Upload, CheckCircle, AlertTriangle, ArrowLeft, ArrowRight, Loader } from 'lucide-react';
import { useIntegrationStore } from '../../../stores/useIntegrationStore';
import { useInvoiceStore } from '../../../stores/useInvoiceStore';
import { usePaymentStore } from '../../../stores/usePaymentStore';
import { useInventoryStore } from '../../../stores/useInventoryStore';
import { useCustomerStore } from '../../../stores/useCustomerStore';
import { parseShopeeExcel, transformOrdersToInvoices, buildProductKey } from '../../../utils/shopeeImport';
import { formatIDR } from '../../../utils/formatters';

const STEPS = ['upload', 'preview', 'mapping', 'configure', 'importing', 'done'];

const ImportInvoicesModal = ({ isOpen, onClose }) => {
    const shops = useIntegrationStore((s) => s.shops);
    const updateItemMappings = useIntegrationStore((s) => s.updateItemMappings);

    const invoices = useInvoiceStore((s) => s.invoices);
    const addInvoicesBatch = useInvoiceStore((s) => s.addInvoicesBatch);
    const updateInvoicesBatch = useInvoiceStore((s) => s.updateInvoicesBatch);
    const setInvoiceItemTemplatesBatch = useInvoiceStore((s) => s.setInvoiceItemTemplatesBatch);

    const addPaymentsBatch = usePaymentStore((s) => s.addPaymentsBatch);
    const updatePaymentsBatch = usePaymentStore((s) => s.updatePaymentsBatch);

    const products = useInventoryStore((s) => s.products);
    const customers = useCustomerStore((s) => s.customers);

    const [step, setStep] = useState('upload');
    const [shopId, setShopId] = useState('');
    const [file, setFile] = useState(null);
    const [parseResult, setParseResult] = useState(null);
    const [parsing, setParsing] = useState(false);
    const [parseError, setParseError] = useState('');

    // Item mapping state: { [productKey]: inventoryItemId }
    const [localMappings, setLocalMappings] = useState({});
    const [showAllMappings, setShowAllMappings] = useState(false);

    // Configure state
    const [invoiceStatus, setInvoiceStatus] = useState('Paid');
    const [dateField, setDateField] = useState('completionDate');

    // Import state
    const [importPhase, setImportPhase] = useState('');
    const [importResult, setImportResult] = useState(null);

    const selectedShop = useMemo(() => shops.find(s => s.id === shopId), [shops, shopId]);

    const activeShops = useMemo(() =>
        shops.filter(s => s.status === 'Active'),
        [shops]
    );

    const shopOptions = useMemo(() =>
        activeShops.map(s => ({ value: s.id, label: `${s.platform} — ${s.name}` })),
        [activeShops]
    );

    const productOptions = useMemo(() =>
        products.map(p => ({ value: p.id, label: p.name })),
        [products]
    );

    const resetAll = useCallback(() => {
        setStep('upload');
        setShopId('');
        setFile(null);
        setParseResult(null);
        setParsing(false);
        setParseError('');
        setLocalMappings({});
        setShowAllMappings(false);
        setInvoiceStatus('Paid');
        setDateField('completionDate');
        setImportPhase('');
        setImportResult(null);
    }, []);

    const handleClose = () => {
        resetAll();
        onClose();
    };

    // Step 1: Parse file
    const handleFileSelect = async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setFile(f);
        setParseError('');
        setParsing(true);

        try {
            const shop = shops.find(s => s.id === shopId);
            const result = await parseShopeeExcel(f, shop?.importStatusFilter || 'Selesai');

            if (result.warnings.length > 0 && result.parsedOrders.length === 0) {
                setParseError(result.warnings[0]);
                setParsing(false);
                return;
            }

            setParseResult(result);

            // Initialize local mappings from saved shop mappings
            const saved = shop?.itemMappings || {};
            setLocalMappings({ ...saved });

            setParsing(false);
            setStep('preview');
        } catch (err) {
            setParseError(`Failed to parse file: ${err.message}`);
            setParsing(false);
        }
    };

    // Preview table data
    const previewData = useMemo(() => {
        if (!parseResult) return [];
        return parseResult.parsedOrders.map(o => ({
            orderNumber: o.orderNumber,
            buyer: o.buyerUsername || o.recipientName,
            itemCount: o.items.length,
            totalProductAmount: o.totalProductAmount,
            date: o.completionDate || o.paymentDate || o.orderDate,
            paymentMethod: o.paymentMethod,
        }));
    }, [parseResult]);

    const previewColumns = [
        { key: 'orderNumber', label: 'Order #', sortable: true },
        { key: 'buyer', label: 'Buyer', sortable: true },
        { key: 'itemCount', label: 'Items', align: 'right' },
        { key: 'totalProductAmount', label: 'Amount', align: 'right', render: (val) => formatIDR(val) },
        { key: 'date', label: 'Date', sortable: true },
        { key: 'paymentMethod', label: 'Payment' },
    ];

    // Item mapping: filter to unmapped only unless showing all
    const mappingItems = useMemo(() => {
        if (!parseResult) return [];
        const items = parseResult.uniqueProducts;
        if (showAllMappings) return items;
        return items.filter(p => !localMappings[p.key]);
    }, [parseResult, localMappings, showAllMappings]);

    const mappedCount = useMemo(() => {
        if (!parseResult) return 0;
        return parseResult.uniqueProducts.filter(p => localMappings[p.key]).length;
    }, [parseResult, localMappings]);

    const handleMappingChange = (productKey, inventoryItemId) => {
        setLocalMappings(prev => ({ ...prev, [productKey]: inventoryItemId }));
    };

    // Step 5: Execute import
    const handleImport = async () => {
        setStep('importing');

        try {
            const shop = shops.find(s => s.id === shopId);
            const cust = customers.find(c => c.id === shop.customer);

            setImportPhase('Preparing invoices...');
            const result = transformOrdersToInvoices(parseResult.parsedOrders, {
                customerId: shop.customer,
                customerName: cust?.name || 'Unknown',
                shopId: shop.id,
                invoiceStatus,
                dateField,
                holdingAccount: shop.holdingAccount,
                itemMappings: localMappings,
                inventoryProducts: products,
            }, invoices);

            // Phase 1: Save item mappings
            setImportPhase('Saving item mappings...');
            await new Promise(r => setTimeout(r, 50));
            updateItemMappings(shopId, localMappings);

            // Phase 2: Insert new invoices
            if (result.newInvoices.length > 0) {
                setImportPhase(`Creating ${result.newInvoices.length} new invoices...`);
                await new Promise(r => setTimeout(r, 50));
                addInvoicesBatch(result.newInvoices);
            }

            // Phase 3: Update existing invoices
            if (result.updatedInvoices.length > 0) {
                setImportPhase(`Updating ${result.updatedInvoices.length} existing invoices...`);
                await new Promise(r => setTimeout(r, 50));
                updateInvoicesBatch(result.updatedInvoices);
            }

            // Phase 4: Set item templates
            setImportPhase('Setting item details...');
            await new Promise(r => setTimeout(r, 50));
            setInvoiceItemTemplatesBatch(result.invoiceItemsMap);

            // Phase 5: Create/update payments
            if (result.payments.length > 0) {
                setImportPhase(`Creating ${result.payments.length} payments...`);
                await new Promise(r => setTimeout(r, 50));
                addPaymentsBatch(result.payments);
            }
            if (result.updatedPayments.length > 0) {
                setImportPhase(`Updating ${result.updatedPayments.length} payments...`);
                await new Promise(r => setTimeout(r, 50));
                updatePaymentsBatch(result.updatedPayments);
            }

            setImportResult(result.stats);
            setStep('done');
        } catch (err) {
            setImportPhase(`Error: ${err.message}`);
        }
    };

    // --- Render steps ---

    const renderUpload = () => (
        <div className="flex flex-col gap-4">
            <div>
                <label className="form-label">Shop Connection</label>
                <SearchableSelect
                    options={shopOptions}
                    value={shopId}
                    onChange={setShopId}
                    placeholder="Select shop..."
                />
                {selectedShop && (
                    <div className="mt-2 text-xs text-neutral-500">
                        Customer: <strong>{customers.find(c => c.id === selectedShop.customer)?.name || selectedShop.customer}</strong>
                        {' | '}Filter: <strong>{selectedShop.importStatusFilter === 'All' ? 'All Statuses' : 'Selesai Only'}</strong>
                    </div>
                )}
            </div>

            {shopId && (
                <div>
                    <label className="form-label">Excel File (.xlsx)</label>
                    <div className="border-2 border-dashed border-neutral-300 rounded-lg p-6 text-center">
                        <Upload size={32} className="mx-auto mb-2 text-neutral-400" />
                        <p className="text-sm text-neutral-500 mb-3">
                            {file ? file.name : 'Select Shopee payment report file'}
                        </p>
                        <label className="inline-block">
                            <input
                                type="file"
                                accept=".xlsx,.xls"
                                className="hidden"
                                onChange={handleFileSelect}
                                disabled={parsing}
                            />
                            <span className="inline-flex items-center gap-1 px-4 py-2 bg-primary-500 text-white text-sm rounded-md cursor-pointer hover:bg-primary-600">
                                {parsing ? <><Loader size={14} className="animate-spin" /> Parsing...</> : 'Select File'}
                            </span>
                        </label>
                    </div>
                    {parseError && (
                        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 flex gap-2">
                            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                            {parseError}
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    const renderPreview = () => (
        <div className="flex flex-col gap-4">
            {/* Stats */}
            <div className="grid grid-cols-4 gap-3">
                {[
                    { label: 'Total Rows', value: parseResult.stats.totalRows.toLocaleString() },
                    { label: 'Orders', value: parseResult.stats.totalOrders.toLocaleString() },
                    { label: 'Skipped', value: parseResult.stats.skippedRows.toLocaleString() },
                    { label: 'Total Amount', value: formatIDR(parseResult.stats.totalAmount) },
                ].map(s => (
                    <div key={s.label} className="bg-neutral-50 rounded-md p-3 text-center">
                        <div className="text-xs text-neutral-500">{s.label}</div>
                        <div className="text-sm font-semibold mt-1">{s.value}</div>
                    </div>
                ))}
            </div>

            {/* Warnings */}
            {parseResult.warnings.length > 0 && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
                    <strong>{parseResult.warnings.length} warning(s):</strong>
                    <ul className="mt-1 list-disc list-inside">
                        {parseResult.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                        {parseResult.warnings.length > 5 && <li>...and {parseResult.warnings.length - 5} more</li>}
                    </ul>
                </div>
            )}

            {/* Preview table */}
            <div style={{ maxHeight: 350 }}>
                <Table columns={previewColumns} data={previewData} maxHeight={350} />
            </div>
        </div>
    );

    const renderMapping = () => (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <div className="text-sm text-neutral-600">
                    <strong>{mappedCount}</strong> of <strong>{parseResult?.uniqueProducts.length || 0}</strong> products mapped
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                        type="checkbox"
                        checked={showAllMappings}
                        onChange={(e) => setShowAllMappings(e.target.checked)}
                    />
                    Show all (including mapped)
                </label>
            </div>

            <div className="text-xs text-neutral-500">
                Map Shopee products to your inventory items. Unmapped items will use the Shopee product name as-is.
            </div>

            <div className="flex flex-col gap-2" style={{ maxHeight: 380, overflowY: 'auto' }}>
                {mappingItems.length === 0 ? (
                    <div className="text-center py-8 text-neutral-400 text-sm">
                        {showAllMappings ? 'No products found.' : 'All products are mapped!'}
                    </div>
                ) : (
                    mappingItems.map((item) => (
                        <div key={item.key} className="grid grid-cols-2 gap-3 items-center py-2 border-b border-neutral-100">
                            <div className="text-sm truncate" title={item.key}>
                                {item.key}
                            </div>
                            <SearchableSelect
                                options={productOptions}
                                value={localMappings[item.key] || ''}
                                onChange={(val) => handleMappingChange(item.key, val)}
                                placeholder="Select item..."
                            />
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    const renderConfigure = () => {
        // Run transform to get preview stats
        const shop = shops.find(s => s.id === shopId);
        const cust = customers.find(c => c.id === shop?.customer);
        const preview = transformOrdersToInvoices(parseResult.parsedOrders, {
            customerId: shop?.customer,
            customerName: cust?.name || 'Unknown',
            shopId: shop?.id,
            invoiceStatus,
            dateField,
            holdingAccount: shop?.holdingAccount,
            itemMappings: localMappings,
            inventoryProducts: products,
        }, invoices);

        return (
            <div className="flex flex-col gap-4">
                <div>
                    <label className="form-label">Invoice Status</label>
                    <div className="flex gap-4">
                        {['Paid', 'Unpaid'].map(s => (
                            <label key={s} className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="invoiceStatus"
                                    value={s}
                                    checked={invoiceStatus === s}
                                    onChange={() => setInvoiceStatus(s)}
                                />
                                <StatusTag status={s} />
                            </label>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="form-label">Invoice Date From</label>
                    <select
                        className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                        value={dateField}
                        onChange={(e) => setDateField(e.target.value)}
                    >
                        <option value="completionDate">Order Completion Date</option>
                        <option value="paymentDate">Payment Date</option>
                        <option value="orderDate">Order Creation Date</option>
                    </select>
                </div>

                {/* Import summary */}
                <div className="bg-neutral-50 rounded-lg p-4 mt-2">
                    <h4 className="text-sm font-semibold mb-3">Import Summary</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="text-neutral-500">New invoices:</div>
                        <div className="font-medium">{preview.stats.newCount.toLocaleString()}</div>
                        <div className="text-neutral-500">Invoices to update:</div>
                        <div className="font-medium">{preview.stats.updateCount.toLocaleString()}</div>
                        <div className="text-neutral-500">Payments:</div>
                        <div className="font-medium">{preview.stats.paymentCount.toLocaleString()}</div>
                        <div className="text-neutral-500">Total amount:</div>
                        <div className="font-semibold">{formatIDR(preview.stats.totalAmount)}</div>
                    </div>
                </div>
            </div>
        );
    };

    const renderImporting = () => (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader size={40} className="animate-spin text-primary-500" />
            <p className="text-sm text-neutral-600">{importPhase}</p>
            <p className="text-xs text-neutral-400">Do not close this window.</p>
        </div>
    );

    const renderDone = () => (
        <div className="flex flex-col items-center justify-center py-8 gap-4">
            <CheckCircle size={48} className="text-green-500" />
            <h3 className="text-lg font-semibold">Import Complete!</h3>
            {importResult && (
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <div className="text-neutral-500">New invoices:</div>
                    <div className="font-medium">{importResult.newCount.toLocaleString()}</div>
                    <div className="text-neutral-500">Updated invoices:</div>
                    <div className="font-medium">{importResult.updateCount.toLocaleString()}</div>
                    <div className="text-neutral-500">Payments:</div>
                    <div className="font-medium">{importResult.paymentCount.toLocaleString()}</div>
                    <div className="text-neutral-500">Total amount:</div>
                    <div className="font-semibold">{formatIDR(importResult.totalAmount)}</div>
                </div>
            )}
        </div>
    );

    const stepIndex = STEPS.indexOf(step);
    const stepTitles = ['Upload File', 'Preview Data', 'Item Mapping', 'Configure', 'Importing...', 'Complete'];

    const canGoNext = () => {
        if (step === 'upload') return false; // handled by file select
        if (step === 'preview') return true;
        if (step === 'mapping') return true;
        if (step === 'configure') return true;
        return false;
    };

    const handleNext = () => {
        const idx = STEPS.indexOf(step);
        if (step === 'configure') {
            handleImport();
        } else if (idx < STEPS.length - 1) {
            setStep(STEPS[idx + 1]);
        }
    };

    const handleBack = () => {
        const idx = STEPS.indexOf(step);
        if (idx > 0) setStep(STEPS[idx - 1]);
    };

    return (
        <Modal
            title={`Import Shopee Invoices — ${stepTitles[stepIndex] || ''}`}
            isOpen={isOpen}
            onClose={step === 'importing' ? undefined : handleClose}
            size="lg"
        >
            {/* Step indicators */}
            <div className="flex gap-1 mb-4">
                {STEPS.slice(0, 4).map((s, i) => (
                    <div
                        key={s}
                        className={`h-1 flex-1 rounded-full ${i <= Math.min(stepIndex, 3) ? 'bg-primary-500' : 'bg-neutral-200'}`}
                    />
                ))}
            </div>

            <div style={{ minHeight: 300 }}>
                {step === 'upload' && renderUpload()}
                {step === 'preview' && renderPreview()}
                {step === 'mapping' && renderMapping()}
                {step === 'configure' && renderConfigure()}
                {step === 'importing' && renderImporting()}
                {step === 'done' && renderDone()}
            </div>

            {/* Footer */}
            {step !== 'importing' && (
                <div className="flex justify-between mt-4 pt-4 border-t border-neutral-200">
                    <div>
                        {stepIndex > 0 && stepIndex < 4 && (
                            <Button text="Back" variant="tertiary" icon={<ArrowLeft size={14} />} onClick={handleBack} />
                        )}
                    </div>
                    <div className="flex gap-2">
                        {step === 'done' ? (
                            <Button text="Close" variant="primary" onClick={handleClose} />
                        ) : step === 'configure' ? (
                            <Button
                                text={`Import ${parseResult?.stats.totalOrders.toLocaleString() || 0} Invoices`}
                                variant="primary"
                                onClick={handleImport}
                            />
                        ) : canGoNext() ? (
                            <Button text="Next" variant="primary" icon={<ArrowRight size={14} />} onClick={handleNext} />
                        ) : null}
                    </div>
                </div>
            )}
        </Modal>
    );
};

export default ImportInvoicesModal;

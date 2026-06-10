import React, { useState, useMemo, useCallback } from 'react';
import Modal from '../../UI/Modal';
import Button from '../../UI/Button';
import Table from '../../UI/Table';
import SearchableSelect from '../../UI/SearchableSelect';
import StatusTag from '../../UI/StatusTag';
import { Upload, CheckCircle, AlertTriangle, ArrowLeft, ArrowRight, Loader, PackageX } from 'lucide-react';
import { useEcommerceConnections, useUpdateEcommerceConnection } from '../../../hooks/useIntegrations';
import { useInvoiceStore } from '../../../stores/useInvoiceStore';
import { usePaymentStore } from '../../../stores/usePaymentStore';
import { useInventoryStore } from '../../../stores/useInventoryStore';
import { useCustomerStore } from '../../../stores/useCustomerStore';
import { useItems } from '../../../hooks/useInventory';
import {
    parseShopeeExcel,
    transformOrdersToInvoices,
    computeStockDeficits,
    type ShopeeParseResult,
    type StockDeficit,
    type HeaderResolution,
} from '../../../utils/shopeeImport';
import { formatIDR } from '../../../utils/formatters';
import type { EcommerceConnection } from '../../../types';

// ── Wizard step discriminated union ──────────────────────────────────────────

type WizardStep =
    | 'upload'
    | 'preview'
    | 'mapping'
    | 'configure'
    | 'importing'
    | 'done';

const STEPS: WizardStep[] = ['upload', 'preview', 'mapping', 'configure', 'importing', 'done'];

// ── Import stats shape ────────────────────────────────────────────────────────

interface ImportStats {
    newCount: number;
    updateCount: number;
    totalAmount: number;
    paymentCount: number;
}

// ── Component props ───────────────────────────────────────────────────────────

interface ImportInvoicesModalProps {
    isOpen: boolean;
    onClose: () => void;
}

// ── Preview row for the Table component ──────────────────────────────────────

interface PreviewRow {
    orderNumber: string;
    buyer: string;
    itemCount: number;
    totalProductAmount: number;
    date: string | null | undefined;
    paymentMethod: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

const ImportInvoicesModal: React.FC<ImportInvoicesModalProps> = ({ isOpen, onClose }) => {
    const { data: connectionsData } = useEcommerceConnections();
    const shops: EcommerceConnection[] = connectionsData?.data ?? [];
    const updateConnection = useUpdateEcommerceConnection();

    const invoices = useInvoiceStore((s) => s.invoices);
    const addInvoicesBatch = useInvoiceStore((s) => s.addInvoicesBatch);
    const updateInvoicesBatch = useInvoiceStore((s) => s.updateInvoicesBatch);
    const setInvoiceItemTemplatesBatch = useInvoiceStore((s) => s.setInvoiceItemTemplatesBatch);

    const addPaymentsBatch = usePaymentStore((s) => s.addPaymentsBatch);
    const updatePaymentsBatch = usePaymentStore((s) => s.updatePaymentsBatch);

    const products = useInventoryStore((s) => s.products);
    const customers = useCustomerStore((s) => s.customers);
    const { data: itemsData } = useItems({ limit: 200 });

    const [step, setStep] = useState<WizardStep>('upload');
    const [shopId, setShopId] = useState<string>('');
    const [file, setFile] = useState<File | null>(null);
    const [parseResult, setParseResult] = useState<ShopeeParseResult | null>(null);
    const [parsing, setParsing] = useState<boolean>(false);
    const [parseError, setParseError] = useState<string>('');
    const [headerReport, setHeaderReport] = useState<HeaderResolution | null>(null);

    // Item mapping state: { [productKey]: inventoryItemId }
    const [localMappings, setLocalMappings] = useState<Record<string, string>>({});
    const [showAllMappings, setShowAllMappings] = useState<boolean>(false);

    // Configure state
    const [invoiceStatus, setInvoiceStatus] = useState<string>('Paid');
    const [dateField, setDateField] = useState<string>('completionDate');

    // Import state
    const [importPhase, setImportPhase] = useState<string>('');
    const [importResult, setImportResult] = useState<ImportStats | null>(null);

    const selectedShop = useMemo<EcommerceConnection | undefined>(
        () => shops.find((s) => s.id === shopId),
        [shops, shopId],
    );

    const platformName = selectedShop?.platform || 'Marketplace';

    const activeShops = useMemo<EcommerceConnection[]>(
        () => shops.filter((s) => s.status === 'Active'),
        [shops],
    );

    const shopOptions = useMemo(
        () => activeShops.map((s) => ({ value: s.id, label: `${s.platform} — ${s.name}` })),
        [activeShops],
    );

    const productOptions = useMemo(
        () => products.map((p) => ({ value: p.id as string, label: p.name as string })),
        [products],
    );

    const resetAll = useCallback(() => {
        setStep('upload');
        setShopId('');
        setFile(null);
        setParseResult(null);
        setParsing(false);
        setParseError('');
        setHeaderReport(null);
        setLocalMappings({});
        setShowAllMappings(false);
        setInvoiceStatus('Paid');
        setDateField('completionDate');
        setImportPhase('');
        setImportResult(null);
    }, []);

    const handleClose = (): void => {
        resetAll();
        onClose();
    };

    // Step 1: Parse file
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
        const f = e.target.files?.[0];
        if (!f) return;
        setFile(f);
        setParseError('');
        setHeaderReport(null);
        setParsing(true);

        try {
            const shop = shops.find((s) => s.id === shopId);
            const result = await parseShopeeExcel(f, shop?.importStatusFilter || 'Selesai');

            if (result.parsedOrders.length === 0) {
                setParseError(result.warnings[0] || 'No orders could be parsed from this file.');
                setHeaderReport(result.headerReport);
                setParsing(false);
                return;
            }

            setParseResult(result);
            setHeaderReport(result.headerReport);

            // Initialize local mappings from saved shop mappings
            const saved = shop?.itemMappings || {};
            setLocalMappings({ ...saved });

            setParsing(false);
            setStep('preview');
        } catch (err) {
            setParseError(`Failed to parse file: ${(err as Error).message}`);
            setParsing(false);
        }
    };

    // Preview table data
    const previewData = useMemo<PreviewRow[]>(() => {
        if (!parseResult) return [];
        return parseResult.parsedOrders.map((o) => ({
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
        { key: 'itemCount', label: 'Items', align: 'right' as const },
        { key: 'totalProductAmount', label: 'Amount', align: 'right' as const, render: (val: unknown) => formatIDR(val as number) },
        { key: 'date', label: 'Date', sortable: true },
        { key: 'paymentMethod', label: 'Payment' },
    ];

    // Item mapping: filter to unmapped only unless showing all
    const mappingItems = useMemo(() => {
        if (!parseResult) return [];
        const items = parseResult.uniqueProducts;
        if (showAllMappings) return items;
        return items.filter((p) => !localMappings[p.key]);
    }, [parseResult, localMappings, showAllMappings]);

    const mappedCount = useMemo<number>(() => {
        if (!parseResult) return 0;
        return parseResult.uniqueProducts.filter((p) => localMappings[p.key]).length;
    }, [parseResult, localMappings]);

    const stockDeficits = useMemo<StockDeficit[]>(() => {
        if (!parseResult || !itemsData?.data) return [];
        const invItems = itemsData.data.map((i) => ({
            id: i.id,
            name: i.name,
            currentStock: i.currentStock,
        }));
        return computeStockDeficits(parseResult.parsedOrders, localMappings, invItems);
    }, [parseResult, localMappings, itemsData]);

    const handleMappingChange = (productKey: string, inventoryItemId: string): void => {
        setLocalMappings((prev) => ({ ...prev, [productKey]: inventoryItemId }));
    };

    // Step 5: Execute import
    const handleImport = async (): Promise<void> => {
        setStep('importing');

        try {
            const shop = shops.find((s) => s.id === shopId);
            if (!shop || !parseResult) return;
            const cust = customers.find((c) => (c as { id: string }).id === shop.customer);

            setImportPhase('Preparing invoices...');
            const result = transformOrdersToInvoices(
                parseResult.parsedOrders,
                {
                    customerId: shop.customer,
                    customerName: (cust as { name?: string } | undefined)?.name || 'Unknown',
                    shopId: shop.id,
                    platform: shop.platform,
                    invoiceStatus,
                    dateField: dateField as 'completionDate' | 'paymentDate' | 'orderDate',
                    holdingAccount: shop.holdingAccount,
                    itemMappings: localMappings,
                    inventoryProducts: products as Array<{ id: string; name: string; [key: string]: unknown }>,
                },
                invoices,
            );

            // Phase 1: Save item mappings
            setImportPhase('Saving item mappings...');
            await new Promise<void>((r) => setTimeout(r, 50));
            await updateConnection.mutateAsync({
                id: shopId,
                itemMappings: localMappings,
            });

            // Store `E` type is `{id:string} & Record<string,unknown>`; cast our
            // typed structs through `unknown` to satisfy the store interface.
            type StoreE = { id: string } & Record<string, unknown>;

            // Phase 2: Insert new invoices
            if (result.newInvoices.length > 0) {
                setImportPhase(`Creating ${result.newInvoices.length} new invoices...`);
                await new Promise<void>((r) => setTimeout(r, 50));
                addInvoicesBatch(result.newInvoices as unknown as StoreE[]);
            }

            // Phase 3: Update existing invoices
            if (result.updatedInvoices.length > 0) {
                setImportPhase(`Updating ${result.updatedInvoices.length} existing invoices...`);
                await new Promise<void>((r) => setTimeout(r, 50));
                updateInvoicesBatch(result.updatedInvoices as unknown as StoreE[]);
            }

            // Phase 4: Set item templates
            setImportPhase('Setting item details...');
            await new Promise<void>((r) => setTimeout(r, 50));
            setInvoiceItemTemplatesBatch(result.invoiceItemsMap as unknown as Record<string, StoreE[]>);

            // Phase 5: Create/update payments
            if (result.payments.length > 0) {
                setImportPhase(`Creating ${result.payments.length} payments...`);
                await new Promise<void>((r) => setTimeout(r, 50));
                addPaymentsBatch(result.payments as unknown as StoreE[]);
            }
            if (result.updatedPayments.length > 0) {
                setImportPhase(`Updating ${result.updatedPayments.length} payments...`);
                await new Promise<void>((r) => setTimeout(r, 50));
                updatePaymentsBatch(result.updatedPayments as unknown as StoreE[]);
            }

            setImportResult(result.stats);
            setStep('done');
        } catch (err) {
            setImportPhase(`Error: ${(err as Error).message}`);
        }
    };

    // ── Render steps ──────────────────────────────────────────────────────────

    const renderUpload = (): React.ReactElement => (
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
                        Customer: <strong>{(customers as Array<{ id: string; name?: string }>).find((c) => c.id === selectedShop.customer)?.name || selectedShop.customer}</strong>
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
                            {file ? file.name : `Select ${platformName} order export file`}
                        </p>
                        <label className="inline-block">
                            <input
                                type="file"
                                accept=".xlsx,.xls"
                                className="hidden"
                                onChange={handleFileSelect}
                                disabled={parsing || updateConnection.isPending}
                            />
                            <span className="inline-flex items-center gap-1 px-4 py-2 bg-primary-500 text-white text-sm rounded-md cursor-pointer hover:bg-primary-600">
                                {parsing ? <><Loader size={14} className="animate-spin" /> Parsing...</> : 'Select File'}
                            </span>
                        </label>
                    </div>
                    {parseError && (
                        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                            <div className="flex gap-2">
                                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    <div className="font-medium">{parseError}</div>
                                    {headerReport && headerReport.missingRequired.length > 0 && (
                                        <div className="mt-3 space-y-2 text-xs">
                                            <div>
                                                <div className="font-semibold text-red-800">Missing required columns:</div>
                                                <ul className="list-disc list-inside mt-1">
                                                    {headerReport.missingRequired.map((m) => (
                                                        <li key={m.internalKey}>
                                                            <strong>{m.expected[0]}</strong>
                                                            {m.expected.length > 1 && (
                                                                <span className="text-red-600"> (or: {m.expected.slice(1).join(', ')})</span>
                                                            )}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                            {headerReport.actualHeaders.length > 0 && (
                                                <details className="mt-2">
                                                    <summary className="cursor-pointer text-red-800 font-semibold">
                                                        Headers found in file ({headerReport.actualHeaders.length})
                                                    </summary>
                                                    <div className="mt-1 p-2 bg-white border border-red-100 rounded text-red-700 font-mono text-[11px] leading-relaxed break-words">
                                                        {headerReport.actualHeaders.join(' · ')}
                                                    </div>
                                                </details>
                                            )}
                                            <div className="text-red-600 italic">
                                                If {platformName}&rsquo;s export format has changed, please report the new column names so they can be added to the parser.
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    const renderPreview = (): React.ReactElement => (
        <div className="flex flex-col gap-4">
            {/* Stats */}
            <div className="grid grid-cols-4 gap-3">
                {[
                    { label: 'Total Rows', value: parseResult!.stats.totalRows.toLocaleString() },
                    { label: 'Orders', value: parseResult!.stats.totalOrders.toLocaleString() },
                    { label: 'Skipped', value: parseResult!.stats.skippedRows.toLocaleString() },
                    { label: 'Total Amount', value: formatIDR(parseResult!.stats.totalAmount) },
                ].map((s) => (
                    <div key={s.label} className="bg-neutral-50 rounded-md p-3 text-center">
                        <div className="text-xs text-neutral-500">{s.label}</div>
                        <div className="text-sm font-semibold mt-1">{s.value}</div>
                    </div>
                ))}
            </div>

            {/* Header format drift notice */}
            {headerReport && (headerReport.missingOptional.length > 0 || headerReport.unknownHeaders.length > 0) && (
                <details className="p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-800">
                    <summary className="cursor-pointer font-medium">
                        File format notes
                        {headerReport.missingOptional.length > 0 && ` · ${headerReport.missingOptional.length} optional column(s) missing`}
                        {headerReport.unknownHeaders.length > 0 && ` · ${headerReport.unknownHeaders.length} unknown column(s)`}
                    </summary>
                    <div className="mt-2 space-y-2 text-xs">
                        {headerReport.missingOptional.length > 0 && (
                            <div>
                                <div className="font-semibold">Optional columns not found (fields will be blank):</div>
                                <div className="mt-1 text-blue-700">
                                    {headerReport.missingOptional.map((m) => m.expected[0]).join(', ')}
                                </div>
                            </div>
                        )}
                        {headerReport.unknownHeaders.length > 0 && (
                            <div>
                                <div className="font-semibold">Columns in file that were not recognised:</div>
                                <div className="mt-1 text-blue-700 font-mono text-[11px] break-words">
                                    {headerReport.unknownHeaders.join(' · ')}
                                </div>
                                <div className="mt-1 italic text-blue-600">
                                    These are ignored. If any contain data you need, report them so the parser can be updated.
                                </div>
                            </div>
                        )}
                    </div>
                </details>
            )}

            {/* Row-level warnings */}
            {parseResult!.warnings.length > 0 && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
                    <strong>{parseResult!.warnings.length} warning(s):</strong>
                    <ul className="mt-1 list-disc list-inside">
                        {parseResult!.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                        {parseResult!.warnings.length > 5 && <li>...and {parseResult!.warnings.length - 5} more</li>}
                    </ul>
                </div>
            )}

            {/* Preview table */}
            <div style={{ maxHeight: 350 }}>
                <Table columns={previewColumns} data={previewData as unknown as Record<string, unknown>[]} maxHeight={350} />
            </div>
        </div>
    );

    const renderMapping = (): React.ReactElement => (
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
                Map {platformName} products to your inventory items. Unmapped items will use the {platformName} product name as-is.
            </div>

            <div className="flex flex-col gap-2" style={{ maxHeight: 380, overflowY: 'auto' }}>
                {mappingItems.length === 0 ? (
                    <div className="text-center py-8 text-neutral-400 text-sm">
                        {showAllMappings ? 'No products found.' : 'All products are mapped!'}
                    </div>
                ) : (
                    mappingItems.map((item) => {
                        const mappedId = localMappings[item.key];
                        const invItem = mappedId ? itemsData?.data?.find((i) => i.id === mappedId) : undefined;
                        const isDeficit = mappedId ? stockDeficits.some((d) => d.itemId === mappedId) : false;
                        return (
                            <div key={item.key} className="grid grid-cols-2 gap-3 items-start py-2 border-b border-neutral-100">
                                <div className="text-sm truncate pt-1" title={item.key}>
                                    {item.key}
                                </div>
                                <div>
                                    <SearchableSelect
                                        options={productOptions}
                                        value={mappedId || ''}
                                        onChange={(val: string) => handleMappingChange(item.key, val)}
                                        placeholder="Select item..."
                                    />
                                    {invItem && (
                                        <div className={`flex items-center gap-1 mt-1 text-[11px] ${isDeficit ? 'text-amber-600' : 'text-neutral-400'}`}>
                                            {isDeficit && <AlertTriangle size={11} />}
                                            Stock: {invItem.currentStock.toLocaleString()}
                                            {isDeficit && ` — deficit: −${stockDeficits.find((d) => d.itemId === mappedId)!.deficit}`}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );

    const renderConfigure = (): React.ReactElement => {
        // Run transform to get preview stats
        const shop = shops.find((s) => s.id === shopId);
        const cust = customers.find((c) => (c as { id: string }).id === shop?.customer);
        const preview = transformOrdersToInvoices(
            parseResult!.parsedOrders,
            {
                customerId: shop?.customer ?? '',
                customerName: (cust as { name?: string } | undefined)?.name || 'Unknown',
                shopId: shop?.id ?? '',
                platform: shop?.platform,
                invoiceStatus,
                dateField: dateField as 'completionDate' | 'paymentDate' | 'orderDate',
                holdingAccount: shop?.holdingAccount,
                itemMappings: localMappings,
                inventoryProducts: products as Array<{ id: string; name: string; [key: string]: unknown }>,
            },
            invoices,
        );

        return (
            <div className="flex flex-col gap-4">
                <div>
                    <label className="form-label">Invoice Status</label>
                    <div className="flex gap-4">
                        {['Paid', 'Unpaid'].map((s) => (
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

                {stockDeficits.length > 0 && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
                        <div className="flex items-center gap-2 font-semibold mb-2">
                            <AlertTriangle size={14} />
                            {stockDeficits.length} item{stockDeficits.length > 1 ? 's' : ''} will go negative after import
                        </div>
                        <ul className="list-disc list-inside space-y-0.5 text-xs">
                            {stockDeficits.map((d) => (
                                <li key={d.itemId}>
                                    <strong>{d.itemName}</strong>: need {d.totalRequired}, have {d.currentStock} (deficit: −{d.deficit})
                                </li>
                            ))}
                        </ul>
                        <p className="mt-2 text-xs text-amber-700">Import will proceed — adjust stock afterward if needed.</p>
                    </div>
                )}
            </div>
        );
    };

    const renderImporting = (): React.ReactElement => (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader size={40} className="animate-spin text-primary-500" />
            <p className="text-sm text-neutral-600">{importPhase}</p>
            <p className="text-xs text-neutral-400">Do not close this window.</p>
        </div>
    );

    const renderDone = (): React.ReactElement => (
        <div className="flex flex-col items-center justify-center py-8 gap-4 w-full">
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
            {stockDeficits.length > 0 && (
                <div className="w-full p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
                    <div className="flex items-center gap-2 font-semibold mb-2">
                        <PackageX size={14} />
                        {stockDeficits.length} item{stockDeficits.length > 1 ? 's' : ''} went negative
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 text-xs">
                        {stockDeficits.map((d) => (
                            <li key={d.itemId}>
                                <strong>{d.itemName}</strong>: −{d.deficit} units below zero
                            </li>
                        ))}
                    </ul>
                    <p className="mt-2 text-xs text-amber-700">Use Stock Adjustments to correct inventory if needed.</p>
                </div>
            )}
        </div>
    );

    const stepIndex = STEPS.indexOf(step);
    const stepTitles: Record<WizardStep, string> = {
        upload: 'Upload File',
        preview: 'Preview Data',
        mapping: 'Item Mapping',
        configure: 'Configure',
        importing: 'Importing...',
        done: 'Complete',
    };

    const canGoNext = (): boolean => {
        if (step === 'upload') return false; // handled by file select
        if (step === 'preview') return true;
        if (step === 'mapping') return true;
        if (step === 'configure') return true;
        return false;
    };

    const handleNext = (): void => {
        const idx = STEPS.indexOf(step);
        if (step === 'configure') {
            void handleImport();
        } else if (idx < STEPS.length - 1) {
            setStep(STEPS[idx + 1]);
        }
    };

    const handleBack = (): void => {
        const idx = STEPS.indexOf(step);
        if (idx > 0) setStep(STEPS[idx - 1]);
    };

    return (
        <Modal
            title={`Import ${platformName} Invoices — ${stepTitles[step] || ''}`}
            isOpen={isOpen}
            onClose={step === 'importing' ? () => { /* blocked during import */ } : handleClose}
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
                                onClick={() => void handleImport()}
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

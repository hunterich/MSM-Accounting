import React, { useState, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import Modal from '../../UI/Modal';
import Button from '../../UI/Button';
import Table from '../../UI/Table';
import SearchableSelect from '../../UI/SearchableSelect';
import StatusTag from '../../UI/StatusTag';
import { Upload, CheckCircle, AlertTriangle, ArrowLeft, ArrowRight, Loader, PackageX, XCircle } from 'lucide-react';
import {
    useEcommerceConnections,
    useUpdateEcommerceConnection,
    useImportMarketplaceOrders,
    type MarketplaceImportResult,
} from '../../../hooks/useIntegrations';
import { useItems, useCreateItem } from '../../../hooks/useInventory';
import { detectPlatformFromHeaders } from '../../../utils/marketplaceFormat';
import { normalizeHeader } from '../../../utils/headerUtils';
import {
    parseShopeeExcel,
    buildProductKey,
    type ShopeeParseResult,
    type UniqueProduct,
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

// ── SKU classification ────────────────────────────────────────────────────────

/** A product whose SKU matched an inactive inventory item — its orders will be
 *  rejected server-side and cannot be created/mapped. */
interface InactiveBlocked {
    product: UniqueProduct;
    sku: string;
    itemName: string;
    orderCount: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

const ImportInvoicesModal: React.FC<ImportInvoicesModalProps> = ({ isOpen, onClose }) => {
    const { data: connectionsData } = useEcommerceConnections();
    const shops: EcommerceConnection[] = connectionsData?.data ?? [];
    const updateConnection = useUpdateEcommerceConnection();
    const importMutation = useImportMarketplaceOrders();

    // Active items (default list) — used for SKU auto-matching.
    const { data: itemsData, refetch: refetchItems } = useItems({ limit: 1000 });
    // Inactive items — fetched separately so we can flag SKUs that map to a
    // disabled product (the server rejects those orders).
    const { data: inactiveItemsData } = useItems({ limit: 1000, isActive: 'false' });
    const createItem = useCreateItem();

    const [step, setStep] = useState<WizardStep>('upload');
    const [shopId, setShopId] = useState<string>('');
    const [file, setFile] = useState<File | null>(null);
    const [parseResult, setParseResult] = useState<ShopeeParseResult | null>(null);
    const [parsing, setParsing] = useState<boolean>(false);
    const [parseError, setParseError] = useState<string>('');
    const [headerReport, setHeaderReport] = useState<HeaderResolution | null>(null);

    // Item mapping state: { [productKey]: inventoryItemId }
    const [localMappings, setLocalMappings] = useState<Record<string, string>>({});
    const [creatingItems, setCreatingItems] = useState<boolean>(false);
    const [createError, setCreateError] = useState<string>('');

    // Configure state
    const [recordPayment, setRecordPayment] = useState<boolean>(true);
    const [dateField, setDateField] = useState<'completionDate' | 'paymentDate' | 'orderDate'>('completionDate');

    // Import state
    const [importResult, setImportResult] = useState<MarketplaceImportResult | null>(null);
    const [importError, setImportError] = useState<string>('');

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

    // Inventory item options for the manual fallback dropdown.
    const itemOptions = useMemo(
        () => (itemsData?.data ?? []).map((i) => ({ value: i.id, label: `${i.sku ? `[${i.sku}] ` : ''}${i.name}` })),
        [itemsData],
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
        setCreatingItems(false);
        setCreateError('');
        setRecordPayment(true);
        setDateField('completionDate');
        setImportResult(null);
        setImportError('');
    }, []);

    const handleClose = (): void => {
        resetAll();
        onClose();
    };

    // ── SKU → inventory lookups ────────────────────────────────────────────────

    /** Map<normalizedSku, item id> for ACTIVE items. */
    const activeBySku = useMemo<Map<string, { id: string }>>(() => {
        const m = new Map<string, { id: string }>();
        for (const it of itemsData?.data ?? []) {
            const norm = normalizeHeader(it.sku || '');
            if (norm && !m.has(norm)) m.set(norm, { id: it.id });
        }
        return m;
    }, [itemsData]);

    /** Map<normalizedSku, item name> for INACTIVE items. */
    const inactiveBySku = useMemo<Map<string, { id: string; name: string }>>(() => {
        const m = new Map<string, { id: string; name: string }>();
        for (const it of inactiveItemsData?.data ?? []) {
            const norm = normalizeHeader(it.sku || '');
            if (norm && !m.has(norm)) m.set(norm, { id: it.id, name: it.name });
        }
        return m;
    }, [inactiveItemsData]);

    /** A product's SKU for inventory lookup — same precedence as buildProductKey. */
    const productSku = (p: UniqueProduct): string => p.parentSKU || p.skuReference || '';

    /** How many orders contain a line whose product key matches `key`. */
    const orderCountForKey = useCallback(
        (key: string): number => {
            if (!parseResult) return 0;
            let count = 0;
            for (const order of parseResult.parsedOrders) {
                if (order.items.some((it) => buildProductKey(it) === key)) count++;
            }
            return count;
        },
        [parseResult],
    );

    /** Best price seen for a product (per-unit, after discount) — used when
     *  bulk-creating a new inventory item. */
    const priceByKey = useMemo<Map<string, number>>(() => {
        const m = new Map<string, number>();
        if (!parseResult) return m;
        for (const order of parseResult.parsedOrders) {
            for (const it of order.items) {
                const key = buildProductKey(it);
                if (!m.has(key) && it.priceAfterDiscount > 0) m.set(key, it.priceAfterDiscount);
            }
        }
        return m;
    }, [parseResult]);

    // Classify every unique product: inactive-blocked vs unmatched (vs auto-mapped).
    const inactiveBlocked = useMemo<InactiveBlocked[]>(() => {
        if (!parseResult) return [];
        const out: InactiveBlocked[] = [];
        for (const p of parseResult.uniqueProducts) {
            const sku = productSku(p);
            const norm = normalizeHeader(sku);
            // Already mapped to an active item → not blocked.
            if (localMappings[p.key]) continue;
            // Active match takes precedence over inactive.
            if (norm && activeBySku.has(norm)) continue;
            if (norm && inactiveBySku.has(norm)) {
                out.push({
                    product: p,
                    sku,
                    itemName: inactiveBySku.get(norm)!.name,
                    orderCount: orderCountForKey(p.key),
                });
            }
        }
        return out;
    }, [parseResult, localMappings, activeBySku, inactiveBySku, orderCountForKey]);

    const inactiveKeys = useMemo<Set<string>>(
        () => new Set(inactiveBlocked.map((b) => b.product.key)),
        [inactiveBlocked],
    );

    /** Products with no mapping, no active match, and not inactive-blocked. */
    const unmatched = useMemo<UniqueProduct[]>(() => {
        if (!parseResult) return [];
        return parseResult.uniqueProducts.filter((p) => {
            if (localMappings[p.key]) return false;
            const norm = normalizeHeader(productSku(p));
            if (norm && activeBySku.has(norm)) return false;
            if (inactiveKeys.has(p.key)) return false;
            return true;
        });
    }, [parseResult, localMappings, activeBySku, inactiveKeys]);

    // ── Step 1: Parse file (with platform detection) ───────────────────────────

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
        const f = e.target.files?.[0];
        if (!f) return;
        setFile(f);
        setParseError('');
        setHeaderReport(null);
        setParsing(true);

        try {
            const shop = shops.find((s) => s.id === shopId);

            // Detect platform from the workbook's first-sheet header row.
            const buf = await f.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array' });
            const headerRow = (XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0] as string[]) || [];
            const detected = detectPlatformFromHeaders(headerRow, wb.SheetNames[0]);
            if (detected && shop && detected !== shop.platform) {
                setParseError(
                    `This looks like a ${detected} export, but the selected store "${shop.name}" is ${shop.platform}. Upload the matching file.`,
                );
                setParsing(false);
                return;
            }

            const result = await parseShopeeExcel(f, shop?.importStatusFilter || 'Selesai', shop?.platform);

            if (result.parsedOrders.length === 0) {
                setParseError(result.warnings[0] || 'No orders could be parsed from this file.');
                setHeaderReport(result.headerReport);
                setParsing(false);
                return;
            }

            setParseResult(result);
            setHeaderReport(result.headerReport);

            // Seed mappings: saved shop mappings, then SKU auto-match against
            // active inventory items.
            const saved = shop?.itemMappings || {};
            const auto: Record<string, string> = { ...saved };
            for (const p of result.uniqueProducts) {
                if (auto[p.key]) continue;
                const norm = normalizeHeader(p.parentSKU || p.skuReference || '');
                if (norm && activeBySku.has(norm)) {
                    auto[p.key] = activeBySku.get(norm)!.id;
                }
            }
            setLocalMappings(auto);

            setParsing(false);
            setStep('preview');
        } catch (err) {
            setParseError(`Failed to parse file: ${(err as Error).message}`);
            setParsing(false);
        }
    };

    // ── Preview table data ─────────────────────────────────────────────────────

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

    const mappedCount = useMemo<number>(() => {
        if (!parseResult) return 0;
        return parseResult.uniqueProducts.filter((p) => {
            if (localMappings[p.key]) return true;
            const norm = normalizeHeader(productSku(p));
            return Boolean(norm && activeBySku.has(norm));
        }).length;
    }, [parseResult, localMappings, activeBySku]);

    const handleMappingChange = (productKey: string, inventoryItemId: string): void => {
        setLocalMappings((prev) => ({ ...prev, [productKey]: inventoryItemId }));
    };

    // ── Step 2: Bulk-create all unmatched products as inventory items ──────────

    const handleCreateAll = async (): Promise<void> => {
        if (unmatched.length === 0) return;
        setCreatingItems(true);
        setCreateError('');
        const created: Record<string, string> = {};
        try {
            for (const p of unmatched) {
                const sku = productSku(p);
                const name = p.variationName
                    ? `${p.productName} - ${p.variationName}`
                    : p.productName;
                const res = await createItem.mutateAsync({
                    sku,
                    name,
                    type: 'PRODUCT',
                    unit: 'PCS',
                    sellingPrice: priceByKey.get(p.key) ?? 0,
                    costPrice: 0,
                    openingStock: 0,
                    isActive: true,
                });
                const newId = (res as { id?: string } | undefined)?.id;
                if (newId) created[p.key] = newId;
            }
            setLocalMappings((prev) => ({ ...prev, ...created }));
            await refetchItems();
        } catch (err) {
            setCreateError(`Failed to create items: ${(err as Error).message}`);
        } finally {
            setCreatingItems(false);
        }
    };

    // ── Step 4: Build payload + POST to the backend ────────────────────────────

    const handleImport = async (): Promise<void> => {
        const shop = shops.find((s) => s.id === shopId);
        if (!shop || !parseResult) return;

        setImportError('');
        setStep('importing');

        try {
            // Persist the resolved item mappings on the connection for next time.
            await updateConnection.mutateAsync({ id: shopId, itemMappings: localMappings });

            // Build the endpoint payload from parsed orders.
            const orders = parseResult.parsedOrders.map((order) => {
                const issueDate =
                    order[dateField] ||
                    order.completionDate ||
                    order.paymentDate ||
                    order.orderDate ||
                    new Date().toISOString().split('T')[0];

                const lines = order.items.map((item) => {
                    const key = buildProductKey(item);
                    return {
                        // Falls back to '' for inactive-blocked SKUs — the server
                        // rejects the order and reports it in `failed`.
                        itemId: localMappings[key] ?? '',
                        description: item.variationName
                            ? `${item.productName} - ${item.variationName}`
                            : item.productName,
                        sku: item.parentSKU || item.skuReference || '',
                        quantity: item.quantity,
                        // Unit price AFTER discount — matches the invoice line
                        // price used by the legacy transform.
                        unitPrice: item.priceAfterDiscount,
                    };
                });

                return { orderNo: order.orderNumber, issueDate: issueDate as string, lines };
            });

            const res = await importMutation.mutateAsync({
                connectionId: shopId,
                orders,
                options: { customerId: shop.customer, recordPayment },
            });

            setImportResult(res);
            setStep('done');
        } catch (err) {
            setImportError((err as Error).message || 'Import failed.');
            setStep('configure');
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
                        Customer: <strong>{selectedShop.customerName || selectedShop.customer}</strong>
                        {' | '}Filter: <strong>{selectedShop.importStatusFilter === 'All' ? 'All Statuses' : 'Completed Only'}</strong>
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
                                disabled={parsing}
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
                    <strong>{mappedCount}</strong> of <strong>{parseResult?.uniqueProducts.length || 0}</strong> products matched by SKU
                </div>
            </div>

            <div className="text-xs text-neutral-500">
                Products are matched to your inventory by SKU. Create any that are new, then continue.
                Every order line must point to a real inventory item.
            </div>

            {/* Unmatched products → create-all */}
            {unmatched.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                            <AlertTriangle size={14} />
                            {unmatched.length} new product{unmatched.length > 1 ? 's' : ''} not in inventory
                        </div>
                        <Button
                            text={creatingItems ? 'Creating...' : `Create all ${unmatched.length} new items`}
                            variant="primary"
                            icon={creatingItems ? <Loader size={14} className="animate-spin" /> : undefined}
                            onClick={() => void handleCreateAll()}
                            disabled={creatingItems}
                        />
                    </div>
                    <div className="max-h-40 overflow-y-auto">
                        <ul className="space-y-1 text-xs">
                            {unmatched.map((p) => (
                                <li key={p.key} className="grid grid-cols-2 gap-2 items-center py-1 border-b border-amber-100 last:border-0">
                                    <div className="truncate" title={p.key}>
                                        {productSku(p) && <span className="font-mono text-amber-700">[{productSku(p)}]</span>} {p.productName}
                                        {p.variationName ? ` - ${p.variationName}` : ''}
                                    </div>
                                    {/* Manual fallback: map to an existing item instead of creating. */}
                                    <SearchableSelect
                                        options={itemOptions}
                                        value={localMappings[p.key] || ''}
                                        onChange={(val: string) => handleMappingChange(p.key, val)}
                                        placeholder="…or map to existing"
                                    />
                                </li>
                            ))}
                        </ul>
                    </div>
                    {createError && (
                        <div className="mt-2 text-xs text-red-700">{createError}</div>
                    )}
                </div>
            )}

            {/* Inactive-blocked products → read-only, will be skipped */}
            {inactiveBlocked.length > 0 && (
                <div className="p-3 bg-neutral-100 border border-neutral-300 rounded-md">
                    <div className="flex items-center gap-2 text-sm font-semibold text-neutral-700 mb-2">
                        <PackageX size={14} />
                        Will be skipped — inactive product{inactiveBlocked.length > 1 ? 's' : ''}
                    </div>
                    <ul className="space-y-1 text-xs text-neutral-600">
                        {inactiveBlocked.map((b) => (
                            <li key={b.product.key}>
                                {b.sku && <span className="font-mono">[{b.sku}]</span>} {b.product.productName}
                                {b.product.variationName ? ` - ${b.product.variationName}` : ''}
                                {' — '}
                                <span className="text-neutral-500">
                                    matches inactive item &ldquo;{b.itemName}&rdquo;, affects {b.orderCount} order{b.orderCount > 1 ? 's' : ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-2 text-[11px] text-neutral-500 italic">
                        These orders will be sent but rejected by the server. Reactivate the item in Inventory to import them.
                    </p>
                </div>
            )}

            {unmatched.length === 0 && inactiveBlocked.length === 0 && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">
                    <CheckCircle size={16} />
                    All products are matched to inventory items.
                </div>
            )}
        </div>
    );

    const renderConfigure = (): React.ReactElement => (
        <div className="flex flex-col gap-4">
            <div>
                <label className="form-label">Record Payment</label>
                <div className="flex gap-4">
                    {[
                        { v: true, label: 'Paid' },
                        { v: false, label: 'Unpaid' },
                    ].map((o) => (
                        <label key={String(o.v)} className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                name="recordPayment"
                                checked={recordPayment === o.v}
                                onChange={() => setRecordPayment(o.v)}
                            />
                            <StatusTag status={o.label} />
                        </label>
                    ))}
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                    When &ldquo;Paid&rdquo;, a receipt is recorded against each invoice.
                </div>
            </div>

            <div>
                <label className="form-label">Invoice Date From</label>
                <select
                    className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                    value={dateField}
                    onChange={(e) => setDateField(e.target.value as 'completionDate' | 'paymentDate' | 'orderDate')}
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
                    <div className="text-neutral-500">Orders to send:</div>
                    <div className="font-medium">{parseResult?.parsedOrders.length.toLocaleString() ?? 0}</div>
                    <div className="text-neutral-500">Products matched:</div>
                    <div className="font-medium">{mappedCount.toLocaleString()}</div>
                    <div className="text-neutral-500">Total amount:</div>
                    <div className="font-semibold">{formatIDR(parseResult?.stats.totalAmount ?? 0)}</div>
                </div>
            </div>

            {inactiveBlocked.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
                    <div className="flex items-center gap-2 font-semibold mb-1">
                        <PackageX size={14} />
                        {inactiveBlocked.length} product{inactiveBlocked.length > 1 ? 's' : ''} map to inactive items
                    </div>
                    <p className="text-xs text-amber-700">
                        Orders containing these will be rejected by the server and listed as failed.
                    </p>
                </div>
            )}

            {importError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                    <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle size={14} /> Import failed
                    </div>
                    <div className="mt-1 text-xs">{importError}</div>
                </div>
            )}
        </div>
    );

    const renderImporting = (): React.ReactElement => (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader size={40} className="animate-spin text-primary-500" />
            <p className="text-sm text-neutral-600">Uploading orders to the server...</p>
            <p className="text-xs text-neutral-400">Do not close this window.</p>
        </div>
    );

    const renderDone = (): React.ReactElement => (
        <div className="flex flex-col items-center justify-center py-8 gap-4 w-full">
            <CheckCircle size={48} className="text-green-500" />
            <h3 className="text-lg font-semibold">Import Complete</h3>
            {importResult && (
                <>
                    <div className="grid grid-cols-3 gap-4 w-full">
                        <div className="bg-green-50 border border-green-200 rounded-md p-3 text-center">
                            <div className="text-xs text-green-700">Created</div>
                            <div className="text-lg font-semibold text-green-800">{importResult.created.toLocaleString()}</div>
                        </div>
                        <div className="bg-neutral-50 border border-neutral-200 rounded-md p-3 text-center">
                            <div className="text-xs text-neutral-500">Skipped</div>
                            <div className="text-lg font-semibold text-neutral-700">{importResult.skipped.toLocaleString()}</div>
                            <div className="text-[10px] text-neutral-400">already imported</div>
                        </div>
                        <div className={`rounded-md p-3 text-center border ${importResult.failed.length > 0 ? 'bg-red-50 border-red-200' : 'bg-neutral-50 border-neutral-200'}`}>
                            <div className={`text-xs ${importResult.failed.length > 0 ? 'text-red-700' : 'text-neutral-500'}`}>Failed</div>
                            <div className={`text-lg font-semibold ${importResult.failed.length > 0 ? 'text-red-800' : 'text-neutral-700'}`}>
                                {importResult.failed.length.toLocaleString()}
                            </div>
                        </div>
                    </div>

                    {importResult.failed.length > 0 && (
                        <div className="w-full p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
                            <div className="flex items-center gap-2 font-semibold mb-2">
                                <XCircle size={14} />
                                {importResult.failed.length} order{importResult.failed.length > 1 ? 's' : ''} did not upload
                            </div>
                            <div className="max-h-48 overflow-y-auto">
                                <ul className="space-y-1 text-xs">
                                    {importResult.failed.map((f) => (
                                        <li key={f.orderNo} className="grid grid-cols-2 gap-2 py-1 border-b border-red-100 last:border-0">
                                            <span className="font-mono font-medium">{f.orderNo}</span>
                                            <span className="text-red-700">{f.reason}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    )}
                </>
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

    // Confirm is blocked while any product is unmatched (must be created/mapped).
    // Inactive-blocked products do NOT block — their orders are excluded server-side.
    const confirmBlocked = unmatched.length > 0;

    const canGoNext = (): boolean => {
        if (step === 'upload') return false; // handled by file select
        if (step === 'preview') return true;
        if (step === 'mapping') return unmatched.length === 0;
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
                                text={`Import ${parseResult?.parsedOrders.length.toLocaleString() || 0} Orders`}
                                variant="primary"
                                onClick={() => void handleImport()}
                            />
                        ) : step === 'mapping' ? (
                            <Button
                                text={confirmBlocked ? `${unmatched.length} product(s) need mapping` : 'Next'}
                                variant="primary"
                                icon={confirmBlocked ? undefined : <ArrowRight size={14} />}
                                onClick={handleNext}
                                disabled={confirmBlocked}
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

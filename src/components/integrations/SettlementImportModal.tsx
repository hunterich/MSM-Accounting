import React, { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import Modal from '../UI/Modal';
import Button from '../UI/Button';
import { Upload, CheckCircle, AlertTriangle, Loader, XCircle, PackageX, Info } from 'lucide-react';
import { useImportSettlement, type SettlementImportResult } from '../../hooks/useIntegrations';
import { parseShopeeSettlement, type SettlementParseResult } from '../../utils/shopeeSettlement';
import { parseTikTokSettlement } from '../../utils/tiktokSettlement';
import { isShopeeSettlement, isTikTokSettlement } from '../../utils/marketplaceFormat';
import { formatIDR } from '../../utils/formatters';

type WizardStep = 'upload' | 'preview' | 'importing' | 'done';

interface SettlementImportModalProps {
    isOpen: boolean;
    connectionId: string;
    platform: string;
    onClose: () => void;
}

const SettlementImportModal: React.FC<SettlementImportModalProps> = ({ isOpen, connectionId, platform, onClose }) => {
    const importMutation = useImportSettlement();

    const [step, setStep] = useState<WizardStep>('upload');
    const [fileName, setFileName] = useState<string>('');
    const [parsed, setParsed] = useState<SettlementParseResult | null>(null);
    const [parsing, setParsing] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [result, setResult] = useState<SettlementImportResult | null>(null);
    const [refundOnly, setRefundOnly] = useState(false);
    const [refundNotes, setRefundNotes] = useState<Record<string, string>>({});
    const [manualRefund, setManualRefund] = useState({ orderId: '', amount: '', notes: '' });

    const resetAll = useCallback(() => {
        setStep('upload');
        setFileName('');
        setParsed(null);
        setParsing(false);
        setError('');
        setResult(null);
        setRefundOnly(false);
        setRefundNotes({});
        setManualRefund({ orderId: '', amount: '', notes: '' });
    }, []);

    const handleClose = (): void => {
        resetAll();
        onClose();
    };

    // ── Step 1: Parse settlement file ──────────────────────────────────────────
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
        const f = e.target.files?.[0];
        if (!f) return;
        setFileName(f.name);
        setRefundNotes({});
        setError('');
        setParsing(true);
        try {
            const buf = await f.arrayBuffer();
            const sheets = XLSX.read(buf, { type: 'array' }).SheetNames;
            const detected = isShopeeSettlement(sheets) ? 'Shopee' : isTikTokSettlement(sheets) ? 'TikTok' : null;
            if (!detected) {
                setError('Unrecognised settlement file — expected a Shopee (Summary/Income/Adjustment) or TikTok (Detail pesanan/Laporan) statement.');
                setParsing(false);
                return;
            }
            if (platform && detected !== platform) {
                setError(`This looks like a ${detected} settlement, but the store is ${platform}. Upload the matching file.`);
                setParsing(false);
                return;
            }
            const res = detected === 'Shopee' ? await parseShopeeSettlement(f) : await parseTikTokSettlement(f);
            setParsed(res);
            setParsing(false);
            setStep('preview');
        } catch (err) {
            setError((err as Error).message || 'Failed to parse settlement file.');
            setParsing(false);
        } finally {
            // Allow re-selecting the same file after an error.
            e.target.value = '';
        }
    };

    // ── Step 2 → 3: Confirm & post ─────────────────────────────────────────────
    const handleImport = async (): Promise<void> => {
        if (!parsed) return;
        setError('');
        setStep('importing');
        try {
            const orders = parsed.orders.map((o) => ({
                orderId: o.orderId,
                netReleased: o.netReleased,
                charges: o.charges as Record<string, number>,
                refundOnly,
                refundCreditNoteNumbers: (refundNotes[o.orderId] || '').split(',').map(n => n.trim()).filter(Boolean),
            }));
            const res = await importMutation.mutateAsync({ connectionId, orders });
            setResult(res);
            setStep('done');
        } catch (err) {
            setError((err as Error).message || 'Settlement import failed.');
            setStep('preview');
        }
    };

    const handleManualRefund = async (): Promise<void> => {
        const amount = Number(manualRefund.amount);
        if (!manualRefund.orderId.trim() || !Number.isFinite(amount) || amount <= 0 || !manualRefund.notes.trim()) return;
        setError('');
        setStep('importing');
        try {
            const res = await importMutation.mutateAsync({ connectionId, orders: [{
                orderId: manualRefund.orderId.trim(), netReleased: -amount, charges: { refund: amount }, refundOnly: true,
                refundCreditNoteNumbers: manualRefund.notes.split(',').map(n => n.trim()).filter(Boolean),
            }] });
            setResult(res);
            setStep('done');
        } catch (err) {
            setError((err as Error).message || 'Refund reconciliation failed.');
            setStep('upload');
        }
    };

    // ── Renderers ──────────────────────────────────────────────────────────────
    const renderUpload = (): React.ReactElement => (
        <div className="flex flex-col gap-4">
            <div>
                <label className="form-label">Settlement File (.xlsx)</label>
                <div className="border-2 border-dashed border-neutral-300 rounded-lg p-6 text-center">
                    <Upload size={32} className="mx-auto mb-2 text-neutral-400" />
                    <p className="text-sm text-neutral-500 mb-3">
                        {fileName || 'Select a TikTok Income.released settlement file'}
                    </p>
                    <label className="inline-block">
                        <input
                            type="file"
                            accept=".xlsx,.xls"
                            className="hidden"
                            onChange={handleFileSelect}
                            disabled={parsing}
                        />
                        <span className="inline-flex items-center gap-1 px-4 py-2 bg-primary-700 text-white text-sm rounded-md cursor-pointer hover:bg-primary-800">
                            {parsing ? <><Loader size={14} className="animate-spin" /> Parsing...</> : 'Select File'}
                        </span>
                    </label>
                </div>
                {error && (
                    <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                        <div className="flex gap-2">
                            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                            <div className="font-medium">{error}</div>
                        </div>
                    </div>
                )}
            </div>
            <div className="border-t border-neutral-200 pt-4 space-y-2">
                <h4 className="text-sm font-semibold">Reconcile a later refund by order</h4>
                <p className="text-xs text-neutral-500">For a refund after the original payout, enter the refund debit shown on the platform statement. First create the linked sales return and apply its refund credit note to the original marketplace clearing account. This links the refund without another journal. Stock is restored only for goods received.</p>
                <label className="block text-sm">Marketplace order number
                    <input className="w-full h-10 px-3 rounded-md border border-neutral-300" value={manualRefund.orderId} onChange={e => setManualRefund(p => ({ ...p, orderId: e.target.value }))} />
                </label>
                <label className="block text-sm">Statement refund amount (positive IDR)
                    <input type="number" min="0.01" step="0.01" className="w-full h-10 px-3 rounded-md border border-neutral-300" value={manualRefund.amount} onChange={e => setManualRefund(p => ({ ...p, amount: e.target.value }))} />
                </label>
                <label className="block text-sm">Applied refund credit note number(s), separated by commas
                    <input className="w-full h-10 px-3 rounded-md border border-neutral-300" value={manualRefund.notes} onChange={e => setManualRefund(p => ({ ...p, notes: e.target.value }))} />
                </label>
                <Button onClick={handleManualRefund} disabled={!manualRefund.orderId.trim() || !(Number(manualRefund.amount) > 0) || !manualRefund.notes.trim()}>Reconcile refund</Button>
            </div>
        </div>
    );

    const renderPreview = (): React.ReactElement => (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-neutral-50 rounded-md p-3 text-center">
                    <div className="text-xs text-neutral-500">Orders</div>
                    <div className="text-sm font-semibold mt-1">{(parsed?.orders.length ?? 0).toLocaleString()}</div>
                </div>
                <div className="bg-neutral-50 rounded-md p-3 text-center">
                    <div className="text-xs text-neutral-500">Total Net Released</div>
                    <div className="text-sm font-semibold mt-1">{formatIDR(parsed?.totalNetReleased ?? 0)}</div>
                </div>
            </div>

            <div className="text-xs text-neutral-500">
                Each order is reconciled against its marketplace wallet receipt. For a return or a shipped order cancelled before completion, create a linked sales return and apply a refund credit note to the original marketplace clearing account first. Receive stock only when goods actually arrive, using the defect warehouse if needed.
            </div>
            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={refundOnly} onChange={e => setRefundOnly(e.target.checked)} />
                Later refunds after the original settlement (refund debits only)
            </label>
            {refundOnly && <p className="text-xs text-neutral-500">Use a statement containing only the later refund debit for each order. Net released must equal minus the refund; fees and other adjustments require separate review.</p>}
            {parsed?.orders.filter(o => (o.charges.refund ?? 0) > 0).map(o => (
                <label key={o.orderId} className="text-sm">
                    Refund credit note number(s) for {o.orderId} ({formatIDR(o.charges.refund ?? 0)})
                    <input className="w-full h-10 px-3 rounded-md border border-neutral-300" value={refundNotes[o.orderId] || ''}
                        onChange={e => setRefundNotes(prior => ({ ...prior, [o.orderId]: e.target.value }))}
                        placeholder="Credit note numbers, separated by commas" />
                </label>
            ))}

            {(parsed?.nonOrderRows?.length ?? 0) > 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800">
                    <Info size={14} className="shrink-0 mt-0.5" />
                    <span>
                        <strong>{parsed!.nonOrderRows.length}</strong> non-order row{parsed!.nonOrderRows.length > 1 ? 's' : ''} (ads/adjustments) will be listed on the completion screen, not posted — book them manually.
                    </span>
                </div>
            )}

            {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                    <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle size={14} /> Import failed
                    </div>
                    <div className="mt-1 text-xs">{error}</div>
                </div>
            )}
        </div>
    );

    const renderImporting = (): React.ReactElement => (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader size={40} className="animate-spin text-primary-700" />
            <p className="text-sm text-neutral-600">Posting settlements to the server...</p>
            <p className="text-xs text-neutral-400">Do not close this window.</p>
        </div>
    );

    const renderDone = (): React.ReactElement => (
        <div className="flex flex-col items-center justify-center py-6 gap-4 w-full">
            <CheckCircle size={48} className="text-green-500" />
            <h3 className="text-lg font-semibold">Settlement Import Complete</h3>
            {result && (
                <>
                    <div className="grid grid-cols-4 gap-3 w-full">
                        <div className="bg-green-50 border border-green-200 rounded-md p-3 text-center">
                            <div className="text-xs text-green-700">Reconciled</div>
                            <div className="text-lg font-semibold text-green-800">{result.posted.toLocaleString()}</div>
                        </div>
                        <div className="bg-neutral-50 border border-neutral-200 rounded-md p-3 text-center">
                            <div className="text-xs text-neutral-500">Already Settled</div>
                            <div className="text-lg font-semibold text-neutral-700">{result.alreadySettled.toLocaleString()}</div>
                        </div>
                        <div className="bg-neutral-50 border border-neutral-200 rounded-md p-3 text-center">
                            <div className="text-xs text-neutral-500">Skipped</div>
                            <div className="text-lg font-semibold text-neutral-700">{result.skipped.length.toLocaleString()}</div>
                        </div>
                        <div className={`rounded-md p-3 text-center border ${result.failed.length > 0 ? 'bg-red-50 border-red-200' : 'bg-neutral-50 border-neutral-200'}`}>
                            <div className={`text-xs ${result.failed.length > 0 ? 'text-red-700' : 'text-neutral-500'}`}>Failed</div>
                            <div className={`text-lg font-semibold ${result.failed.length > 0 ? 'text-red-800' : 'text-neutral-700'}`}>
                                {result.failed.length.toLocaleString()}
                            </div>
                        </div>
                    </div>

                    {result.failed.length > 0 && (
                        <div className="w-full p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
                            <div className="flex items-center gap-2 font-semibold mb-2">
                                <XCircle size={14} />
                                {result.failed.length} order{result.failed.length > 1 ? 's' : ''} could not be posted
                            </div>
                            <div className="max-h-48 overflow-y-auto">
                                <ul className="space-y-1 text-xs">
                                    {result.failed.map((f) => (
                                        <li key={f.orderId} className="grid grid-cols-2 gap-2 py-1 border-b border-red-100 last:border-0">
                                            <span className="font-mono font-medium">{f.orderId}</span>
                                            <span className="text-red-700">{f.reason}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    )}

                    {result.skipped.length > 0 && (
                        <div className="w-full p-3 bg-neutral-100 border border-neutral-300 rounded-md text-sm text-neutral-700">
                            <div className="flex items-center gap-2 font-semibold mb-2">
                                <PackageX size={14} />
                                {result.skipped.length} order{result.skipped.length > 1 ? 's' : ''} skipped (no matching receivable)
                            </div>
                            <div className="max-h-48 overflow-y-auto">
                                <ul className="space-y-1 text-xs">
                                    {result.skipped.map((s) => (
                                        <li key={s.orderId} className="grid grid-cols-2 gap-2 py-1 border-b border-neutral-200 last:border-0">
                                            <span className="font-mono font-medium">{s.orderId}</span>
                                            <span className="text-neutral-500 text-right">{formatIDR(s.netReleased)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    )}

                    {(parsed?.nonOrderRows?.length ?? 0) > 0 && (
                        <div className="w-full p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
                            <div className="flex items-center gap-2 font-semibold mb-2">
                                <Info size={14} />
                                {parsed!.nonOrderRows.length} non-order row{parsed!.nonOrderRows.length > 1 ? 's' : ''} — book manually
                            </div>
                            <div className="max-h-48 overflow-y-auto">
                                <ul className="space-y-1 text-xs">
                                    {parsed!.nonOrderRows.map((row, idx) => (
                                        <li key={`${row.orderId}-${idx}`} className="grid grid-cols-2 gap-2 py-1 border-b border-amber-100 last:border-0">
                                            <span className="text-amber-900">{row.type}</span>
                                            <span className="text-amber-700 text-right">{formatIDR(row.amount)}</span>
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

    const stepTitles: Record<WizardStep, string> = {
        upload: 'Upload File',
        preview: 'Preview',
        importing: 'Importing...',
        done: 'Complete',
    };

    return (
        <Modal
            title={`Import Settlement Statement — ${stepTitles[step]}`}
            isOpen={isOpen}
            onClose={step === 'importing' ? () => { /* blocked during import */ } : handleClose}
            size="lg"
        >
            <div style={{ minHeight: 240 }}>
                {step === 'upload' && renderUpload()}
                {step === 'preview' && renderPreview()}
                {step === 'importing' && renderImporting()}
                {step === 'done' && renderDone()}
            </div>

            {step !== 'importing' && (
                <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-neutral-200">
                    {step === 'preview' && (
                        <Button
                            text={`Confirm & Post ${(parsed?.orders.length ?? 0).toLocaleString()} Orders`}
                            variant="primary"
                            onClick={() => void handleImport()}
                        />
                    )}
                    {step === 'done' && (
                        <Button text="Close" variant="primary" onClick={handleClose} />
                    )}
                    {step === 'upload' && (
                        <Button text="Cancel" variant="tertiary" onClick={handleClose} />
                    )}
                </div>
            )}
        </Modal>
    );
};

export default SettlementImportModal;

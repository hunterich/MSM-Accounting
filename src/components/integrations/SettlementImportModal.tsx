import React, { useState, useCallback } from 'react';
import Modal from '../UI/Modal';
import Button from '../UI/Button';
import { Upload, CheckCircle, AlertTriangle, Loader, XCircle, PackageX } from 'lucide-react';
import { useImportSettlement, type SettlementImportResult } from '../../hooks/useIntegrations';
import { parseTikTokSettlement, type SettlementParseResult } from '../../utils/tiktokSettlement';
import { formatIDR } from '../../utils/formatters';

type WizardStep = 'upload' | 'preview' | 'importing' | 'done';

interface SettlementImportModalProps {
    isOpen: boolean;
    connectionId: string;
    onClose: () => void;
}

const SettlementImportModal: React.FC<SettlementImportModalProps> = ({ isOpen, connectionId, onClose }) => {
    const importMutation = useImportSettlement();

    const [step, setStep] = useState<WizardStep>('upload');
    const [fileName, setFileName] = useState<string>('');
    const [parsed, setParsed] = useState<SettlementParseResult | null>(null);
    const [parsing, setParsing] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [result, setResult] = useState<SettlementImportResult | null>(null);

    const resetAll = useCallback(() => {
        setStep('upload');
        setFileName('');
        setParsed(null);
        setParsing(false);
        setError('');
        setResult(null);
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
        setError('');
        setParsing(true);
        try {
            const res = await parseTikTokSettlement(f);
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
            }));
            const res = await importMutation.mutateAsync({ connectionId, orders });
            setResult(res);
            setStep('done');
        } catch (err) {
            setError((err as Error).message || 'Settlement import failed.');
            setStep('preview');
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
                Each order is reconciled against its outstanding receivable. Already-settled orders are skipped.
            </div>

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
                            <div className="text-xs text-green-700">Posted</div>
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

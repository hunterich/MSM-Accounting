import React, { useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import Card from '../UI/Card';
import Button from '../UI/Button';
import Modal from '../UI/Modal';
import StatusTag from '../UI/StatusTag';
import { formatIDR } from '../../utils/formatters';
import { useToastStore } from '../../stores/useToastStore';
import {
    useFiscalYearPreview,
    useCloseFiscalYear,
    useReopenFiscalYear,
} from '../../hooks/useFiscalYearClose';

/**
 * Fiscal-year close.
 *
 * The monthly close above this card is a lock; this one moves money. It posts
 * a single entry that zeroes every revenue and expense account for the year
 * and books the difference to Retained Earnings, so the next year starts from
 * a clean P&L. The confirm step shows the exact figures first, because it is
 * the only action in the app that writes a journal entry the user never typed.
 */

interface Props {
    /** SETTINGS/edit — the same permission the close and reopen routes enforce. */
    canManage: boolean;
}

const FiscalYearCloseCard = ({ canManage }: Props): React.ReactElement => {
    const pushToast = useToastStore((s) => s.pushToast);
    const { data: preview, isLoading, error } = useFiscalYearPreview();
    const closeYear = useCloseFiscalYear();
    const reopenYear = useReopenFiscalYear();
    const [pending, setPending] = useState<'close' | 'reopen' | null>(null);
    const busy = closeYear.isPending || reopenYear.isPending;

    const isClosed = Boolean(preview?.closedEntryNo);

    const confirm = async (): Promise<void> => {
        if (!pending) return;
        try {
            if (pending === 'close') {
                const res = (await closeYear.mutateAsync()) as { entryNo?: string };
                pushToast(`Fiscal year closed — entry ${res.entryNo ?? ''}.`.trim(), 'success');
            } else {
                await reopenYear.mutateAsync();
                pushToast('Fiscal year reopened — the closing entry was removed.', 'success');
            }
            setPending(null);
        } catch (e) {
            pushToast(e instanceof Error ? e.message : `Failed to ${pending} the fiscal year.`, 'error');
        }
    };

    return (
        <>
            <Card title="Fiscal Year Close">
                {error ? (
                    <p className="text-sm text-danger-600">
                        {error instanceof Error ? error.message : 'Failed to load the fiscal year.'}
                    </p>
                ) : isLoading || !preview ? (
                    <p className="text-sm text-neutral-500">Loading fiscal year…</p>
                ) : (
                    <div className="space-y-4">
                        <p className="settings-muted">
                            Closing the year posts one entry that zeroes every revenue and expense account and
                            books the result to Retained Earnings, so next year starts from a clean profit &amp;
                            loss. Every month of the year must be closed first.
                        </p>

                        <div className="flex flex-wrap items-center gap-3">
                            <span className="text-sm font-medium text-neutral-900">{preview.range.label}</span>
                            {isClosed ? (
                                <StatusTag status="closed" />
                            ) : (
                                <StatusTag status="info" label="Open" />
                            )}
                            {isClosed && (
                                <span className="text-sm text-neutral-500">
                                    Closing entry {preview.closedEntryNo}
                                </span>
                            )}
                        </div>

                        {!isClosed && (
                            <dl className="grid grid-cols-1 gap-2 rounded-lg border border-neutral-200 p-3 text-sm sm:grid-cols-3">
                                <div>
                                    <dt className="text-neutral-500">Revenue</dt>
                                    <dd className="font-medium text-neutral-900">{formatIDR(preview.totalRevenue)}</dd>
                                </div>
                                <div>
                                    <dt className="text-neutral-500">Expenses</dt>
                                    <dd className="font-medium text-neutral-900">{formatIDR(preview.totalExpense)}</dd>
                                </div>
                                <div>
                                    <dt className="text-neutral-500">
                                        Net {preview.netIncome >= 0 ? 'income' : 'loss'}
                                    </dt>
                                    <dd
                                        className={`font-semibold ${preview.netIncome >= 0 ? 'text-success-700' : 'text-danger-600'}`}
                                    >
                                        {formatIDR(Math.abs(preview.netIncome))}
                                    </dd>
                                </div>
                            </dl>
                        )}

                        {!isClosed && preview.blockedReason && (
                            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                                {preview.blockedReason}
                            </p>
                        )}

                        {canManage && (
                            <div>
                                {isClosed ? (
                                    <Button
                                        text="Reopen fiscal year"
                                        variant="secondary"
                                        size="small"
                                        icon={<Unlock size={14} />}
                                        disabled={busy}
                                        onClick={() => setPending('reopen')}
                                    />
                                ) : (
                                    <Button
                                        text="Close fiscal year"
                                        variant="secondary"
                                        size="small"
                                        icon={<Lock size={14} />}
                                        // The route re-checks this; disabling here just saves the
                                        // round trip and the reason is already on screen above.
                                        disabled={busy || !preview.canClose}
                                        onClick={() => setPending('close')}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                )}
            </Card>

            {pending && preview && (
                <Modal
                    isOpen
                    title={
                        pending === 'close'
                            ? `Close fiscal year ${preview.range.label}`
                            : `Reopen fiscal year ${preview.range.label}`
                    }
                    onClose={() => (busy ? undefined : setPending(null))}
                    size="sm"
                >
                    <div className="space-y-4 p-4">
                        {pending === 'close' ? (
                            <>
                                <p className="text-sm text-neutral-700">
                                    This posts one journal entry dated{' '}
                                    {new Date(preview.range.endDate).toISOString().slice(0, 10)}, zeroing{' '}
                                    {preview.lines.length} revenue and expense account
                                    {preview.lines.length === 1 ? '' : 's'} and booking the{' '}
                                    {preview.netIncome >= 0 ? 'net income' : 'net loss'} of{' '}
                                    <strong>{formatIDR(Math.abs(preview.netIncome))}</strong> to{' '}
                                    <strong>{preview.retainedEarningsAccountName}</strong>.
                                </p>
                                <p className="text-xs text-neutral-500">
                                    You can reopen the year later, which deletes this entry.
                                </p>
                            </>
                        ) : (
                            <p className="text-sm text-neutral-700">
                                This deletes closing entry <strong>{preview.closedEntryNo}</strong>. The year&apos;s
                                revenue and expense balances come back, and its monthly periods stay closed —
                                reopen those separately if you need to post into them.
                            </p>
                        )}

                        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
                            <Button
                                text="Cancel"
                                variant="tertiary"
                                size="small"
                                disabled={busy}
                                onClick={() => setPending(null)}
                            />
                            <Button
                                text={
                                    busy
                                        ? 'Working…'
                                        : pending === 'close'
                                          ? 'Post closing entry'
                                          : 'Reopen year'
                                }
                                variant="primary"
                                size="small"
                                disabled={busy}
                                onClick={() => void confirm()}
                            />
                        </div>
                    </div>
                </Modal>
            )}
        </>
    );
};

export default FiscalYearCloseCard;

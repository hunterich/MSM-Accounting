import React, { useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import Card from '../UI/Card';
import Button from '../UI/Button';
import Modal from '../UI/Modal';
import StatusTag from '../UI/StatusTag';
import Table, { TableColumn } from '../UI/Table';
import { formatDateID } from '../../utils/formatters';
import { useToastStore } from '../../stores/useToastStore';
import {
    useAccountingPeriods,
    useCloseChecklist,
    useClosePeriod,
    useReopenPeriod,
    useGeneratePeriods,
    type AccountingPeriod,
} from '../../hooks/useAccountingPeriods';

/**
 * Monthly period close.
 *
 * This card used to render twelve rows derived from `fiscalYearStart` and call
 * any month in the past "Closed" — a label the database never agreed with,
 * since nothing had actually closed anything. It now shows real periods with
 * their real status, and is where a period gets closed or reopened.
 *
 * Closing is what makes `assertPeriodOpen` start refusing posts dated inside
 * the period, so the confirm step leads with the pre-close checklist rather
 * than a bare "are you sure".
 */

type Pending = { period: AccountingPeriod; action: 'close' | 'reopen' };

interface Props {
    /** SETTINGS/edit — the same permission the close and reopen routes enforce. */
    canManage: boolean;
}

const AccountingPeriodsCard = ({ canManage }: Props): React.ReactElement => {
    const pushToast = useToastStore((s) => s.pushToast);
    const { data: periods = [], isLoading, error } = useAccountingPeriods();
    const [pending, setPending] = useState<Pending | null>(null);

    // Only fetched once a close is actually being confirmed.
    const { data: checklist, isLoading: checklistLoading } = useCloseChecklist(
        pending?.action === 'close' ? pending.period.id : null,
    );
    const closePeriod = useClosePeriod();
    const reopenPeriod = useReopenPeriod();
    const generatePeriods = useGeneratePeriods();
    const busy = closePeriod.isPending || reopenPeriod.isPending || generatePeriods.isPending;

    const generate = async (): Promise<void> => {
        try {
            const { created } = await generatePeriods.mutateAsync();
            pushToast(
                created > 0
                    ? `Created ${created} monthly period${created === 1 ? '' : 's'}.`
                    : 'All periods for this fiscal year already exist.',
                'success',
            );
        } catch (e) {
            pushToast(e instanceof Error ? e.message : 'Failed to generate periods.', 'error');
        }
    };

    const confirm = async (): Promise<void> => {
        if (!pending) return;
        const { period, action } = pending;
        try {
            if (action === 'close') await closePeriod.mutateAsync(period.id);
            else await reopenPeriod.mutateAsync(period.id);
            pushToast(`Period ${period.name} ${action === 'close' ? 'closed' : 'reopened'}.`, 'success');
            setPending(null);
        } catch (e) {
            // Server-side refusals (unposted entries, already closed, a
            // concurrent close) carry the reason — show it and keep the modal
            // open so the checklist stays on screen.
            pushToast(e instanceof Error ? e.message : `Failed to ${action} the period.`, 'error');
        }
    };

    const columns: TableColumn<AccountingPeriod & Record<string, unknown>>[] = [
        { key: 'name', label: 'Period' },
        { key: 'startDate', label: 'Start', render: (v) => formatDateID(v as string) },
        { key: 'endDate', label: 'End', render: (v) => formatDateID(v as string) },
        {
            key: 'status',
            label: 'Status',
            // StatusTag has no 'open' key, so it would render the raw lowercase
            // string. Drive the tone from a mapped key and set the label here
            // rather than adding 'open' to the shared map, where other modules
            // already use the word with different meanings (an open bill is
            // unpaid, not unlocked).
            render: (v) =>
                v === 'CLOSED' ? (
                    <StatusTag status="closed" />
                ) : (
                    <StatusTag status="info" label="Open" />
                ),
        },
        {
            key: 'closedAt',
            label: 'Closed',
            render: (_v, row) =>
                row.closedAt ? (
                    <span className="text-sm text-neutral-700">
                        {formatDateID(row.closedAt)}
                        {row.closedByName ? <span className="text-neutral-500"> · {row.closedByName}</span> : null}
                    </span>
                ) : (
                    <span className="text-sm text-neutral-400">—</span>
                ),
        },
        {
            key: 'actions',
            label: '',
            align: 'right',
            render: (_v, row) => {
                if (!canManage) return null;
                return row.status === 'CLOSED' ? (
                    <Button
                        text="Reopen"
                        variant="secondary"
                        size="small"
                        icon={<Unlock size={14} />}
                        disabled={busy}
                        onClick={() => setPending({ period: row, action: 'reopen' })}
                    />
                ) : (
                    <Button
                        text="Close"
                        variant="secondary"
                        size="small"
                        icon={<Lock size={14} />}
                        disabled={busy}
                        onClick={() => setPending({ period: row, action: 'close' })}
                    />
                );
            },
        },
    ];

    return (
        <>
            <Card title="Accounting Periods" padding={false}>
                {error ? (
                    <div className="p-4 text-sm text-danger-600">
                        {error instanceof Error ? error.message : 'Failed to load accounting periods.'}
                    </div>
                ) : isLoading ? (
                    <div className="p-4 text-sm text-neutral-500">Loading periods…</div>
                ) : periods.length === 0 ? (
                    // Companies created before bootstrapOrganization existed have
                    // no periods at all, which leaves them with nothing to close.
                    <div className="space-y-3 p-4">
                        <p className="text-sm text-neutral-600">
                            No accounting periods yet. Generate the twelve monthly periods for this company&apos;s
                            fiscal year to start closing months.
                        </p>
                        {canManage && (
                            <Button
                                text={generatePeriods.isPending ? 'Generating…' : 'Generate periods'}
                                variant="secondary"
                                size="small"
                                disabled={busy}
                                onClick={() => void generate()}
                            />
                        )}
                    </div>
                ) : (
                    <Table<AccountingPeriod & Record<string, unknown>>
                        columns={columns}
                        data={periods as Array<AccountingPeriod & Record<string, unknown>>}
                    />
                )}
            </Card>

            {pending && (
                <Modal
                    isOpen
                    title={pending.action === 'close' ? `Close ${pending.period.name}` : `Reopen ${pending.period.name}`}
                    onClose={() => (busy ? undefined : setPending(null))}
                    size="sm"
                >
                    <div className="space-y-4 p-4">
                        {pending.action === 'close' ? (
                            <>
                                <p className="text-sm text-neutral-700">
                                    Once closed, nothing can be posted, edited, or voided with a date inside this
                                    period. You can reopen it later.
                                </p>
                                {checklistLoading ? (
                                    <p className="text-sm text-neutral-500">Running the close checklist…</p>
                                ) : checklist ? (
                                    <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
                                        {checklist.items.map((item) => (
                                            <li key={item.key} className="flex items-center justify-between px-3 py-2 text-sm">
                                                <span className="text-neutral-700">
                                                    {item.label}
                                                    {item.blocking && item.count > 0 && (
                                                        <span className="ml-2 text-xs font-medium text-danger-600">blocks close</span>
                                                    )}
                                                </span>
                                                <span
                                                    className={
                                                        item.count > 0
                                                            ? item.blocking
                                                                ? 'font-semibold text-danger-600'
                                                                : 'font-semibold text-warning-700'
                                                            : 'text-neutral-500'
                                                    }
                                                >
                                                    {item.count}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                                {checklist && !checklist.canClose && (
                                    <p className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-600">
                                        Post the outstanding journal entries before closing this period.
                                    </p>
                                )}
                            </>
                        ) : (
                            <p className="text-sm text-neutral-700">
                                Reopening lets entries be posted into {pending.period.name} again
                                {pending.period.closedByName ? `. It was closed by ${pending.period.closedByName}` : ''}
                                {pending.period.closedAt ? ` on ${formatDateID(pending.period.closedAt)}` : ''}.
                            </p>
                        )}

                        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
                            <Button text="Cancel" variant="tertiary" size="small" disabled={busy} onClick={() => setPending(null)} />
                            <Button
                                text={
                                    busy
                                        ? 'Working…'
                                        : pending.action === 'close'
                                          ? 'Close period'
                                          : 'Reopen period'
                                }
                                variant="primary"
                                size="small"
                                // The server refuses a blocked close anyway; disabling here saves
                                // the round trip and explains itself with the checklist above.
                                disabled={busy || (pending.action === 'close' && checklist ? !checklist.canClose : false)}
                                onClick={() => void confirm()}
                            />
                        </div>
                    </div>
                </Modal>
            )}
        </>
    );
};

export default AccountingPeriodsCard;

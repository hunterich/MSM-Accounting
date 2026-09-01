import React from 'react';
import { Lock, CalendarClock } from 'lucide-react';
import { usePeriodLock } from '../../hooks/usePeriodLock';
import { useTransactionDateWindow } from '../../hooks/useTransactionDateWindow';

interface Props {
    /** The form's posting date, as the `YYYY-MM-DD` value of its date input. */
    date: string | null | undefined;
    /** Spacing is the caller's, since forms vary between margins and flex gaps. */
    className?: string;
}

/**
 * What is wrong with this date — shown while it is being chosen, instead of
 * after the save attempt. Two rules, in the order the server applies them:
 *
 *   1. the month is closed (`assertPeriodOpen`), which is permanent until
 *      someone reopens it;
 *   2. the date is outside the org's transaction-date window, which is a
 *      plausibility rule and may be set to warn rather than block.
 *
 * Renders nothing when the date is fine, or not yet checkable, so a form can
 * drop it in unconditionally above its fields.
 *
 * It never disables anything. The server is the gate in both cases, and a
 * stale client copy of either rule must not be able to stop a legitimate post.
 */
const ClosedPeriodBanner = ({ date, className }: Props): React.ReactElement | null => {
    const lock = usePeriodLock(date);
    const dateWindow = useTransactionDateWindow(date);

    const base = `rounded-md py-3 px-4 text-sm flex gap-2 items-start ${className ?? ''}`;

    // The closed period is the stronger statement, and reopening it is a
    // different action from widening a window — so it is the one to show.
    if (lock.status === 'blocked') {
        return (
            <div
                role="status"
                data-testid="closed-period-banner"
                className={`bg-warning-50 border border-warning-300 text-warning-800 ${base}`}
            >
                <Lock size={16} className="shrink-0 mt-0.5" />
                <span>{lock.message}</span>
            </div>
        );
    }

    if (dateWindow.status === 'outside' && dateWindow.message) {
        const blocking = dateWindow.mode === 'BLOCK';
        return (
            <div
                role="status"
                data-testid="transaction-date-banner"
                data-mode={dateWindow.mode}
                className={
                    blocking
                        ? `bg-danger-50 border border-danger-200 text-danger-700 ${base}`
                        : `bg-warning-50 border border-warning-300 text-warning-800 ${base}`
                }
            >
                <CalendarClock size={16} className="shrink-0 mt-0.5" />
                <span>
                    {dateWindow.message}{' '}
                    {blocking
                        ? 'Saving will be refused unless you have Settings edit rights.'
                        : 'You can still save — check the date is what you meant.'}
                </span>
            </div>
        );
    }

    return null;
};

export default ClosedPeriodBanner;

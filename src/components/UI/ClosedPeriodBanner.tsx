import React from 'react';
import { Lock } from 'lucide-react';
import { usePeriodLock } from '../../hooks/usePeriodLock';

interface Props {
    /** The form's posting date, as the `YYYY-MM-DD` value of its date input. */
    date: string | null | undefined;
    /** Spacing is the caller's, since forms vary between margins and flex gaps. */
    className?: string;
}

/**
 * "This date is in a closed period" — shown while the date is being chosen,
 * instead of after the save attempt.
 *
 * Renders nothing when the period is open, undefined, or not yet loaded, so a
 * form can drop it in unconditionally above its fields.
 *
 * It warns; it does not block. The submit button stays enabled because the
 * server's `assertPeriodOpen` is the real gate and a stale client list must
 * never be able to stop a legitimate post.
 */
const ClosedPeriodBanner = ({ date, className }: Props): React.ReactElement | null => {
    const lock = usePeriodLock(date);
    if (lock.status !== 'blocked') return null;

    return (
        <div
            role="status"
            data-testid="closed-period-banner"
            className={`bg-warning-50 border border-warning-300 text-warning-800 rounded-md py-3 px-4 text-sm flex gap-2 items-start ${className ?? ''}`}
        >
            <Lock size={16} className="shrink-0 mt-0.5" />
            <span>{lock.message}</span>
        </div>
    );
};

export default ClosedPeriodBanner;

import { useMemo } from 'react';
import { useOrganizationSettings } from './useOrganizationSettings';
import { parseFormDate } from '../lib/periodLock';
import {
    evaluateTransactionDate,
    type TransactionDateVerdict,
    type TransactionDateMode,
} from '../../lib/transaction-date-policy';

export interface TransactionDateWindowState {
    /** 'unknown' until settings load or while the date field is unusable. */
    status: 'unknown' | 'ok' | 'outside';
    /** What the org chose to do about a date outside the window. */
    mode: TransactionDateMode;
    message: string | null;
}

const UNKNOWN: TransactionDateWindowState = { status: 'unknown', mode: 'WARN', message: null };

/**
 * Tells a form whether its date is outside the org's transaction-date window.
 *
 * Reads the same policy the server guard reads, through the same parser, so the
 * screen and the refusal cannot disagree about what is configured. It cannot
 * know whether *this* user holds the override — that is resolved server-side
 * from their role — so a user who can post outside the window still sees the
 * warning. Telling them the date is unusual is right either way; only the
 * refusal is theirs to skip.
 */
export function useTransactionDateWindow(
    dateValue: string | null | undefined,
): TransactionDateWindowState {
    const { data: settings, isSuccess } = useOrganizationSettings();

    return useMemo(() => {
        if (!isSuccess || !settings) return UNKNOWN;
        const policy = settings.transactionDatePolicy;
        if (!policy.enabled) return { status: 'ok', mode: policy.mode, message: null };

        const ms = parseFormDate(dateValue);
        if (ms === null) return UNKNOWN;

        const verdict: TransactionDateVerdict = evaluateTransactionDate(policy, new Date(ms));
        return {
            status: verdict.status === 'outside' ? 'outside' : 'ok',
            mode: policy.mode,
            message: verdict.message,
        };
    }, [settings, isSuccess, dateValue]);
}

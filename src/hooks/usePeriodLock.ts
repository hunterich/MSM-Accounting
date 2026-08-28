import { useMemo } from 'react';
import { useAccountingPeriods } from './useAccountingPeriods';
import { resolvePeriodLock, type PeriodLockState } from '../lib/periodLock';

/**
 * Tells a transaction form whether its current date lands in a closed period.
 *
 * Backed by the same `['accounting-periods']` query the Company Setup screen
 * uses, so every open form shares one cached fetch and a close performed in
 * one tab is reflected in the others as soon as the query invalidates.
 *
 * The list is capped at the API's 100-row page ordered newest first — over
 * eight fiscal years. A date older than that resolves to "no period covers
 * it", which reads as open; the server guard still has the last word.
 */
export function usePeriodLock(dateValue: string | null | undefined): PeriodLockState {
    const { data: periods, isSuccess } = useAccountingPeriods();

    return useMemo(
        () => resolvePeriodLock(periods, dateValue, isSuccess),
        [periods, dateValue, isSuccess],
    );
}

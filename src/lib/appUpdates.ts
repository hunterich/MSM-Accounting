/** Notes travel with the frontend build, so older deployments cannot advertise newer changes. */
export const APP_UPDATES = [
    {
        id: '2026-10-08.1',
        date: '2026-10-08',
        title: 'October 2026 update',
        changes: [
            'Browse invoices, bills, payments and other lists with page controls and clearer loading errors.',
            'Recurring invoices, expenses and subscriptions support automatic generation. An administrator must enable scheduling on the server.',
            'Finance can receive payment alerts, due reminders and daily summaries. An administrator must configure the finance email, notification settings and email delivery.',
            'Debt and stock reports use the selected reporting date, including payments, credits and later reversals.',
            'Account access, sign-in security and approval permissions have stronger checks.',
        ],
    },
] as const;

export function updateReadKey(userId: string): string {
    return `msm:app-updates:read:${userId}`;
}

export function parseReadUpdates(value: string | null): string[] {
    try {
        const parsed: unknown = JSON.parse(value ?? '[]');
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch { return []; }
}

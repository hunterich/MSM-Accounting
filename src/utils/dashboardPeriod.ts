export function jakartaToday(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type: string) => parts.find(p => p.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}

export function dashboardPeriod(kind: 'month' | 'year', offset: number, today = jakartaToday()) {
    const [year, month] = today.split('-').map(Number);
    const start = new Date(Date.UTC(year + (kind === 'year' ? offset : 0), kind === 'month' ? month - 1 + offset : 0, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear() + (kind === 'year' ? 1 : 0), start.getUTCMonth() + (kind === 'month' ? 1 : 0), 0));
    return { dateFrom: start.toISOString().slice(0, 10), dateTo: offset === 0 ? today : end.toISOString().slice(0, 10) };
}

export function previousYear(date: string): string {
    const [year, month, day] = date.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
    return `${year - 1}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function periodLabel(from: string, to: string, language: 'en' | 'id' = 'en'): string {
    const format = (day: string) => new Intl.DateTimeFormat(language === 'id' ? 'id-ID' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
    return `${format(from)} – ${format(to)}`;
}

export function percentageChange(current: number, previous: number): number | null {
    return previous === 0 ? null : (current - previous) / Math.abs(previous) * 100;
}

const RING_COLORS = { cogs: '#ffca36', expenditure: '#ff5d88', profit: '#26d7b0' } as const;

/**
 * Where income went: COGS + expenditure + profit equals income. A loss has no
 * profit slice, so the ring then splits the costs that exceeded income.
 */
export function profitRing({ cogs, expenditure, profit }: { cogs: number; expenditure: number; profit: number }) {
    const segments = ([['cogs', cogs], ['expenditure', expenditure], ['profit', profit]] as const)
        .filter(([, value]) => value > 0)
        .map(([key, value]) => ({ key, value, color: RING_COLORS[key] }));
    const total = segments.reduce((sum, segment) => sum + segment.value, 0);
    let end = 0;
    const stops = segments.map(segment => {
        const start = end;
        end += segment.value / total * 100;
        return `${segment.color} ${start}% ${end}%`;
    });
    return { segments, gradient: total > 0 ? `conic-gradient(${stops.join(', ')})` : '' };
}

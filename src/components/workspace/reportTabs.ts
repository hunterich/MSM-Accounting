import type { ReportDefinition, ReportParams } from '../../views/reports/Reports';
import { makeTabId, type TabTarget } from '../../stores/workspace/types';

/** Key-order-independent serialization, so equal filters always map to one tab. */
function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined && v !== '' && v !== null)
            .sort(([a], [b]) => a.localeCompare(b));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

/** Short FNV-1a hash of the filters: one report tab per distinct filter set. */
export function reportParamsKey(params: ReportParams): string {
    const text = stableStringify(params);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

export function reportTabTarget(report: ReportDefinition, params: ReportParams): TabTarget {
    return { module: 'reports', entity: report.id, recordId: reportParamsKey(params), mode: 'view' };
}

export function reportTabId(report: ReportDefinition, params: ReportParams): string {
    return makeTabId(reportTabTarget(report, params));
}

/** `2026-10-08` → `08/10/2026`, independent of the browser's timezone. */
function dayLabel(day: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : day;
}

/** Tab title that tells same-report tabs apart by their period. */
export function reportTabTitle(report: ReportDefinition, params: ReportParams | undefined): string {
    if (params?.dateFrom && params?.dateTo) return `${report.name} · ${dayLabel(params.dateFrom)}–${dayLabel(params.dateTo)}`;
    if (params?.asOfDate) return `${report.name} · ${dayLabel(params.asOfDate)}`;
    return report.name;
}

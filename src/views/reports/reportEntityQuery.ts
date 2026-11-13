import { api } from '../../api/apiClient';
import type { ListResponse } from '../../types';

export type ReportEntityKind = 'customers' | 'vendors' | 'items';
export interface ReportEntity {
  id: string;
  name: string;
  code?: string;
  sku?: string;
}

export const REPORT_PICKER_PAGE_SIZE = 20;

/** Search the complete catalog on the server, including archived master records. */
export function reportEntityQuery(kind: ReportEntityKind, search: string, page: number) {
  return {
    page,
    limit: REPORT_PICKER_PAGE_SIZE,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(kind === 'items' ? { isActive: 'all' } : { status: 'ALL' }),
  };
}

export function fetchReportEntities(kind: ReportEntityKind, search: string, page: number) {
  return api.get<ListResponse<ReportEntity>>(`/api/v1/${kind}`, reportEntityQuery(kind, search, page));
}

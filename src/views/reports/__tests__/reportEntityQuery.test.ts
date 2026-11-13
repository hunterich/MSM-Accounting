import { describe, expect, it, vi } from 'vitest';
import { fetchReportEntities, reportEntityQuery } from '../reportEntityQuery';
import { api } from '../../../api/apiClient';

vi.mock('../../../api/apiClient', () => ({ api: { get: vi.fn() } }));

describe('report entity search', () => {
  it('searches all master records with bounded pages, including archived records', () => {
    expect(reportEntityQuery('customers', '  West  ', 6)).toEqual({ page: 6, limit: 20, search: 'West', status: 'ALL' });
    expect(reportEntityQuery('vendors', '', 1)).toEqual({ page: 1, limit: 20, status: 'ALL' });
    expect(reportEntityQuery('items', 'SKU200', 1)).toEqual({ page: 1, limit: 20, search: 'SKU200', isActive: 'all' });
  });

  it('fetches only the requested page rather than walking the catalog', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [{ id: 'later', name: 'Beyond first page' }], total: 10000, page: 6, limit: 20 });
    const result = await fetchReportEntities('customers', '', 6);
    expect(api.get).toHaveBeenCalledExactlyOnceWith('/api/v1/customers', { page: 6, limit: 20, status: 'ALL' });
    expect(result.data[0].id).toBe('later');
  });
});

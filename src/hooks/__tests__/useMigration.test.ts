import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/apiClient', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api } from '../../api/apiClient';
import { migrationApi } from '../useMigration';

beforeEach(() => vi.clearAllMocks());

describe('migrationApi', () => {
  it('create posts cutoverDate', async () => {
    (api.post as any).mockResolvedValue({ id: 'b1', status: 'DRAFT' });
    const r = await migrationApi.create('2026-01-01');
    expect(api.post).toHaveBeenCalledWith('/api/v1/migration/batches', { cutoverDate: '2026-01-01' });
    expect(r.id).toBe('b1');
  });

  it('list GETs batches', async () => {
    (api.get as any).mockResolvedValue([]);
    await migrationApi.list();
    expect(api.get).toHaveBeenCalledWith('/api/v1/migration/batches');
  });

  it('get GETs one batch', async () => {
    (api.get as any).mockResolvedValue({ id: 'b1' });
    await migrationApi.get('b1');
    expect(api.get).toHaveBeenCalledWith('/api/v1/migration/batches/b1');
  });

  it('stage posts entity + rows', async () => {
    (api.post as any).mockResolvedValue({ staged: 2, errors: [] });
    await migrationApi.stage('b1', 'customers', [{ name: 'A' }, { name: 'B' }]);
    expect(api.post).toHaveBeenCalledWith('/api/v1/migration/batches/b1/stage', { entity: 'customers', rows: [{ name: 'A' }, { name: 'B' }] });
  });

  it('reconcile GETs checks', async () => {
    (api.get as any).mockResolvedValue({ ok: true, checks: [] });
    await migrationApi.reconcile('b1');
    expect(api.get).toHaveBeenCalledWith('/api/v1/migration/batches/b1/reconcile');
  });

  it('commit and rollback POST empty body', async () => {
    (api.post as any).mockResolvedValue({});
    await migrationApi.commit('b1'); await migrationApi.rollback('b1');
    expect(api.post).toHaveBeenCalledWith('/api/v1/migration/batches/b1/commit', {});
    expect(api.post).toHaveBeenCalledWith('/api/v1/migration/batches/b1/rollback', {});
  });
});

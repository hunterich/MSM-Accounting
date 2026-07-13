import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Auth (withPermission → requirePermission) only touches prisma for non-ADMIN
// callers; the ADMIN role used below short-circuits before any query. Stub it
// anyway so the module graph never opens a real DB connection.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

vi.mock('@/lib/cors', () => ({
  withCors: (r: Response) => r,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));

// The routes delegate to the already-tested migration services; this smoke test
// verifies the HTTP wiring (auth, params, entity validation, ok()), so the
// services are mocked.
vi.mock('@/lib/migration/batch-service', () => ({
  createBatch: vi.fn(async (orgId: string, cutoverDate: Date) => ({
    id: 'batch-1',
    organizationId: orgId,
    cutoverDate,
    status: 'DRAFT',
  })),
  listBatches: vi.fn(async () => []),
  getBatch: vi.fn(async () => ({
    id: 'batch-1',
    organizationId: 'org-a',
    status: 'DRAFT',
    stagedData: {},
  })),
  stageEntity: vi.fn(async (_orgId: string, _id: string, _entity: string, rows: unknown[]) => ({
    staged: rows.length,
    errors: [],
  })),
}));

vi.mock('@/lib/migration/commit', () => ({
  buildReconcileInput: vi.fn(async () => ({
    controlCodes: { ar: '1100', ap: '2100', inventory: '1300' },
    trialBalance: [],
    openAr: [],
    openAp: [],
    openingStock: [],
  })),
  commitBatch: vi.fn(async () => ({ committed: true, reconcile: { ok: true, checks: [] } })),
}));

vi.mock('@/lib/migration/reconcile', () => ({
  reconcileMigration: vi.fn(() => ({
    ok: true,
    checks: [{ id: 'tb-balanced', label: 'x', expected: 0, actual: 0, pass: true }],
  })),
}));

import { getBatch } from '@/lib/migration/batch-service';
import { commitBatch } from '@/lib/migration/commit';
import { POST as createBatchRoute, GET as listBatchesRoute } from '../migration/batches/route';
import { GET as getBatchRoute } from '../migration/batches/[id]/route';
import { POST as stageRoute } from '../migration/batches/[id]/stage/route';
import { GET as reconcileRoute } from '../migration/batches/[id]/reconcile/route';
import { POST as commitRoute } from '../migration/batches/[id]/commit/route';

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function req(path: string, method: string, body?: unknown, auth = true) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) {
    headers['x-org-id'] = 'org-a';
    headers['x-user-id'] = 'u1';
    headers['x-role-type'] = 'ADMIN';
  }
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => vi.clearAllMocks());

describe('migration API routes', () => {
  it('enforces auth: a request with no org/user identity is rejected (401)', async () => {
    const res = await createBatchRoute(
      req('/api/v1/migration/batches', 'POST', { cutoverDate: '2026-01-01' }, false),
    );
    expect(res.status).toBe(401);
  });

  it('POST /batches creates a batch → 200 with an id', async () => {
    const res = await createBatchRoute(
      req('/api/v1/migration/batches', 'POST', { cutoverDate: '2026-01-01' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('batch-1');
    expect(body.status).toBe('DRAFT');
  });

  it('POST /batches rejects a missing cutoverDate (400)', async () => {
    const res = await createBatchRoute(req('/api/v1/migration/batches', 'POST', {}));
    expect(res.status).toBe(400);
  });

  it('GET /batches lists batches → 200', async () => {
    const res = await listBatchesRoute(req('/api/v1/migration/batches', 'GET'));
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('POST /batches/[id]/stage stages customers → 200 with a staged count', async () => {
    const res = await stageRoute(
      req('/api/v1/migration/batches/batch-1/stage', 'POST', {
        entity: 'customers',
        rows: [{ name: 'Acme' }, { name: 'Globex' }],
      }),
      params('batch-1'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.staged).toBe(2);
    expect(body.errors).toEqual([]);
  });

  it('POST /batches/[id]/stage rejects an unknown entity (400)', async () => {
    const res = await stageRoute(
      req('/api/v1/migration/batches/batch-1/stage', 'POST', {
        entity: 'not-an-entity',
        rows: [],
      }),
      params('batch-1'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /batches/[id]/reconcile returns a checks array → 200', async () => {
    const res = await reconcileRoute(
      req('/api/v1/migration/batches/batch-1/reconcile', 'GET'),
      params('batch-1'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.checks)).toBe(true);
    expect(body.checks.length).toBeGreaterThan(0);
  });

  it('POST /batches/[id]/commit returns HTTP 200 (not an error) when reconciliation fails', async () => {
    // A failed reconcile must surface as a 200 carrying committed:false + the
    // failed checks, so the UI can render exactly what did not tie out — never a
    // 4xx/5xx that would hide the checks behind an error envelope.
    vi.mocked(commitBatch).mockResolvedValueOnce({
      committed: false,
      reconcile: {
        ok: false,
        checks: [
          { id: 'tb-balanced', label: 'Trial balance debits equal credits', expected: 1, actual: 0, pass: false },
        ],
      },
    });
    const res = await commitRoute(
      req('/api/v1/migration/batches/batch-1/commit', 'POST'),
      params('batch-1'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.committed).toBe(false);
    expect(Array.isArray(body.reconcile.checks)).toBe(true);
    expect(body.reconcile.checks.length).toBeGreaterThan(0);
    expect(body.reconcile.checks[0].pass).toBe(false);
  });

  it('GET /batches/[id] responds 404 when the batch does not exist', async () => {
    vi.mocked(getBatch).mockResolvedValueOnce(null);
    const res = await getBatchRoute(
      req('/api/v1/migration/batches/missing/', 'GET'),
      params('missing'),
    );
    expect(res.status).toBe(404);
  });
});

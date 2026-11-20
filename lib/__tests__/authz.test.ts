import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const findFirst = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { userOrganization: { findFirst: (...a: unknown[]) => findFirst(...a) } },
}));

import { requirePermission, withPermission, authActor, permittedModules } from '../authz';
import { READ_SCOPES, readScope } from '../authz-read-scopes';
import { ApiError } from '../errors';

function req(headers: Record<string, string>) {
  return { headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as never;
}
const ADMIN = { 'x-org-id': 'o1', 'x-user-id': 'u1', 'x-role-type': 'ADMIN' };
const VIEWER = { 'x-org-id': 'o1', 'x-user-id': 'u3', 'x-role-type': 'VIEWER' };

beforeEach(() => { findFirst.mockReset(); });

describe('requirePermission', () => {
  it('allows ADMIN without any DB lookup', async () => {
    await expect(requirePermission(req(ADMIN), 'HR_PAYROLL', 'create')).resolves.toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('allows when the role grants the action', async () => {
    findFirst.mockResolvedValue({ role: { permissions: [{ canView: true, canCreate: true, canEdit: false, canDelete: false, canApprove: false }] } });
    await expect(requirePermission(req({ 'x-org-id': 'o1', 'x-user-id': 'u2', 'x-role-type': 'CUSTOM' }), 'AR_INVOICES', 'create')).resolves.toBeUndefined();
  });

  it('throws 403 when the role lacks the action', async () => {
    findFirst.mockResolvedValue({ role: { permissions: [{ canView: true, canCreate: false, canEdit: false, canDelete: false, canApprove: false }] } });
    await expect(requirePermission(req(VIEWER), 'AR_INVOICES', 'create')).rejects.toMatchObject({ status: 403 });
  });

  it('throws 403 (fail-closed) when there is no membership/permission row', async () => {
    findFirst.mockResolvedValue(null);
    await expect(requirePermission(req({ 'x-org-id': 'o1', 'x-user-id': 'u4', 'x-role-type': 'CUSTOM' }), 'GL_JOURNAL', 'delete')).rejects.toBeInstanceOf(ApiError);
  });

  it('throws 401 when identity headers are missing', async () => {
    await expect(requirePermission(req({}), 'GL_JOURNAL', 'view')).rejects.toMatchObject({ status: 401 });
  });

  it('denies (no throw) when membership exists but has no role/permission rows', async () => {
    findFirst.mockResolvedValue({ id: 'm1' }); // truthy membership, role/permissions absent
    await expect(requirePermission(req(VIEWER), 'SETTINGS', 'edit')).rejects.toMatchObject({ status: 403 });
  });
});

describe('authActor', () => {
  it('returns identity from headers', () => {
    expect(authActor(req(ADMIN))).toEqual({ orgId: 'o1', userId: 'u1', roleType: 'ADMIN' });
  });
  it('throws 401 when org/user missing', () => {
    expect(() => authActor(req({ 'x-org-id': 'o1' }))).toThrow(ApiError);
  });
});

describe('withPermission', () => {
  it('runs the handler when permitted (ADMIN)', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withPermission({ module: 'AR_INVOICES', action: 'create' }, handler);
    const res = await wrapped(req(ADMIN));
    expect(handler).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });

  it('returns 403 and does NOT run the handler when denied', async () => {
    findFirst.mockResolvedValue({ role: { permissions: [{ canView: true, canCreate: false, canEdit: false, canDelete: false, canApprove: false }] } });
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withPermission({ module: 'AR_INVOICES', action: 'create' }, handler);
    const res = await wrapped(req(VIEWER));
    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
  });

  it('supports a dynamic descriptor function', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withPermission(() => ({ module: 'GL_JOURNAL', action: 'delete' }), handler);
    const res = await wrapped(req(ADMIN));
    expect(res.status).toBe(200);
  });

  it('passes ctx (route params) through to the handler', async () => {
    const handler = vi.fn(async (_req: unknown, ctx: { params: Promise<{ id: string }> }) => NextResponse.json({ id: (await ctx.params).id }));
    const wrapped = withPermission({ module: 'AR_INVOICES', action: 'edit' }, handler);
    const res = await wrapped(req(ADMIN), { params: Promise.resolve({ id: 'x1' }) });
    expect(await res.json()).toEqual({ id: 'x1' });
  });
});

describe('requirePermission with a list of modules (shared lookups)', () => {
  const row = (canView: boolean) => ({ canView, canCreate: false, canEdit: false, canDelete: false, canApprove: false });

  it('allows when any one listed module grants the action', async () => {
    findFirst.mockResolvedValue({ role: { permissions: [row(false), row(true)] } });
    await expect(requirePermission(req(VIEWER), ['AR_INVOICES', 'AP_BILLS'], 'view')).resolves.toBeUndefined();
    const where = findFirst.mock.calls[0][0].select.role.select.permissions.where;
    expect(where).toEqual({ moduleKey: { in: ['AR_INVOICES', 'AP_BILLS'] } });
  });

  it('denies when none of the listed modules grants the action', async () => {
    findFirst.mockResolvedValue({ role: { permissions: [row(false)] } });
    await expect(requirePermission(req(VIEWER), ['AR_INVOICES', 'AP_BILLS'], 'view'))
      .rejects.toMatchObject({ status: 403, message: expect.stringContaining('any of AR_INVOICES, AP_BILLS') });
  });

  it('denies an empty list without querying', async () => {
    await expect(requirePermission(req(VIEWER), [], 'view')).rejects.toMatchObject({ status: 403 });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('keeps the single-module query shape', async () => {
    findFirst.mockResolvedValue({ role: { permissions: [row(true)] } });
    await requirePermission(req(VIEWER), 'HR_EMPLOYEES', 'view');
    expect(findFirst.mock.calls[0][0].select.role.select.permissions.where).toEqual({ moduleKey: 'HR_EMPLOYEES' });
  });
});

describe('permittedModules', () => {
  it('returns ALL for ADMIN without a lookup', async () => {
    await expect(permittedModules(req(ADMIN), 'approve')).resolves.toBe('ALL');
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('returns the modules whose flag is set', async () => {
    findFirst.mockResolvedValue({ role: { permissions: [{ moduleKey: 'AR_INVOICES' }, { moduleKey: 'AP_POS' }] } });
    const got = await permittedModules(req(VIEWER), 'approve');
    expect(got).toEqual(new Set(['AR_INVOICES', 'AP_POS']));
    expect(findFirst.mock.calls[0][0].select.role.select.permissions.where).toEqual({ canApprove: true });
  });

  it('returns an empty set without a membership', async () => {
    findFirst.mockResolvedValue(null);
    await expect(permittedModules(req(VIEWER), 'view')).resolves.toEqual(new Set());
  });
});

describe('READ_SCOPES', () => {
  it('every scope is a non-empty list of distinct modules', () => {
    for (const [name, modules] of Object.entries(READ_SCOPES)) {
      expect(modules.length, name).toBeGreaterThan(0);
      expect(new Set(modules).size, name).toBe(modules.length);
    }
  });

  it('no scope lets DASHBOARD alone read shared records (widgets check their own module)', () => {
    for (const modules of Object.values(READ_SCOPES)) {
      expect(modules as readonly string[]).not.toContain('DASHBOARD');
    }
  });

  it('readScope builds a view descriptor', () => {
    expect(readScope('vendors')).toEqual({ module: READ_SCOPES.vendors, action: 'view' });
  });
});

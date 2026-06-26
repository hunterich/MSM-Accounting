import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const findFirst = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { userOrganization: { findFirst: (...a: unknown[]) => findFirst(...a) } },
}));

import { requirePermission, withPermission, authActor } from '../authz';
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

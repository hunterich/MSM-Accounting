import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';
import { prisma, createTestOrg, createCustomer, cleanupOrg, disconnect, assertTrialBalanced } from './harness';
import { signToken } from '../../auth';
import { middleware } from '../../../src/middleware';
import { POST as importOrders } from '../../../src/app/api/v1/integrations/[id]/import/route';
import { POST as createRole } from '../../../src/app/api/v1/roles/route';
import { PUT as updateRole } from '../../../src/app/api/v1/roles/[id]/route';
import { requirePermission } from '../../authz';

const fixtures: Array<{ orgId: string; userId: string }> = [];
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  for (const f of fixtures) { await cleanupOrg(f.orgId); await prisma.user.delete({ where: { id: f.userId } }); }
  await disconnect();
});
function clock(date: string) { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(date)); }
async function fixture() {
  const { orgId } = await createTestOrg();
  const role = await prisma.role.create({ data: {
    organizationId: orgId, name: 'Scheduled staff', roleType: 'CUSTOM',
    allowedDays: ['Mon'], startTime: '08:00', endTime: '17:00',
    permissions: { create: [{ moduleKey: 'AR_INVOICES', canCreate: true, canView: true }] },
  } });
  const user = await prisma.user.create({ data: { fullName: 'Schedule QA', email: `${orgId}@schedule.test` } });
  await prisma.userOrganization.create({ data: { userId: user.id, organizationId: orgId, roleId: role.id } });
  fixtures.push({ orgId, userId: user.id });
  process.env.JWT_SECRET = 'isolated-schedule-test-secret';
  const refreshToken = async () => { token = await signToken({ userId: user.id, email: user.email, memberships: [{ orgId, roleType: 'ADMIN' }] }); };
  let token = '';
  await refreshToken();
  const request = (path: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost/api/v1/${path}`, {
    method, headers: { cookie: `msm_token=${token}`, 'x-active-org': orgId, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { orgId, userId: user.id, role, request, refreshToken };
}
function forwarded(request: NextRequest, admission: NextResponse) {
  const headers = new Headers(request.headers);
  admission.headers.forEach((value, key) => {
    if (key.startsWith('x-middleware-request-')) headers.set(key.slice('x-middleware-request-'.length), value);
  });
  return new NextRequest(request, { headers });
}

describe('live PostgreSQL schedule enforcement', () => {
  it('reads current schedules and timezone, ignoring a stale ADMIN token; changes apply next request', async () => {
    clock('2026-10-19T09:59:59Z'); const f = await fixture();
    expect((await middleware(f.request('customers'))).headers.get('x-middleware-next')).toBe('1');
    await prisma.role.update({ where: { id: f.role.id }, data: { endTime: '16:00' } });
    expect((await middleware(f.request('customers'))).status).toBe(403);
    await prisma.role.update({ where: { id: f.role.id }, data: { endTime: '17:00' } });
    await prisma.organization.update({ where: { id: f.orgId }, data: { timezone: 'Asia/Makassar' } });
    expect((await middleware(f.request('customers'))).status).toBe(403);
    await prisma.role.update({ where: { id: f.role.id }, data: { roleType: 'ADMIN' } });
    expect((await middleware(f.request('customers'))).headers.get('x-middleware-next')).toBe('1');
  });

  it('does not grant a forbidden module even while the schedule permits access', async () => {
    clock('2026-10-19T05:00:00Z'); const f = await fixture();
    const req = f.request('bills'); const admitted = await middleware(req);
    await expect(requirePermission(forwarded(req, admitted), 'AP_BILLS', 'create')).rejects.toMatchObject({ status: 403 });
  });

  it('evaluates the selected membership rather than another company schedule', async () => {
    clock('2026-10-19T05:00:00Z'); const f = await fixture();
    const { orgId } = await createTestOrg();
    const role = await prisma.role.create({ data: { organizationId: orgId, name: 'Night', startTime: '22:00', endTime: '06:00' } });
    await prisma.userOrganization.create({ data: { organizationId: orgId, userId: f.userId, roleId: role.id } });
    const req = f.request('customers');
    req.headers.set('x-active-org', orgId);
    expect((await middleware(req)).status).toBe(403);
    expect((await middleware(f.request('customers'))).headers.get('x-middleware-next')).toBe('1');
    await cleanupOrg(orgId);
  });

  it('finishes an admitted real import after cutoff; blocks a new batch without changing documents or GL', async () => {
    clock('2026-10-19T09:59:59Z');
    const f = await fixture();
    const customerId = await createCustomer(f.orgId);
    await prisma.organization.update({ where: { id: f.orgId }, data: { taxEnabled: false } });
    const item = await prisma.item.create({ data: { organizationId: f.orgId, sku: 'SCHEDULE-SERVICE', name: 'Service', type: 'SERVICE', sellingPrice: 100 } });
    const connection = await prisma.ecommerceConnection.create({ data: { organizationId: f.orgId, shopName: 'QA', platform: 'SHOPEE', customerId } });
    const orders = ['SCHEDULE-1', 'SCHEDULE-2'].map(orderNo => ({ orderNo, issueDate: '2026-10-19', lines: [{ itemId: item.id, description: 'Service', sku: item.sku, quantity: 1, unitPrice: 100 }] }));
    const req = f.request(`integrations/${connection.id}/import`, 'POST', { orders, options: { recordPayment: false } });
    clock('2026-10-19T09:59:59Z');
    const admitted = await middleware(req);
    expect(admitted.headers.get('x-middleware-next')).toBe('1');
    vi.setSystemTime(new Date('2026-10-19T10:00:02Z'));
    const result = await importOrders(forwarded(req, admitted), { params: Promise.resolve({ id: connection.id }) });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ created: 2, failed: [] });
    const before = {
      invoices: await prisma.salesInvoice.findMany({ where: { organizationId: f.orgId }, orderBy: { id: 'asc' } }),
      journals: await prisma.journalEntry.findMany({ where: { organizationId: f.orgId }, include: { lines: true }, orderBy: { id: 'asc' } }),
    };
    expect(before.invoices).toHaveLength(2);
    expect(before.invoices.reduce((sum, i) => sum + Number(i.totalAmount), 0)).toBe(200);
    expect(before.journals.flatMap(j => j.lines).reduce((sum, line) => sum + Number(line.debit), 0)).toBe(200);
    expect(before.journals.flatMap(j => j.lines).reduce((sum, line) => sum + Number(line.credit), 0)).toBe(200);
    expect((await middleware(f.request(`integrations/${connection.id}/import`, 'POST', { orders, options: { recordPayment: false } }))).status).toBe(403);
    expect(await prisma.salesInvoice.findMany({ where: { organizationId: f.orgId }, orderBy: { id: 'asc' } })).toEqual(before.invoices);
    expect(await prisma.journalEntry.findMany({ where: { organizationId: f.orgId }, include: { lines: true }, orderBy: { id: 'asc' } })).toEqual(before.journals);
    await assertTrialBalanced(f.orgId);
    // Next-day retry rechecks source order IDs rather than posting duplicates.
    await prisma.role.update({ where: { id: f.role.id }, data: { allowedDays: ['Tue'] } });
    vi.setSystemTime(new Date('2026-10-20T05:00:00Z'));
    await f.refreshToken();
    const retry = f.request(`integrations/${connection.id}/import`, 'POST', { orders, options: { recordPayment: false } });
    const nextAdmission = await middleware(retry);
    const retried = await importOrders(forwarded(retry, nextAdmission), { params: Promise.resolve({ id: connection.id }) });
    expect(await retried.json()).toMatchObject({ created: 0, skipped: 2, failed: [] });
    expect(await prisma.salesInvoice.count({ where: { organizationId: f.orgId } })).toBe(2);
  });

  it('validates role create and merged partial updates without changing an invalid schedule', async () => {
    const f = await fixture();
    await prisma.role.update({ where: { id: f.role.id }, data: { roleType: 'ADMIN' } });
    const create = async (data: unknown) => {
      const req = f.request('roles', 'POST', data); const admitted = await middleware(req);
      return createRole(forwarded(req, admitted));
    };
    expect((await create({ name: 'Bad day', allowedDays: ['Monday'] })).status).toBe(400);
    expect((await create({ name: 'Half window', startTime: '08:00' })).status).toBe(400);
    expect((await create({ name: 'Equal window', startTime: '08:00', endTime: '08:00' })).status).toBe(400);
    const valid = await create({ name: 'Unrestricted', allowedDays: [], startTime: null, endTime: null });
    expect(valid.status).toBe(201);
    const saved = await valid.json();
    const req = f.request(`roles/${saved.id}`, 'PUT', { startTime: '08:00' });
    const admitted = await middleware(req);
    expect((await updateRole(forwarded(req, admitted), { params: Promise.resolve({ id: saved.id }) })).status).toBe(400);
    expect(await prisma.role.findUnique({ where: { id: saved.id } })).toMatchObject({ startTime: null, endTime: null });
  });

  it('serializes concurrent partial schedule edits so they cannot create an equal-time lockout', async () => {
    const f = await fixture();
    await prisma.role.update({ where: { id: f.role.id }, data: { roleType: 'ADMIN' } });
    const target = await prisma.role.create({ data: { organizationId: f.orgId, name: 'Concurrent schedule', startTime: '08:00', endTime: '17:00' } });
    const requests = [{ startTime: '09:00' }, { endTime: '09:00' }].map(body => f.request(`roles/${target.id}`, 'PUT', body));
    const admitted = await Promise.all(requests.map(req => middleware(req)));
    const results = await Promise.all(requests.map((req, index) => updateRole(forwarded(req, admitted[index]), { params: Promise.resolve({ id: target.id }) })));
    expect(results.map(r => r.status).sort()).toEqual([200, 400]);
    const saved = await prisma.role.findUniqueOrThrow({ where: { id: target.id } });
    expect(saved.startTime).not.toBe(saved.endTime);
  });
});

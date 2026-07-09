import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import { GET as getTargets, PUT as putTargets } from '@/src/app/api/v1/pos/targets/route';

afterAll(async () => { await disconnect(); });

function adminReq(orgId: string, url: string, init?: RequestInit) {
  return new NextRequest(url, {
    ...init,
    headers: { 'x-org-id': orgId, 'x-user-id': 'admin', 'x-role-type': 'ADMIN', 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

async function makeEmployee(orgId: string, name: string) {
  return prisma.employee.create({
    data: { organizationId: orgId, employeeNo: `E-${name}-${Date.now()}`, name, joinDate: new Date('2026-01-01') },
    select: { id: true },
  });
}

describe('POS targets API', () => {
  it('upserts, lists, and clears monthly targets', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    const ani = await makeEmployee(org.orgId, 'Ani');
    const budi = await makeEmployee(org.orgId, 'Budi');

    const putRes = await putTargets(adminReq(org.orgId, 'http://localhost/api/v1/pos/targets', {
      method: 'PUT',
      body: JSON.stringify({ month: '2026-07', targets: [
        { employeeId: ani.id, targetAmount: 5000000 },
        { employeeId: budi.id, targetAmount: 4000000 },
      ] }),
    }));
    expect(putRes.status).toBe(200);

    const listRes = await getTargets(adminReq(org.orgId, 'http://localhost/api/v1/pos/targets?month=2026-07'));
    const list = await listRes.json();
    const aniRow = list.targets.find((t: any) => t.employeeId === ani.id);
    expect(aniRow.targetAmount).toBe(5000000);
    expect(list.targets.some((t: any) => t.employeeId === budi.id && t.targetAmount === 4000000)).toBe(true);

    // Clear Budi's target with null.
    await putTargets(adminReq(org.orgId, 'http://localhost/api/v1/pos/targets', {
      method: 'PUT',
      body: JSON.stringify({ month: '2026-07', targets: [{ employeeId: budi.id, targetAmount: null }] }),
    }));
    const after = await (await getTargets(adminReq(org.orgId, 'http://localhost/api/v1/pos/targets?month=2026-07'))).json();
    expect(after.targets.find((t: any) => t.employeeId === budi.id).targetAmount).toBeNull();

    await cleanupOrg(org.orgId);
  });

  it('rejects a caller without POS_REPORTS with 403', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    const role = await prisma.role.create({
      data: { organizationId: org.orgId, name: 'No Reports', roleType: 'CUSTOM',
        permissions: { create: [{ moduleKey: 'DASHBOARD', canView: true }] } },
      select: { id: true, roleType: true },
    });
    const user = await prisma.user.create({ data: { email: `nr-${Date.now()}@x.com`, fullName: 'NR', passwordHash: 'x' }, select: { id: true } });
    await prisma.userOrganization.create({ data: { userId: user.id, organizationId: org.orgId, roleId: role.id, isActive: true } });

    const req = new NextRequest('http://localhost/api/v1/pos/targets?month=2026-07', {
      headers: { 'x-org-id': org.orgId, 'x-user-id': user.id, 'x-role-type': role.roleType },
    });
    const res = await getTargets(req);
    expect(res.status).toBe(403);

    await cleanupOrg(org.orgId);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  it('does not upsert a target for another org\'s employee', async () => {
    const orgA = await createTestOrg({ costingMethod: 'FIFO' });
    const orgB = await createTestOrg({ costingMethod: 'FIFO' });
    const foreign = await makeEmployee(orgB.orgId, 'Foreign');
    await putTargets(adminReq(orgA.orgId, 'http://localhost/api/v1/pos/targets', {
      method: 'PUT',
      body: JSON.stringify({ month: '2026-07', targets: [{ employeeId: foreign.id, targetAmount: 999 }] }),
    }));
    const count = await prisma.posSalesTarget.count({ where: { organizationId: orgA.orgId } });
    expect(count).toBe(0);
    await cleanupOrg(orgA.orgId);
    await cleanupOrg(orgB.orgId);
  });
});

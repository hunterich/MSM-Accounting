import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, cleanupOrg, disconnect, type TestOrg } from './harness';
import { postPosSale } from '@/lib/pos/sale-posting';
import { GET as report } from '@/src/app/api/v1/pos/reports/sales-performance/route';

afterAll(async () => { await disconnect(); });

async function serviceOrg(): Promise<{ org: TestOrg; itemId: string; registerId: string; shiftId: string }> {
  const org = await createTestOrg({ costingMethod: 'FIFO' });
  await prisma.account.upsert({ where: { organizationId_code: { organizationId: org.orgId, code: '5100' } }, update: {}, create: { organizationId: org.orgId, code: '5100', name: 'COGS', type: 'EXPENSE', normalSide: 'DEBIT' } });
  await prisma.account.upsert({ where: { organizationId_code: { organizationId: org.orgId, code: '2130' } }, update: {}, create: { organizationId: org.orgId, code: '2130', name: 'PPN', type: 'LIABILITY', normalSide: 'CREDIT' } });
  await prisma.customer.create({ data: { organizationId: org.orgId, code: 'WALK-IN', name: 'Walk-in' } });
  const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: `SVC-${Date.now()}`, name: 'Haircut', type: 'SERVICE', sellingPrice: 50000, requiresBatchTracking: false }, select: { id: true } });
  const register = await prisma.posRegister.create({ data: { organizationId: org.orgId, code: 'REG-1', name: 'R1', warehouseId: org.warehouseId }, select: { id: true } });
  const shift = await prisma.posShift.create({ data: { organizationId: org.orgId, registerId: register.id, cashierId: 'cash', openingFloat: 0, status: 'OPEN' }, select: { id: true } });
  return { org, itemId: item.id, registerId: register.id, shiftId: shift.id };
}

function adminReq(orgId: string, url: string) {
  return new NextRequest(url, { headers: { 'x-org-id': orgId, 'x-user-id': 'admin', 'x-role-type': 'ADMIN' } });
}

describe('Sales Performance report', () => {
  it('rolls up per-employee sold vs target, with an Unassigned bucket', async () => {
    const o = await serviceOrg();
    const ani = await prisma.employee.create({ data: { organizationId: o.org.orgId, employeeNo: `A-${Date.now()}`, name: 'Ani', joinDate: new Date('2026-01-01') }, select: { id: true } });

    const line = (performedById?: string) => ({ itemId: o.itemId, description: 'Haircut', quantity: 1, price: 50000, discountPct: 0, performedById });
    // Two sales credited to Ani, one Unassigned (no performer, cashier has no staff record).
    await prisma.$transaction((tx) => postPosSale(tx, o.org.orgId, { clientSaleId: 's1', registerId: o.registerId, shiftId: o.shiftId, cashierId: 'cash', warehouseId: null, lines: [line(ani.id)], tenders: [{ method: 'CASH', amount: 50000 }], date: new Date('2026-07-05T05:00:00Z') }));
    await prisma.$transaction((tx) => postPosSale(tx, o.org.orgId, { clientSaleId: 's2', registerId: o.registerId, shiftId: o.shiftId, cashierId: 'cash', warehouseId: null, lines: [line(ani.id)], tenders: [{ method: 'CASH', amount: 50000 }], date: new Date('2026-07-06T05:00:00Z') }));
    await prisma.$transaction((tx) => postPosSale(tx, o.org.orgId, { clientSaleId: 's3', registerId: o.registerId, shiftId: o.shiftId, cashierId: 'cash', warehouseId: null, lines: [line(undefined)], tenders: [{ method: 'CASH', amount: 50000 }], date: new Date('2026-07-07T05:00:00Z') }));

    await prisma.posSalesTarget.create({ data: { organizationId: o.org.orgId, employeeId: ani.id, month: '2026-07', targetAmount: 500000 } });

    const res = await report(adminReq(o.org.orgId, 'http://localhost/api/v1/pos/reports/sales-performance?month=2026-07'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const aniRow = body.rows.find((r: any) => r.employeeId === ani.id);
    // Each Haircut line subtotal is the pre-tax 50000 (tax is embedded in the gross tender).
    expect(aniRow.sold).toBe(100000);
    expect(aniRow.target).toBe(500000);
    const unassigned = body.rows.find((r: any) => r.employeeId === null);
    expect(unassigned.sold).toBe(50000);
    expect(body.totals.sold).toBe(150000);

    await cleanupOrg(o.org.orgId);
  });

  it('is org-scoped and rejects callers without POS_REPORTS', async () => {
    const o = await serviceOrg();
    const role = await prisma.role.create({ data: { organizationId: o.org.orgId, name: 'NR', roleType: 'CUSTOM', permissions: { create: [{ moduleKey: 'DASHBOARD', canView: true }] } }, select: { id: true, roleType: true } });
    const user = await prisma.user.create({ data: { email: `nr2-${Date.now()}@x.com`, fullName: 'NR', passwordHash: 'x' }, select: { id: true } });
    await prisma.userOrganization.create({ data: { userId: user.id, organizationId: o.org.orgId, roleId: role.id, isActive: true } });
    const denied = await report(new NextRequest('http://localhost/api/v1/pos/reports/sales-performance?month=2026-07', { headers: { 'x-org-id': o.org.orgId, 'x-user-id': user.id, 'x-role-type': role.roleType } }));
    expect(denied.status).toBe(403);
    await cleanupOrg(o.org.orgId);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });
});

import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import { POST as createSale } from '@/src/app/api/v1/pos/sales/route';
import { GET as getCatalog } from '@/src/app/api/v1/pos/catalog/route';

afterAll(async () => {
  await disconnect();
});

describe('POS authorization + cross-org isolation', () => {
  // ------------------------------------------------------------------
  // (a) A real non-ADMIN caller without POS_RETAIL is rejected with 403.
  //     `requirePermission` resolves the caller's grant by querying
  //     UserOrganization (userId + organizationId + isActive) -> Role ->
  //     RolePermission (moduleKey). We build exactly those rows: a CUSTOM
  //     role granted only DASHBOARD.view (NO POS_RETAIL), a User, and an
  //     active UserOrganization link. The x-role-type header is the role's
  //     non-ADMIN type ('CUSTOM'), so the ADMIN bypass does NOT apply.
  // ------------------------------------------------------------------
  it('returns 403 for a non-ADMIN caller lacking POS_RETAIL', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });

    const role = await prisma.role.create({
      data: {
        organizationId: org.orgId,
        name: 'Dashboard Only',
        roleType: 'CUSTOM',
        // Only DASHBOARD view — deliberately NO POS_RETAIL permission row.
        permissions: {
          create: [
            { moduleKey: 'DASHBOARD', canView: true, canCreate: false, canEdit: false, canDelete: false, canApprove: false },
          ],
        },
      },
      select: { id: true, roleType: true },
    });

    const user = await prisma.user.create({
      data: { email: `pos-noperm-${Date.now()}@example.com`, fullName: 'No POS User', passwordHash: 'x' },
      select: { id: true },
    });

    await prisma.userOrganization.create({
      data: { userId: user.id, organizationId: org.orgId, roleId: role.id, isActive: true },
    });

    const req = new NextRequest('http://localhost/api/v1/pos/sales', {
      method: 'POST',
      headers: {
        'x-org-id': org.orgId,
        'x-user-id': user.id,
        'x-role-type': role.roleType, // 'CUSTOM' — NOT 'ADMIN', so the gate runs
        'content-type': 'application/json',
      },
      // Minimal body — the request must be rejected by the gate before posting.
      body: JSON.stringify({
        clientSaleId: 'iso-403',
        registerId: 'nonexistent-register',
        shiftId: 'nonexistent-shift',
        lines: [{ itemId: 'nonexistent-item', description: 'x', quantity: 1, price: 1000, discountPct: 0 }],
        tenders: [{ method: 'CASH', amount: 1000 }],
      }),
    });

    const res = await createSale(req);
    expect(res.status).toBe(403);

    await cleanupOrg(org.orgId);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  // ------------------------------------------------------------------
  // (b) The catalog is org-scoped: querying org B must never surface org A's
  //     items. ADMIN is fine here — the point is org-scoping, not the gate.
  // ------------------------------------------------------------------
  it('does not leak another org\'s catalog items across the org boundary', async () => {
    const orgA = await createTestOrg({ costingMethod: 'FIFO' });
    const orgB = await createTestOrg({ costingMethod: 'FIFO' });

    const skuA = `SKU-A-${Date.now()}`;
    await prisma.item.create({
      data: { organizationId: orgA.orgId, sku: skuA, name: 'Org A Only Product', type: 'PRODUCT', sellingPrice: 5000, costPrice: 2000 },
    });

    const req = new NextRequest('http://localhost/api/v1/pos/catalog', {
      method: 'GET',
      headers: { 'x-org-id': orgB.orgId, 'x-user-id': 'admin-b', 'x-role-type': 'ADMIN' },
    });

    const res = await getCatalog(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // ok() returns the payload unwrapped (an array of catalog items).
    const catalog = Array.isArray(body) ? body : (body.data ?? []);
    expect(catalog.some((it: { sku: string }) => it.sku === skuA)).toBe(false);

    await cleanupOrg(orgA.orgId);
    await cleanupOrg(orgB.orgId);
  });
});

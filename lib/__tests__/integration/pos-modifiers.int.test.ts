import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import { GET as getCatalog } from '@/src/app/api/v1/pos/catalog/route';

afterAll(async () => {
  await disconnect();
});

describe('POS catalog serves resolved modifier groups', () => {
  // The catalog endpoint must attach, per item, the modifier groups that apply
  // to it (item-attached ∪ category-attached), with active options ordered by
  // sortOrder. Here a "Milk" SINGLE/required group is attached to the "Coffee"
  // CATEGORY, so the "Latte" item (in that category) must carry it.
  it('attaches category-linked groups with ordered options to the item', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });

    const category = await prisma.itemCategory.create({
      data: { organizationId: org.orgId, name: 'Coffee', code: `COF-${Date.now()}` },
      select: { id: true },
    });

    const latte = await prisma.item.create({
      data: {
        organizationId: org.orgId,
        sku: `LATTE-${Date.now()}`,
        name: 'Latte',
        type: 'PRODUCT',
        isActive: true,
        categoryId: category.id,
      },
      select: { id: true },
    });

    // Item backing the "Oat" option (option.itemId -> OatMilk).
    const oatMilk = await prisma.item.create({
      data: {
        organizationId: org.orgId,
        sku: `OATMILK-${Date.now()}`,
        name: 'OatMilk',
        type: 'PRODUCT',
        isActive: true,
      },
      select: { id: true },
    });

    const milkGroup = await prisma.modifierGroup.create({
      data: {
        organizationId: org.orgId,
        name: 'Milk',
        selectionType: 'SINGLE',
        isRequired: true,
        isActive: true,
        options: {
          create: [
            { name: 'Oat', priceDelta: 5000, itemId: oatMilk.id, sortOrder: 0, isActive: true },
            { name: 'Regular', priceDelta: 0, itemId: null, sortOrder: 1, isActive: true },
          ],
        },
        attachments: {
          create: [{ organizationId: org.orgId, itemCategoryId: category.id }],
        },
      },
      select: { id: true },
    });

    const req = new NextRequest('http://localhost/api/v1/pos/catalog', {
      method: 'GET',
      headers: { 'x-org-id': org.orgId, 'x-user-id': 'admin-1', 'x-role-type': 'ADMIN' },
    });

    const res = await getCatalog(req);
    expect(res.status).toBe(200);
    const raw = await res.json();
    const body = Array.isArray(raw) ? raw : (raw.data ?? []);

    const latteEntry = body.find((i: { id: string }) => i.id === latte.id);
    expect(latteEntry).toBeDefined();
    expect(latteEntry.modifierGroups).toHaveLength(1);
    expect(latteEntry.modifierGroups[0]).toMatchObject({
      id: milkGroup.id,
      selectionType: 'SINGLE',
      isRequired: true,
    });
    expect(latteEntry.modifierGroups[0].options.map((o: { name: string }) => o.name)).toEqual([
      'Oat',
      'Regular',
    ]);

    await cleanupOrg(org.orgId);
  });
});

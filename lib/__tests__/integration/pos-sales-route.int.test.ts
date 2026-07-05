import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import { receiveBatch } from '@/lib/pos/batch-stock-in';
import { POST as createSale } from '@/src/app/api/v1/pos/sales/route';

afterAll(async () => {
  await disconnect();
});

describe('POST /api/v1/pos/sales', () => {
  it('posts a sale for an ADMIN caller and returns 201', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    await prisma.account.upsert({ where: { organizationId_code: { organizationId: org.orgId, code: '5100' } }, update: {}, create: { organizationId: org.orgId, code: '5100', name: 'COGS', type: 'EXPENSE', normalSide: 'DEBIT' } });
    await prisma.account.upsert({ where: { organizationId_code: { organizationId: org.orgId, code: '2130' } }, update: {}, create: { organizationId: org.orgId, code: '2130', name: 'Output Tax', type: 'LIABILITY', normalSide: 'CREDIT' } });
    await prisma.customer.create({ data: { organizationId: org.orgId, code: 'WALK-IN', name: 'Walk-in' } });
    const item = await prisma.item.create({ data: { organizationId: org.orgId, sku: `SKU-${Date.now()}`, name: 'Paracetamol', type: 'PRODUCT', sellingPrice: 5000, costPrice: 2000, requiresBatchTracking: true }, select: { id: true } });
    const register = await prisma.posRegister.create({ data: { organizationId: org.orgId, code: 'REG-1', name: 'Register 1', warehouseId: org.warehouseId }, select: { id: true } });
    const shift = await prisma.posShift.create({ data: { organizationId: org.orgId, registerId: register.id, cashierId: 'u1', openingFloat: 0, status: 'OPEN' }, select: { id: true } });
    await prisma.$transaction((tx) => receiveBatch(tx, org.orgId, { itemId: item.id, warehouseId: org.warehouseId, batchNumber: 'B1', expiryDate: new Date('2027-01-01'), qty: 10, unitCost: 2000, date: new Date('2026-07-01') }));

    const req = new NextRequest('http://localhost/api/v1/pos/sales', {
      method: 'POST',
      headers: { 'x-org-id': org.orgId, 'x-user-id': 'u1', 'x-role-type': 'ADMIN', 'content-type': 'application/json' },
      body: JSON.stringify({ clientSaleId: 'route-1', registerId: register.id, shiftId: shift.id, lines: [{ itemId: item.id, description: 'Paracetamol', quantity: 2, price: 5000, discountPct: 0 }], tenders: [{ method: 'CASH', amount: 10000 }] }),
    });
    const res = await createSale(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    // ok() returns the payload unwrapped (NextResponse.json(data)), so no `.data` envelope.
    expect(body.totalAmount).toBe(10000);

    await cleanupOrg(org.orgId);
  });
});

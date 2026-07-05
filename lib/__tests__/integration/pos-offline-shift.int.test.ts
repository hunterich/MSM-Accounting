import { afterAll, describe, expect, it } from 'vitest';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import { openShift, closeShift } from '@/lib/pos/shift';

afterAll(async () => { await disconnect(); });

describe('offline shift idempotency', () => {
  it('openShift is idempotent on clientShiftId (replay returns the same shift)', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    const register = await prisma.posRegister.create({ data: { organizationId: org.orgId, code: 'REG-1', name: 'Register 1', warehouseId: org.warehouseId }, select: { id: true } });

    const first = await prisma.$transaction((tx) => openShift(tx, org.orgId, { registerId: register.id, cashierId: 'u1', openingFloat: 100000, clientShiftId: 'cs-1' }));
    const second = await prisma.$transaction((tx) => openShift(tx, org.orgId, { registerId: register.id, cashierId: 'u1', openingFloat: 100000, clientShiftId: 'cs-1' }));

    expect(second.id).toBe(first.id);
    const count = await prisma.posShift.count({ where: { organizationId: org.orgId, clientShiftId: 'cs-1' } });
    expect(count).toBe(1);
    await cleanupOrg(org.orgId);
  });

  it('closeShift is idempotent (second close returns the same result, no throw)', async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' });
    const register = await prisma.posRegister.create({ data: { organizationId: org.orgId, code: 'REG-1', name: 'Register 1', warehouseId: org.warehouseId }, select: { id: true } });
    const shift = await prisma.$transaction((tx) => openShift(tx, org.orgId, { registerId: register.id, cashierId: 'u1', openingFloat: 100000, clientShiftId: 'cs-2' }));

    const c1 = await prisma.$transaction((tx) => closeShift(tx, org.orgId, { shiftId: shift.id, countedCash: 100000 }));
    const c2 = await prisma.$transaction((tx) => closeShift(tx, org.orgId, { shiftId: shift.id, countedCash: 100000 }));

    expect(c1.status).toBe('CLOSED');
    expect(c2.status).toBe('CLOSED');
    expect(Number(c2.expectedCash)).toBe(Number(c1.expectedCash));
    await cleanupOrg(org.orgId);
  });
});

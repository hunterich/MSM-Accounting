import { beforeEach, describe, expect, it, vi } from 'vitest';
import { autoCloseDate, autoCloseDeadline, autoCloseStartDate, dateInTimezone, purchaseOrderIsDue, resolveAutoCloseOptions } from '../purchase-order-auto-close-config';
import { normalizePurchasePolicy, DEFAULT_PURCHASE_POLICY } from '../organization/settings-config';
import { autoClosePurchaseOrder, closeDuePurchaseOrders, reopenPurchaseOrder } from '../purchase-order-auto-close';
import { logAuditTx } from '../api-utils';

vi.mock('../api-utils', () => ({ logAuditTx: vi.fn(async () => undefined) }));

describe('purchase order auto-close policy', () => {
  it('preserves existing behavior until enabled and uses 30 days as the default', () => {
    expect(normalizePurchasePolicy(null)).toEqual({ autoCloseEnabled: false, autoCloseDays: 30, allowAutoCloseOverride: true });
    expect(normalizePurchasePolicy({ autoCloseDays: -1, autoCloseEnabled: 'yes' })).toEqual(DEFAULT_PURCHASE_POLICY);
    expect(normalizePurchasePolicy({ autoCloseDays: 0 }).autoCloseDays).toBe(0);
  });
  it('copies company defaults at creation', () => {
    expect(resolveAutoCloseOptions({ autoCloseEnabled: true, autoCloseDays: 45, allowAutoCloseOverride: false }, {})).toEqual({ autoCloseEnabled: true, autoCloseDays: 45 });
  });
  it('enforces the override flag for both creation and editing', () => {
    const policy = { ...DEFAULT_PURCHASE_POLICY, allowAutoCloseOverride: false };
    expect(() => resolveAutoCloseOptions(policy, { autoCloseEnabled: true })).toThrow(/disabled/);
    expect(() => resolveAutoCloseOptions(policy, { autoCloseDays: 45 }, { autoCloseEnabled: true, autoCloseDays: 30 })).toThrow(/disabled/);
    expect(resolveAutoCloseOptions(policy, {}, { autoCloseEnabled: true, autoCloseDays: 90 })).toEqual({ autoCloseEnabled: true, autoCloseDays: 90 });
  });
  it('allows both disabling an order and changing its day count', () => {
    expect(resolveAutoCloseOptions(DEFAULT_PURCHASE_POLICY, { autoCloseEnabled: true, autoCloseDays: 60 })).toEqual({ autoCloseEnabled: true, autoCloseDays: 60 });
    expect(resolveAutoCloseOptions(DEFAULT_PURCHASE_POLICY, { autoCloseEnabled: false }, { autoCloseEnabled: true, autoCloseDays: 90 }).autoCloseEnabled).toBe(false);
    expect(() => resolveAutoCloseOptions(DEFAULT_PURCHASE_POLICY, { autoCloseDays: 1.5 })).toThrow(/whole/);
  });
  it('calculates calendar deadlines across months and leap years', () => {
    expect(autoCloseDate('2026-09-01', 30)).toBe('2026-10-01');
    expect(autoCloseDate('2028-02-28', 1)).toBe('2028-02-29');
    expect(autoCloseDate(null, 30)).toBeNull();
  });
  it('uses the company calendar date rather than the server timezone', () => {
    const now = new Date('2026-09-30T18:00:00Z');
    expect(dateInTimezone(now, 'Asia/Jakarta')).toBe('2026-10-01');
    expect(dateInTimezone(now, 'America/Los_Angeles')).toBe('2026-09-30');
  });
  it('closes eligible approved/partial orders at the deadline; skips drafts, missing dates and disabled orders', () => {
    const po = { autoCloseEnabled: true, autoCloseDays: 30, date: '2026-09-01', status: 'APPROVED' };
    const tz = 'Asia/Jakarta';
    expect(purchaseOrderIsDue(po, '2026-09-30', tz)).toBe(false);
    expect(purchaseOrderIsDue(po, '2026-10-01', tz)).toBe(true);
    expect(purchaseOrderIsDue({ ...po, status: 'PARTIAL_RECEIVED' }, '2026-10-01', tz)).toBe(true);
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'CLOSED', 'CANCELLED']) expect(purchaseOrderIsDue({ ...po, status }, '2026-10-01', tz)).toBe(false);
    expect(purchaseOrderIsDue({ ...po, date: null }, '2026-10-01', tz)).toBe(false);
    expect(purchaseOrderIsDue({ ...po, autoCloseEnabled: false }, '2026-10-01', tz)).toBe(false);
  });
  it('counts from the PO date, not the expected delivery date (pilot example: 7 days)', () => {
    const po = { autoCloseEnabled: true, autoCloseDays: 7, date: new Date('2026-11-01T00:00:00Z'), expectedDate: new Date('2026-11-10T00:00:00Z') };
    expect(autoCloseStartDate(po, 'Asia/Jakarta')).toBe('2026-11-01');
    expect(autoCloseDeadline(po, 'Asia/Jakarta')).toBe('2026-11-08');
    expect(purchaseOrderIsDue({ ...po, status: 'PARTIAL_RECEIVED' }, '2026-11-07', 'Asia/Jakarta')).toBe(false);
    expect(purchaseOrderIsDue({ ...po, status: 'PARTIAL_RECEIVED' }, '2026-11-08', 'Asia/Jakarta')).toBe(true);
    const noExpectedDate = { ...po, expectedDate: null };
    expect(purchaseOrderIsDue({ ...noExpectedDate, status: 'APPROVED' }, '2026-11-08', 'Asia/Jakarta')).toBe(true);
  });
  it('restarts from the reopen day in the company timezone', () => {
    // 20 Nov 18:00 UTC is already 21 Nov in Jakarta.
    const po = { autoCloseEnabled: true, autoCloseDays: 7, date: '2026-11-01', reopenedAt: new Date('2026-11-20T18:00:00Z') };
    expect(autoCloseStartDate(po, 'Asia/Jakarta')).toBe('2026-11-21');
    expect(autoCloseDeadline(po, 'Asia/Jakarta')).toBe('2026-11-28');
    expect(autoCloseDeadline(po, 'UTC')).toBe('2026-11-27');
    expect(purchaseOrderIsDue({ ...po, status: 'APPROVED' }, '2026-11-21', 'Asia/Jakarta')).toBe(false);
    expect(purchaseOrderIsDue({ ...po, status: 'APPROVED' }, '2026-11-28', 'Asia/Jakarta')).toBe(true);
  });
});

const NOW = new Date('2026-09-30T18:00:00Z');
function fixture(overrides = {}) {
  const po = { id: 'po-1', organizationId: 'org-1', status: 'PARTIAL_RECEIVED', date: new Date('2026-09-01'), reopenedAt: null, autoCloseEnabled: true, autoCloseDays: 30, organization: { timezone: 'Asia/Jakarta' }, ...overrides };
  const tx = {
    $executeRaw: vi.fn(),
    purchaseOrder: { findFirst: vi.fn(async () => po), updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  return { tx, po };
}
beforeEach(() => vi.clearAllMocks());
describe('automatic close transaction', () => {
  it('takes the receipt lock before checking current state and audits the atomic close', async () => {
    const { tx } = fixture();
    expect(await autoClosePurchaseOrder(tx as any, 'org-1', 'po-1', NOW)).toBe(true);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.purchaseOrder.findFirst.mock.invocationCallOrder[0]);
    expect(tx.purchaseOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'po-1', organizationId: 'org-1' } }));
    expect(tx.purchaseOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ date: new Date('2026-09-01'), reopenedAt: null, autoCloseDays: 30 }),
      data: { status: 'CLOSED', autoClosedAt: NOW },
    }));
    expect(logAuditTx).toHaveBeenCalledWith(tx, expect.objectContaining({ orgId: 'org-1', entityId: 'po-1', payload: expect.objectContaining({ action: 'auto_close' }) }));
  });
  it('does nothing if a receipt or another worker already closed the PO', async () => {
    const { tx } = fixture({ status: 'CLOSED' });
    expect(await autoClosePurchaseOrder(tx as any, 'org-1', 'po-1', NOW)).toBe(false);
    expect(tx.purchaseOrder.updateMany).not.toHaveBeenCalled();
    expect(logAuditTx).not.toHaveBeenCalled();
  });
  it('audits only the worker that claimed the close', async () => {
    const { tx } = fixture();
    tx.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });
    expect(await autoClosePurchaseOrder(tx as any, 'org-1', 'po-1', NOW)).toBe(false);
    expect(logAuditTx).not.toHaveBeenCalled();
  });
  it('skips a future deadline', async () => {
    const { tx } = fixture({ autoCloseDays: 60 });
    expect(await autoClosePurchaseOrder(tx as any, 'org-1', 'po-1', NOW)).toBe(false);
  });
  it('does not close a reopened PO before its new deadline', async () => {
    const { tx } = fixture({ reopenedAt: new Date('2026-09-25T03:00:00Z') });
    expect(await autoClosePurchaseOrder(tx as any, 'org-1', 'po-1', NOW)).toBe(false);
    expect(tx.purchaseOrder.updateMany).not.toHaveBeenCalled();
  });
  it('sweeps orders using their own tenant and transactional state, with or without an expected date', async () => {
    const { tx } = fixture();
    const db = { purchaseOrder: { findMany: vi.fn(async () => [{ id: 'po-1', organizationId: 'org-1' }]) }, $transaction: vi.fn(async (fn) => fn(tx)) };
    expect(await closeDuePurchaseOrders(db as any, NOW)).toBe(1);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.purchaseOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { autoCloseEnabled: true, status: { in: ['APPROVED', 'PARTIAL_RECEIVED'] } },
    }));
  });
});

function reopenFixture(overrides = {}) {
  const po = { id: 'po-1', organizationId: 'org-1', status: 'CLOSED', date: new Date('2026-11-01'), reopenedAt: null,
    autoClosedAt: new Date('2026-11-08T01:00:00Z'), autoCloseEnabled: true, autoCloseDays: 7, organization: { timezone: 'Asia/Jakarta' },
    lines: [{ quantity: 240, receivedQty: 144 }], ...overrides };
  const tx = {
    $executeRaw: vi.fn(),
    purchaseOrder: { findFirst: vi.fn(async () => po), update: vi.fn(async ({ data }) => ({ ...po, ...data })) },
  };
  return { tx, po };
}
const REOPEN_AT = new Date('2026-11-20T03:00:00Z');
describe('reopen transaction', () => {
  it('reopens the pilot PO (144 of 240 pcs received), clears the auto-close mark and restarts the period', async () => {
    const { tx } = reopenFixture();
    const updated = await reopenPurchaseOrder(tx as any, 'org-1', 'po-1', 'user-1', REOPEN_AT);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.purchaseOrder.findFirst.mock.invocationCallOrder[0]);
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po-1', organizationId: 'org-1' },
      data: { status: 'PARTIAL_RECEIVED', reopenedAt: REOPEN_AT, autoClosedAt: null },
    });
    expect(updated.status).toBe('PARTIAL_RECEIVED');
    expect(logAuditTx).toHaveBeenCalledWith(tx, expect.objectContaining({
      actorId: 'user-1', entityId: 'po-1',
      payload: expect.objectContaining({ action: 'reopen', previousStatus: 'CLOSED', status: 'PARTIAL_RECEIVED', deadline: '2026-11-27' }),
    }));
  });
  it('restores APPROVED when nothing was received', async () => {
    const { tx } = reopenFixture({ lines: [{ quantity: 10, receivedQty: 0 }] });
    await reopenPurchaseOrder(tx as any, 'org-1', 'po-1', 'user-1', REOPEN_AT);
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }));
  });
  it('refuses orders that are not closed, fully received or missing, without writing', async () => {
    for (const status of ['APPROVED', 'PARTIAL_RECEIVED', 'CANCELLED', 'DRAFT']) {
      const { tx } = reopenFixture({ status });
      await expect(reopenPurchaseOrder(tx as any, 'org-1', 'po-1', 'user-1', REOPEN_AT)).rejects.toMatchObject({ status: 422 });
      expect(tx.purchaseOrder.update).not.toHaveBeenCalled();
    }
    const full = reopenFixture({ lines: [{ quantity: 240, receivedQty: 240 }] });
    await expect(reopenPurchaseOrder(full.tx as any, 'org-1', 'po-1', 'user-1', REOPEN_AT)).rejects.toThrow(/nothing to reopen/);
    expect(full.tx.purchaseOrder.update).not.toHaveBeenCalled();
    const missing = reopenFixture();
    missing.tx.purchaseOrder.findFirst.mockResolvedValue(null as any);
    await expect(reopenPurchaseOrder(missing.tx as any, 'org-1', 'po-1', 'user-1', REOPEN_AT)).rejects.toMatchObject({ status: 404 });
    expect(logAuditTx).not.toHaveBeenCalled();
  });
});

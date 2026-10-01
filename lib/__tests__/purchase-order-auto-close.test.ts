import { beforeEach, describe, expect, it, vi } from 'vitest';
import { autoCloseDate, dateInTimezone, purchaseOrderIsDue, resolveAutoCloseOptions } from '../purchase-order-auto-close-config';
import { normalizePurchasePolicy, DEFAULT_PURCHASE_POLICY } from '../organization/settings-config';
import { autoClosePurchaseOrder, closeDuePurchaseOrders } from '../purchase-order-auto-close';
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
    const po = { autoCloseEnabled: true, autoCloseDays: 30, expectedDate: '2026-09-01', status: 'APPROVED' };
    expect(purchaseOrderIsDue(po, '2026-09-30')).toBe(false);
    expect(purchaseOrderIsDue(po, '2026-10-01')).toBe(true);
    expect(purchaseOrderIsDue({ ...po, status: 'PARTIAL_RECEIVED' }, '2026-10-01')).toBe(true);
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'CLOSED', 'CANCELLED']) expect(purchaseOrderIsDue({ ...po, status }, '2026-10-01')).toBe(false);
    expect(purchaseOrderIsDue({ ...po, expectedDate: null }, '2026-10-01')).toBe(false);
    expect(purchaseOrderIsDue({ ...po, autoCloseEnabled: false }, '2026-10-01')).toBe(false);
  });
});

const NOW = new Date('2026-09-30T18:00:00Z');
function fixture(overrides = {}) {
  const po = { id: 'po-1', organizationId: 'org-1', status: 'PARTIAL_RECEIVED', expectedDate: new Date('2026-09-01'), autoCloseEnabled: true, autoCloseDays: 30, organization: { timezone: 'Asia/Jakarta' }, ...overrides };
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
    expect(tx.purchaseOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CLOSED', autoClosedAt: NOW } }));
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
  it('sweeps orders using their own tenant and transactional state', async () => {
    const { tx } = fixture();
    const db = { purchaseOrder: { findMany: vi.fn(async () => [{ id: 'po-1', organizationId: 'org-1' }]) }, $transaction: vi.fn(async (fn) => fn(tx)) };
    expect(await closeDuePurchaseOrders(db as any, NOW)).toBe(1);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});

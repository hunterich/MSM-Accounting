import { describe, expect, it, vi } from 'vitest';
import { userCanApprove, assertApprovalAuthorized } from '../can-approve';

describe('current approval authorization', () => {
  it('rejects an old admin claim when membership has been removed', async () => {
    const findFirst = vi.fn(async () => null);
    const db = { userOrganization: { findFirst } } as never;
    expect(await userCanApprove(db, 'org1', 'u1', 'ADMIN', 'AR_INVOICES')).toBe(false);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', organizationId: 'org1', isActive: true, user: { status: 'ACTIVE' } } }));
  });
  it('rejects self approval by a downgraded admin despite an old claim', async () => {
    const db = { userOrganization: { findFirst: vi.fn(async () => ({ role: { roleType: 'ACCOUNTANT', permissions: [{ canApprove: true }] } })) } } as never;
    await expect(assertApprovalAuthorized(db, { orgId: 'org1', userId: 'u1', roleType: 'ADMIN', moduleKey: 'AR_INVOICES', requestedById: 'u1', requireDistinctApproverForAdmins: false })).rejects.toMatchObject({ status: 403 });
  });
  it('allows a current administrator with no separate permission row', async () => {
    const db = { userOrganization: { findFirst: vi.fn(async () => ({ role: { roleType: 'ADMIN', permissions: [] } })) } } as never;
    expect(await userCanApprove(db, 'org1', 'u1', 'ACCOUNTANT', 'AR_INVOICES')).toBe(true);
  });
});

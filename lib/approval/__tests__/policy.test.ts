import { describe, expect, it } from 'vitest';
import { isApprovalAllowed } from '../policy';

const base = { hasCanApprove: true, isSelf: false, roleType: 'ACCOUNTANT', requireDistinctApproverForAdmins: false };

describe('isApprovalAllowed', () => {
  it('blocks when the user lacks canApprove', () => {
    expect(isApprovalAllowed({ ...base, hasCanApprove: false })).toEqual({ allowed: false, reason: 'no-permission' });
  });
  it('allows a different approver with permission', () => {
    expect(isApprovalAllowed(base)).toEqual({ allowed: true });
  });
  it('blocks self-approval for non-admins', () => {
    expect(isApprovalAllowed({ ...base, isSelf: true })).toEqual({ allowed: false, reason: 'self-approval' });
  });
  it('admins may self-approve by default (admins exempt)', () => {
    expect(isApprovalAllowed({ ...base, isSelf: true, roleType: 'ADMIN' })).toEqual({ allowed: true });
  });
  it('admins may NOT self-approve when the tightening toggle is on', () => {
    expect(isApprovalAllowed({ ...base, isSelf: true, roleType: 'ADMIN', requireDistinctApproverForAdmins: true }))
      .toEqual({ allowed: false, reason: 'self-approval' });
  });
});

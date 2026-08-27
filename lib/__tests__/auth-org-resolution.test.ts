import { describe, it, expect } from 'vitest';
import { resolveActiveOrg, isOrgOptionalPath, type TokenPayload } from '../auth';

const payload: TokenPayload = {
  userId: 'u1',
  email: 'a@b.c',
  memberships: [
    { orgId: 'org-a', roleType: 'ADMIN' },
    { orgId: 'org-b', roleType: 'FINANCE' },
  ],
};

describe('resolveActiveOrg', () => {
  it('picks the requested org when the user is a member', () => {
    expect(resolveActiveOrg(payload, 'org-b')).toEqual({
      ok: true, orgId: 'org-b', roleType: 'FINANCE',
    });
  });

  it('rejects an org the user is not a member of', () => {
    expect(resolveActiveOrg(payload, 'org-evil')).toEqual({
      ok: false, status: 403, error: 'Not a member of this organization', code: 'ORG_MEMBERSHIP',
    });
  });

  it('defaults to the sole membership when no header is sent', () => {
    const single: TokenPayload = { ...payload, memberships: [payload.memberships[0]] };
    expect(resolveActiveOrg(single, null)).toEqual({
      ok: true, orgId: 'org-a', roleType: 'ADMIN',
    });
  });

  it('treats an empty-string header as absent and defaults to the sole membership', () => {
    const single: TokenPayload = { ...payload, memberships: [payload.memberships[0]] };
    expect(resolveActiveOrg(single, '')).toEqual({
      ok: true, orgId: 'org-a', roleType: 'ADMIN',
    });
  });

  it('requires the header when the user has multiple memberships', () => {
    expect(resolveActiveOrg(payload, null)).toEqual({
      ok: false, status: 400, error: 'x-active-org header required', code: 'ORG_REQUIRED',
    });
  });

  it('rejects a payload with no memberships', () => {
    const none: TokenPayload = { ...payload, memberships: [] };
    expect(resolveActiveOrg(none, 'org-a')).toEqual({
      ok: false, status: 403, error: 'Not a member of this organization', code: 'ORG_MEMBERSHIP',
    });
  });
});

describe('isOrgOptionalPath', () => {
  it('lets company creation through without a tenant context', () => {
    expect(isOrgOptionalPath('/api/v1/organizations')).toBe(true);
  });

  it('ignores a trailing slash', () => {
    expect(isOrgOptionalPath('/api/v1/organizations/')).toBe(true);
  });

  it('does NOT open tenant-scoped sub-routes under the same prefix', () => {
    expect(isOrgOptionalPath('/api/v1/organizations/org-a')).toBe(false);
    expect(isOrgOptionalPath('/api/v1/organizations/org-a/settings')).toBe(false);
  });

  it('leaves every other route behind the org gate', () => {
    expect(isOrgOptionalPath('/api/v1/organization/settings')).toBe(false);
    expect(isOrgOptionalPath('/api/v1/invoices')).toBe(false);
  });
});

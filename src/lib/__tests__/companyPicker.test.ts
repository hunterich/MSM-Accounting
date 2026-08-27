import { describe, it, expect } from 'vitest';
import { shouldShowCompanyPicker, canCreateCompany } from '../companyPicker';

const gate = (over: Partial<Parameters<typeof shouldShowCompanyPicker>[0]> = {}) =>
  shouldShowCompanyPicker({
    isAuthenticated: true,
    needsOrgSelection: false,
    activeOrgId: 'org-a',
    ...over,
  });

describe('shouldShowCompanyPicker', () => {
  it('never shows for an unauthenticated visitor', () => {
    expect(gate({ isAuthenticated: false, activeOrgId: null, needsOrgSelection: true })).toBe(false);
  });

  it('shows after a fresh sign-in, when the tab has no company pinned', () => {
    expect(gate({ activeOrgId: null })).toBe(true);
  });

  it('shows for a single-company user too — the list is one row, not skipped', () => {
    // The gate has no membership count: one company still gets picked once.
    expect(gate({ activeOrgId: null, needsOrgSelection: false })).toBe(true);
  });

  it('stays out of the way once the tab is pinned to a company', () => {
    expect(gate({ activeOrgId: 'org-a' })).toBe(false);
  });

  it('re-shows when the server rejects the pinned company', () => {
    expect(gate({ activeOrgId: 'org-a', needsOrgSelection: true })).toBe(true);
  });
});

describe('canCreateCompany', () => {
  it('lets a brand-new user bootstrap their first company', () => {
    expect(canCreateCompany([])).toBe(true);
  });

  it('lets an admin of any company create another', () => {
    expect(canCreateCompany([
      { orgId: 'org-a', roleType: 'FINANCE' },
      { orgId: 'org-b', roleType: 'ADMIN' },
    ])).toBe(true);
  });

  it('refuses a user who administers nothing', () => {
    expect(canCreateCompany([
      { orgId: 'org-a', roleType: 'FINANCE' },
      { orgId: 'org-b', roleType: 'CASHIER' },
    ])).toBe(false);
  });
});

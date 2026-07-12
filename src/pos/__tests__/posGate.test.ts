import { describe, expect, it } from 'vitest';
import { resolvePosGate } from '../posGate';

describe('resolvePosGate', () => {
  it('pins the sole company when single-membership and nothing is pinned', () => {
    // The critical regression: single-company users have a server-defaulted org
    // but no pin — the gate must pin it rather than blank the till.
    expect(resolvePosGate({ activeOrgId: null, orgId: 'org-demo', membershipCount: 1, needsOrgSelection: false }))
      .toEqual({ kind: 'pin', orgId: 'org-demo' });
  });

  it('opens straight to the shell once an org is pinned', () => {
    expect(resolvePosGate({ activeOrgId: 'org-demo', orgId: 'org-demo', membershipCount: 1, needsOrgSelection: false }))
      .toEqual({ kind: 'ready' });
  });

  it('shows the picker for multiple companies with no pin (never auto-picks)', () => {
    expect(resolvePosGate({ activeOrgId: null, orgId: 'org-demo', membershipCount: 3, needsOrgSelection: false }))
      .toEqual({ kind: 'picker' });
  });

  it('does not show the picker for a multi-company user who already pinned an org', () => {
    expect(resolvePosGate({ activeOrgId: 'org-b', orgId: 'org-b', membershipCount: 3, needsOrgSelection: false }))
      .toEqual({ kind: 'ready' });
  });

  it('shows the picker when the server flags needsOrgSelection', () => {
    expect(resolvePosGate({ activeOrgId: null, orgId: null, membershipCount: 2, needsOrgSelection: true }))
      .toEqual({ kind: 'picker' });
  });

  it('waits (never touches a DB) when there is no pin and no resolved org', () => {
    expect(resolvePosGate({ activeOrgId: null, orgId: null, membershipCount: 1, needsOrgSelection: false }))
      .toEqual({ kind: 'wait' });
  });
});

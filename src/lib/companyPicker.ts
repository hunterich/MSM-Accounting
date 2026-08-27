/**
 * Pure decision helpers for the post-login company ("database") picker.
 *
 * Kept out of the components so they can be unit-tested without a DOM, and so
 * ProtectedRoute and CompanyPicker cannot drift on what "needs a picker" means.
 */

export interface PickerMembership {
  orgId: string;
  roleType: string;
}

export interface PickerGateInput {
  /** Session is authenticated. */
  isAuthenticated: boolean;
  /** Server could not resolve an active org for this request. */
  needsOrgSelection: boolean;
  /** This tab's pinned company, or null when it has not picked one yet. */
  activeOrgId: string | null;
}

/**
 * Accurate-style flow: every fresh sign-in lands on the company list.
 *
 * The tab's org pin is what separates "fresh sign-in" from "still working":
 * logout clears it and a new tab never had one, so a login always shows the
 * picker; selecting a company sets it, so reloads and in-app navigation go
 * straight through. Single-company users are NOT special-cased — they see a
 * one-row list once per sign-in, the same as Accurate Online.
 */
export function shouldShowCompanyPicker({
  isAuthenticated,
  needsOrgSelection,
  activeOrgId,
}: PickerGateInput): boolean {
  if (!isAuthenticated) return false;
  return needsOrgSelection || activeOrgId === null;
}

/**
 * Mirrors the server rule in `POST /api/v1/organizations`: creating a company
 * is an owner capability above module RBAC. A user with no company yet is
 * bootstrapping their first one and there is no admin who could grant it to
 * them; anyone else must already administer at least one company.
 *
 * Client-side this only decides whether to render the form — the route
 * enforces the same rule against the database.
 */
export function canCreateCompany(memberships: readonly PickerMembership[]): boolean {
  return memberships.length === 0 || memberships.some((m) => m.roleType === 'ADMIN');
}

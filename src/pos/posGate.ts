/**
 * Pure decision for what the POS shell should do once the session has resolved,
 * kept separate from PosApp so it is unit-testable without React/IndexedDB.
 *
 * The multi-company picker still owns the >1-membership case; this only
 * auto-pins when there is exactly ONE resolved company (the server defaults a
 * sole membership, and there is no ?org= handshake or picker to write the pin).
 * Auto-pinning the ONLY choice is not "auto-picking" among several.
 */
export type PosGate =
  | { kind: 'picker' }              // >1 membership (or rejected selection) and no pin → let the user choose
  | { kind: 'pin'; orgId: string }  // single resolved company, no pin yet → pin it, then open
  | { kind: 'ready' }               // org already pinned → open the shell
  | { kind: 'wait' };               // no pin and no resolved org → cannot open a DB safely; hold

export function resolvePosGate(input: {
  activeOrgId: string | null;
  orgId: string | null | undefined;
  membershipCount: number;
  needsOrgSelection: boolean;
}): PosGate {
  const { activeOrgId, orgId, membershipCount, needsOrgSelection } = input;

  // Multiple companies (or a rejected selection) with nothing pinned → picker.
  if (needsOrgSelection || (!activeOrgId && membershipCount > 1)) return { kind: 'picker' };

  if (!activeOrgId) {
    // No pin. Single resolved company → pin it. Otherwise we have no org to open
    // an org-scoped DB against, so hold rather than touch a shared/default DB.
    if (orgId) return { kind: 'pin', orgId };
    return { kind: 'wait' };
  }

  return { kind: 'ready' };
}

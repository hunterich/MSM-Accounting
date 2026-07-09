import { getActiveOrgId } from './activeOrg';

/**
 * zustand `persist` storage adapter that partitions keys per company: keys
 * become `<name>:<orgId>` (`:default` before an org is chosen). The active org
 * is resolved at call time; company switching is always a hard reload, so the
 * org is stable for the lifetime of a store — no rehydration juggling needed.
 *
 * Use for org-scoped persisted client state (workspace tabs, settings,
 * document caches). Org-agnostic preferences (theme, sidebar collapse, paper
 * size) stay on plain localStorage.
 */
export const orgScopedStorage = {
  getItem: (k: string) => localStorage.getItem(`${k}:${getActiveOrgId() ?? 'default'}`),
  setItem: (k: string, v: string) => localStorage.setItem(`${k}:${getActiveOrgId() ?? 'default'}`, v),
  removeItem: (k: string) => localStorage.removeItem(`${k}:${getActiveOrgId() ?? 'default'}`),
};

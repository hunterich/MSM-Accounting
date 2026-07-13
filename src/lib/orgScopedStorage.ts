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
const orgKey = (k: string): string => `${k}:${getActiveOrgId() ?? 'default'}`;

export const orgScopedStorage = {
  getItem: (k: string): string | null => {
    if (typeof localStorage === 'undefined') return null;
    try { return localStorage.getItem(orgKey(k)); } catch { return null; }
  },
  setItem: (k: string, v: string): void => {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(orgKey(k), v); } catch { /* private mode — state simply won't persist */ }
  },
  removeItem: (k: string): void => {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(orgKey(k)); } catch { /* noop */ }
  },
};

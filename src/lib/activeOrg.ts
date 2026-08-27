/**
 * Per-tab active company for multi-company support.
 *
 * sessionStorage is per-tab — that is precisely what lets two browser tabs run
 * two companies at once. localStorage only remembers the last-used org so the
 * company picker can preselect it.
 */

const SESSION_KEY = 'msm-active-org';
const LAST_KEY = 'msm-last-org';

// Document-lifetime fallback for browsers where sessionStorage throws (Safari
// private mode, "block all cookies"). Without it the picker gate — which reads
// getActiveOrgId() — would still be true after the ?org= reload and bounce the
// user straight back to the picker, forever. Set by the same bootstrap that
// consumes ?org=, so the new document is pinned either way; it simply does not
// survive a manual reload, which degrades to re-picking rather than a loop.
let inMemoryOrgId: string | null = null;

export function getActiveOrgId(): string | null {
  try { return sessionStorage.getItem(SESSION_KEY) ?? inMemoryOrgId; } catch { return inMemoryOrgId; }
}

export function setActiveOrgId(orgId: string): void {
  inMemoryOrgId = orgId;
  try {
    sessionStorage.setItem(SESSION_KEY, orgId);
    localStorage.setItem(LAST_KEY, orgId);
  } catch { /* private mode — header simply won't persist across reloads */ }
}

export function clearActiveOrg(): void {
  inMemoryOrgId = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* noop */ }
}

export function getLastOrgId(): string | null {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}

/** Consume ?org= (open-in-new-tab handshake) BEFORE the router mounts. */
export function bootstrapActiveOrg(): string | null {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('org');
    if (fromUrl) {
      setActiveOrgId(fromUrl);
      url.searchParams.delete('org');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
  } catch { /* noop */ }
  return getActiveOrgId();
}

// Also consume ?org= at module-evaluation time: ES imports are hoisted, so the
// explicit bootstrapActiveOrg() call in main.tsx runs AFTER the app's module
// graph — including zustand persist stores, which hydrate synchronously at
// import. This module is a dependency of every org-scoped store, so it always
// evaluates first, guaranteeing the new tab is pinned to its org before any
// storage key is computed. The main.tsx call is then an idempotent no-op.
if (typeof window !== 'undefined') bootstrapActiveOrg();

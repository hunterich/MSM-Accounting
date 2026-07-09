/**
 * Per-tab active company for multi-company support.
 *
 * sessionStorage is per-tab — that is precisely what lets two browser tabs run
 * two companies at once. localStorage only remembers the last-used org so the
 * company picker can preselect it.
 */

const SESSION_KEY = 'msm-active-org';
const LAST_KEY = 'msm-last-org';

export function getActiveOrgId(): string | null {
  try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; }
}

export function setActiveOrgId(orgId: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, orgId);
    localStorage.setItem(LAST_KEY, orgId);
  } catch { /* private mode — header simply won't persist across reloads */ }
}

export function clearActiveOrg(): void {
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

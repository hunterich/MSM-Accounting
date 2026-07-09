/**
 * Single source of truth for the base URL the frontend uses to reach the backend.
 *
 * Controlled by the build-time env var `VITE_API_URL`:
 *   - unset               → dev default: same host on port 3000 (Vite :5173 → Next :3000)
 *   - "/" or "same-origin" → relative to the current origin (returns ""). Use this for the
 *                            single-origin reverse-proxy deploy (Caddy serves the SPA and
 *                            proxies /api). Nothing host-specific is baked in, so the built
 *                            image is portable across environments.
 *   - an absolute URL      → used as-is, trailing slash trimmed (e.g. cross-origin setups)
 *
 * The pure signature (env + location passed in) keeps this unit-testable.
 */
export function resolveApiBase(
  envUrl: string | undefined = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL,
  loc: { protocol: string; hostname: string } | undefined =
    typeof window !== 'undefined' ? window.location : undefined,
): string {
  const raw = envUrl?.trim();
  if (raw) {
    if (raw === '/' || raw === 'same-origin') return '';
    return raw.replace(/\/+$/, '');
  }
  if (loc) return `${loc.protocol}//${loc.hostname}:3000`;
  return 'http://localhost:3000';
}

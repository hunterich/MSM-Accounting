/**
 * Central API client for MSM Accounting Software.
 * Reads VITE_API_URL and attaches credentials cookie on every request.
 * Tenant context is derived server-side from the session cookie — no x-org-id header is sent.
 */

const API_BASE = import.meta.env?.VITE_API_URL || 'http://localhost:3000';

function getHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { headers: extraHeaders, ...rest } = options;
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: getHeaders(extraHeaders as Record<string, string>),
    ...rest,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

function buildUrl(path: string, params?: Record<string, unknown>): string {
  if (!params) return path;
  const qs = new URLSearchParams(
    Object.fromEntries(
      Object.entries(params)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => [k, String(v)])
    )
  ).toString();
  return qs ? `${path}?${qs}` : path;
}

export const api = {
  get:    <T>(path: string, params?: Record<string, unknown>)  => apiFetch<T>(buildUrl(path, params)),
  post:   <T>(path: string, body?: unknown)                    => apiFetch<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    <T>(path: string, body?: unknown)                    => apiFetch<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: <T = void>(path: string)                             => apiFetch<T>(path, { method: 'DELETE' }),
};

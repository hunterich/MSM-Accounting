/**
 * Central API client for MSM Accounting Software.
 * Reads VITE_API_URL and attaches credentials cookie on every request.
 * Tenant context is derived server-side from the session cookie plus the
 * per-tab `x-active-org` header, validated against the signed membership list.
 */

import { resolveApiBase } from '../lib/apiBase';
import { getActiveOrgId, clearActiveOrg } from '../lib/activeOrg';

const API_BASE = resolveApiBase();

function getHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { headers: extraHeaders, ...rest } = options;
  const isFormData = typeof FormData !== 'undefined' && rest.body instanceof FormData;
  const activeOrg = getActiveOrgId();
  const orgHeader: Record<string, string> = activeOrg ? { 'x-active-org': activeOrg } : {};
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: isFormData
      ? { ...orgHeader, ...(extraHeaders as Record<string, string>) }
      : getHeaders({ ...orgHeader, ...(extraHeaders as Record<string, string>) }),
    ...rest,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; code?: string };
    if (res.status === 403 && body.code === 'ORG_MEMBERSHIP') {
      // The stored org is no longer valid for this session (membership revoked
      // or stale tab). Reset and go back through bootstrap → company picker.
      clearActiveOrg();
      window.location.assign('/');
    }
    throw Object.assign(new Error(body.error || `API error ${res.status}`), { status: res.status });
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
  postForm: <T>(path: string, body: FormData)                  => apiFetch<T>(path, { method: 'POST', body }),
  put:    <T>(path: string, body?: unknown)                    => apiFetch<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: <T = void>(path: string)                             => apiFetch<T>(path, { method: 'DELETE' }),
};

/**
 * Central API client for MSM Accounting Software.
 * Reads VITE_API_URL, attaches credentials cookie, and injects x-org-id
 * from the auth store on every request.
 */
import { useAuthStore } from '../stores/useAuthStore';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function getHeaders(extra = {}) {
  const org = useAuthStore.getState().org;
  const headers = {
    'Content-Type': 'application/json',
    ...extra,
  };
  if (org?.id) headers['x-org-id'] = org.id;
  return headers;
}

async function apiFetch(path, options = {}) {
  const { headers: extraHeaders, ...rest } = options;
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: getHeaders(extraHeaders),
    ...rest,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }

  return res.json();
}

function buildUrl(path, params) {
  if (!params) return path;
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString();
  return qs ? `${path}?${qs}` : path;
}

export const api = {
  get:    (path, params)  => apiFetch(buildUrl(path, params)),
  post:   (path, body)    => apiFetch(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    (path, body)    => apiFetch(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: (path)          => apiFetch(path, { method: 'DELETE' }),
};

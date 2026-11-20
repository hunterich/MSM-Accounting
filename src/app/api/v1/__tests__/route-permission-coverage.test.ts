import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The v1 API root (this test lives in v1/__tests__/).
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Recursive walk for every `route.ts` under ROOT (relative, forward-slash
// paths). Avoids fs.globSync, which is only stable on Node >= 22 — CI runs an
// older Node where it is undefined.
function listRouteFiles(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...listRouteFiles(path.join(dir, entry.name), base ? `${base}/${entry.name}` : entry.name));
    } else if (entry.name === 'route.ts') {
      out.push(base ? `${base}/route.ts` : 'route.ts');
    }
  }
  return out;
}

/**
 * Handlers that are NOT behind a module permission, each with the reason.
 * Keyed `<route file> <METHOD>`, so a guarded PUT can no longer vouch for an
 * unguarded GET in the same file (the loophole behind issue #234). Keep this
 * list tight: every entry is a deliberate, reviewed exception.
 */
const OPEN_HANDLERS: Record<string, string> = {
  // Authentication and self-service: no module applies before or around login.
  'auth/google/route.ts POST': 'sign-in (Google ID token)',
  'auth/login/route.ts POST': 'sign-in (password)',
  'auth/logout/route.ts POST': 'sign-out',
  'auth/me/route.ts GET': "the caller's own session, role and permissions",
  'auth/refresh/route.ts POST': "re-issues the caller's own token (cookie-guarded)",
  'users/me/password/route.ts POST': 'change your own password',
  'organizations/route.ts POST':
    'company creation is an owner capability above module RBAC: guarded by a DB membership check (ADMIN of any company, or no company yet)',
  'access-schedule/route.ts GET':
    "always 401 here: middleware answers the probe with the caller's own access window from a live membership query",
  'organization/settings/route.ts GET':
    'company profile and posting policies (no credentials) that every screen reads through ProtectedRoute; the PUT stays SETTINGS/edit',
  // Approvals: the permission depends on the document each request points at.
  'approvals/route.ts GET':
    'filtered per row: only document types the caller can approve (approval registry module + canApprove), plus requests the caller submitted',
  'approvals/[id]/approve/route.ts POST':
    "assertApprovalAuthorized checks canApprove on the request's document module and blocks self-approval",
  'approvals/[id]/reject/route.ts POST':
    "assertApprovalAuthorized checks canApprove on the request's document module and blocks self-approval",
};

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

interface Handler {
  method: Method;
  /** `withPermission`, `withHandler`, ... or `function` for `export async function`. */
  wrapper: string;
  /** Source from this export to the next top-level export. */
  body: string;
}

// `export const GET = withPermission(` / `export async function GET(`
const EXPORT_RE = /^export\s+(?:const\s+(GET|POST|PUT|PATCH|DELETE)\s*=\s*([A-Za-z_$][\w$]*)?|(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b)/gm;

function exportedHandlers(src: string): Handler[] {
  const starts: { index: number; method: Method; wrapper: string }[] = [];
  for (const m of src.matchAll(EXPORT_RE)) {
    starts.push({ index: m.index!, method: (m[1] ?? m[3]) as Method, wrapper: m[1] ? (m[2] ?? '') : 'function' });
  }
  const exportsAt = [...src.matchAll(/^export\s/gm)].map((m) => m.index!);
  return starts.map((s) => {
    const next = exportsAt.find((i) => i > s.index) ?? src.length;
    return { method: s.method, wrapper: s.wrapper, body: src.slice(s.index, next) };
  });
}

const GUARD_WRAPPERS = new Set(['withPermission', 'withPlatformAdmin']);
const INNER_GUARD = /\b(requirePermission|requirePlatformAdmin)\s*\(/;

function guardOf(h: Handler): 'wrapped' | 'inner' | null {
  if (GUARD_WRAPPERS.has(h.wrapper)) return 'wrapped';
  if (INNER_GUARD.test(h.body)) return 'inner';
  return null;
}

const files = listRouteFiles(ROOT).sort();
const handlers = files.flatMap((rel) =>
  exportedHandlers(readFileSync(path.join(ROOT, rel), 'utf8')).map((h) => ({ rel, key: `${rel} ${h.method}`, ...h })),
);

describe('route permission coverage', () => {
  it('found the route files and their handlers', () => {
    expect(files.length).toBeGreaterThan(140);
    expect(handlers.length).toBeGreaterThan(300);
  });

  it('every file exporting a handler is understood by the scanner', () => {
    // A handler exported some other way (`export { GET }`, a re-export) would
    // slip past the per-handler check below. Fail loudly instead.
    for (const rel of files) {
      const src = readFileSync(path.join(ROOT, rel), 'utf8');
      expect(/export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE)\b/.test(src), `${rel} re-exports a handler`).toBe(false);
    }
  });

  for (const h of handlers) {
    const reason = OPEN_HANDLERS[h.key];
    it(`${h.key} is ${reason ? 'intentionally open' : 'permission-guarded'}`, () => {
      if (reason) {
        expect(guardOf(h), `${h.key} is guarded now: drop it from OPEN_HANDLERS`).toBeNull();
        return;
      }
      // withPlatformAdmin is a stricter, platform-superadmin guard used by the
      // system-global backup routes (which must not be reachable via an
      // org-scoped permission a tenant admin can self-grant).
      expect(
        guardOf(h),
        `${h.key} must be wrapped in withPermission/withPlatformAdmin, call requirePermission, or be listed in OPEN_HANDLERS with a reason`,
      ).not.toBeNull();
    });
  }

  it('reads are guarded by the view action', () => {
    // Spec (docs/superpowers/specs/2026-06-25-server-side-rbac-design.md §3): GET → view.
    const offenders = handlers
      .filter((h) => h.method === 'GET' && h.wrapper === 'withPermission')
      .filter((h) => {
        const descriptor = h.body.slice(h.body.indexOf('withPermission(') + 'withPermission('.length).trimStart();
        return !(descriptor.startsWith('readScope(') || /^\{[^}]*action:\s*'view'/.test(descriptor));
      })
      .map((h) => h.key);
    expect(offenders).toEqual([]);
  });

  it('OPEN_HANDLERS has no stale entries', () => {
    const known = new Set(handlers.map((h) => h.key));
    expect(Object.keys(OPEN_HANDLERS).filter((k) => !known.has(k))).toEqual([]);
  });
});

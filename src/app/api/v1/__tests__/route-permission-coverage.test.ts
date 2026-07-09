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

// Routes intentionally NOT permission-wrapped (public / self-service / pure lookup).
// Keep this list tight and justified.
const OPEN_ALLOWLIST = new Set([
  'auth/google/route.ts', 'auth/login/route.ts', 'auth/logout/route.ts', 'auth/me/route.ts',
  'auth/refresh/route.ts',                      // self-service: re-issues the caller's own token (cookie-guarded)
  'users/me/password/route.ts',                 // self-service: change your own password
  'item-categories/[id]/next-sku/route.ts',     // read-only lookup (computes next SKU)
  'approvals/[id]/approve/route.ts',            // guarded by assertApprovalAuthorized (approval engine)
  'approvals/[id]/reject/route.ts',             // guarded by assertApprovalAuthorized
]);

// GET-only handlers we DO enforce (sensitive reads). Every other GET-only file may stay open.
const ENFORCED_READS = new Set([
  'audit-logs/route.ts',
  'backup/history/route.ts', 'backup/[id]/download/route.ts',
  'payroll-runs/route.ts', 'payroll-runs/[id]/route.ts',
  'employees/route.ts', 'employees/[id]/route.ts',
  'reports/ap/route.ts', 'reports/ar/route.ts', 'reports/banking/route.ts',
  'reports/gl/route.ts', 'reports/hr/route.ts', 'reports/sales/route.ts',
  'inventory/valuation/route.ts',
]);

const files = listRouteFiles(ROOT).filter((f) => !f.includes('__tests__'));

describe('route permission coverage', () => {
  it('found the route files', () => {
    expect(files.length).toBeGreaterThan(140);
  });

  for (const rel of files.sort()) {
    const src = readFileSync(path.join(ROOT, rel), 'utf8');
    const hasMutation = /export\s+(const|async function)\s+(POST|PUT|PATCH|DELETE)\b/.test(src);
    const isEnforcedRead = ENFORCED_READS.has(rel);
    const needsGuard = (hasMutation || isEnforcedRead) && !OPEN_ALLOWLIST.has(rel);

    it(`${rel} ${needsGuard ? 'is permission-guarded' : 'is intentionally open'}`, () => {
      if (!needsGuard) {
        expect(true).toBe(true);
        return;
      }
      // withPlatformAdmin is a stricter, platform-superadmin guard used by the
      // system-global backup routes (which must not be reachable via an org-scoped
      // permission a tenant admin can self-grant).
      const guarded = src.includes('withPermission') || src.includes('withPlatformAdmin');
      expect(guarded, `${rel} must use withPermission or withPlatformAdmin`).toBe(true);
    });
  }
});

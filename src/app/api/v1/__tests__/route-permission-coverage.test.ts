import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The v1 API root (this test lives in v1/__tests__/).
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Routes intentionally NOT permission-wrapped (public / self-service / pure lookup).
// Keep this list tight and justified.
const OPEN_ALLOWLIST = new Set([
  'auth/google/route.ts', 'auth/login/route.ts', 'auth/logout/route.ts', 'auth/me/route.ts',
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

const files = globSync('**/route.ts', { cwd: ROOT }).filter((f) => !f.includes('__tests__'));

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
      expect(src.includes('withPermission'), `${rel} must use withPermission`).toBe(true);
    });
  }
});

/**
 * Tenant-isolation policy gate (ratcheting baseline).
 *
 * The unsafe pattern is `req.headers.get('x-org-id')!` — the trailing `!`
 * silently casts `null` to `string`, so a forgotten `x-org-id` header
 * leaks `organizationId: null` straight into Prisma queries. Reads return
 * empty (mostly harmless), but writes can corrupt or expose cross-tenant
 * state. The safe alternative is `requireOrg(req)` / `requireAuth(req)`
 * from `@/lib/api-utils`, which throws a 401 on missing headers.
 *
 * This test runs as part of `npm test` (no extra CI infra) and:
 *
 *   1. scans every `src/app/api/v1/**\/route.ts` file,
 *   2. counts the unsafe pattern,
 *   3. lets known-bad files through against a frozen allowlist,
 *   4. fails the build if any *new* file uses the pattern, OR if a file
 *      on the allowlist regresses with a *higher* count, OR if a file
 *      cleans up but isn't removed from the allowlist (force the cleanup
 *      to actually shrink the list).
 *
 * To clean up a file: switch its handlers to `requireOrg(req)` /
 * `requireAuth(req)`, drop the `'x-org-id': '!'` reads, and remove the
 * file from `BASELINE` below. The test will fail if you don't update
 * the baseline after a real cleanup — that's the ratchet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../..');
const ROUTES_DIR = path.join(ROOT, 'app/api/v1');
// Use repo-relative paths so error messages are stable across machines.
const REPO_ROOT = path.resolve(ROOT, '..');

// Files known to use the unsafe `req.headers.get('x-org-id')!` pattern as of
// 2026-05-07. Each entry is the count of occurrences in that file. Use
// repo-relative paths so the test is hermetic.
//
// Adding a new entry is NOT allowed — fix the route to use requireOrg() instead.
// Lowering an entry's count IS allowed but you must also lower the value here.
// Removing the entry entirely is the goal — happens when the file is fully clean.
const BASELINE: Record<string, number> = {
  'src/app/api/v1/ap-payments/[id]/route.ts': 3,
  'src/app/api/v1/ar-payments/[id]/route.ts': 3,
  'src/app/api/v1/attendance/[id]/route.ts': 3,
  'src/app/api/v1/bank-accounts/[id]/route.ts': 3,
  'src/app/api/v1/bank-transactions/[id]/route.ts': 3,
  'src/app/api/v1/bills/[id]/route.ts': 2,
  'src/app/api/v1/credit-notes/[id]/route.ts': 2,
  'src/app/api/v1/customer-categories/[id]/route.ts': 3,
  'src/app/api/v1/customers/[id]/route.ts': 3,
  'src/app/api/v1/debit-notes/[id]/route.ts': 2,
  'src/app/api/v1/employees/[id]/route.ts': 3,
  'src/app/api/v1/item-categories/[id]/next-sku/route.ts': 1,
  'src/app/api/v1/item-categories/[id]/route.ts': 3,
  'src/app/api/v1/item-categories/route.ts': 2,
  'src/app/api/v1/items/[id]/route.ts': 3,
  'src/app/api/v1/journal-entries/[id]/route.ts': 3,
  'src/app/api/v1/leave-requests/[id]/route.ts': 3,
  'src/app/api/v1/leave-types/[id]/route.ts': 3,
  'src/app/api/v1/payroll-runs/[id]/calculate/route.ts': 1,
  'src/app/api/v1/payroll-runs/[id]/route.ts': 3,
  'src/app/api/v1/purchase-orders/[id]/route.ts': 2,
  'src/app/api/v1/purchase-returns/[id]/route.ts': 2,
  'src/app/api/v1/sales-returns/[id]/route.ts': 2,
  'src/app/api/v1/stock-adjustments/[id]/route.ts': 3,
  'src/app/api/v1/vendor-categories/[id]/route.ts': 3,
  'src/app/api/v1/vendors/[id]/route.ts': 3,
};

function listRouteFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      listRouteFiles(full, acc);
    } else if (entry.isFile() && entry.name === 'route.ts') {
      acc.push(full);
    }
  }
  return acc;
}

function countOccurrences(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

const UNSAFE_PATTERN = /headers\.get\(['"]x-org-id['"]\)!/g;

describe('tenant-isolation policy gate', () => {
  it('blocks new uses of req.headers.get("x-org-id")! and requires baseline cleanup to ratchet down', () => {
    const files = listRouteFiles(ROUTES_DIR);
    expect(files.length).toBeGreaterThan(0);

    const violations: Record<string, number> = {};
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      const count = countOccurrences(text, UNSAFE_PATTERN);
      if (count > 0) {
        // BASELINE keys are POSIX-style, and path.relative yields backslashes
        // on Windows — without normalising, every file reads as both a new
        // violation and a stale baseline entry.
        const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
        violations[rel] = count;
      }
    }

    const newViolators: string[] = [];
    const regressed: Array<{ file: string; was: number; now: number }> = [];
    for (const [file, count] of Object.entries(violations)) {
      if (!(file in BASELINE)) {
        newViolators.push(`${file} (${count} occurrences)`);
        continue;
      }
      if (count > BASELINE[file]) {
        regressed.push({ file, was: BASELINE[file], now: count });
      }
    }

    const cleanedButStillBaselined: string[] = [];
    for (const file of Object.keys(BASELINE)) {
      if (!(file in violations)) {
        cleanedButStillBaselined.push(file);
      }
    }

    const messages: string[] = [];
    if (newViolators.length > 0) {
      messages.push(
        `New tenant-isolation violations — these route files use the unsafe ` +
          `\`req.headers.get('x-org-id')!\` pattern. Use \`requireOrg(req)\` from ` +
          `@/lib/api-utils instead so missing headers raise a 401:\n  - ` +
          newViolators.join('\n  - '),
      );
    }
    if (regressed.length > 0) {
      messages.push(
        `Tenant-isolation baseline regressed — these files added more violations:\n  - ` +
          regressed.map((r) => `${r.file} (was ${r.was}, now ${r.now})`).join('\n  - '),
      );
    }
    if (cleanedButStillBaselined.length > 0) {
      messages.push(
        `Tenant-isolation baseline is now stale — these files no longer have ` +
          `violations but are still listed. Remove them from BASELINE in this file:\n  - ` +
          cleanedButStillBaselined.join('\n  - '),
      );
    }

    if (messages.length > 0) {
      throw new Error(messages.join('\n\n'));
    }
  });
});

/**
 * Dead-module gate (ratcheting baseline).
 *
 * The JS→TS migration and successive UI rewrites left whole subsystems behind
 * with nothing importing them — the pre-database zustand stores, a superseded
 * tab bar, duplicate report views: 28 files and ~2,600 lines that still
 * type-checked, still built, and still looked alive in a grep. Nothing catches
 * that, because an unreferenced file is perfectly valid TypeScript.
 *
 * This walks the import graph from every real entry point and fails when a
 * source file is reachable from none of them. It runs as part of `npm test`
 * (no extra CI infra) and:
 *
 *   1. collects every `.ts`/`.tsx` under src/, lib/ and types/,
 *   2. resolves each file's import specifiers to files on disk,
 *   3. walks the graph from the entry points below,
 *   4. fails if any file outside `BASELINE` is unreachable, OR if a file on
 *      the baseline has become reachable again (forcing the list to shrink).
 *
 * To delete dead code: remove the files, then remove them from `BASELINE`.
 * To legitimately add an unreferenced file, add it to `BASELINE` with a reason
 * — that entry is the place to justify it to the next reader.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const SOURCE_DIRS = ['src', 'lib', 'types'];
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', 'test-results', 'playwright-report']);

/**
 * Files that are deliberately unreachable through imports. Ambient declaration
 * files belong here by nature: tsconfig's `include` loads them, nothing imports
 * them. Adding anything else needs a reason on the line.
 *
 * `.d.ts` files are filtered out before this list is consulted, so it starts
 * empty — every entry added later is real debt.
 */
const BASELINE: Record<string, string> = {};

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(full, acc);
    else if (EXTS.some((e) => entry.name.endsWith(e))) acc.push(full);
  }
  return acc;
}

/**
 * Resolve one import specifier to a file on disk, or null for bare packages.
 * A ".js" specifier is also tried without its extension: that is how NodeNext
 * ESM addresses a .ts source, and how a couple of migration leftovers were
 * still written.
 */
function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2));
  else return null;

  const bases = [base];
  const jsSpecifier = base.match(/^(.*)\.(js|jsx|mjs)$/);
  if (jsSpecifier) bases.push(jsSpecifier[1]);

  for (const candidate of bases) {
    for (const suffix of ['', ...EXTS, ...EXTS.map((e) => `/index${e}`)]) {
      const file = candidate + suffix;
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    }
  }
  return null;
}

// Deliberately loose: matches `from '…'`, `require('…')` and `import('…')`.
// Over-matching is safe here — it can only make a file look MORE reachable, so
// the gate never fails on a file something actually references.
const SPECIFIER = /(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;

function importedFiles(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const match of source.matchAll(SPECIFIER)) {
    const resolved = resolveSpecifier(match[1], file);
    if (resolved) out.push(resolved);
  }
  return out;
}

/** Everything the build, the runtime, or a test actually starts from. */
function entryPoints(allFiles: string[]): string[] {
  const entries: string[] = [];
  const add = (p: string) => { if (fs.existsSync(p)) entries.push(p); };

  add(path.join(ROOT, 'src/main.tsx'));         // Vite: index.html
  add(path.join(ROOT, 'src/pos/main.tsx'));     // Vite: pos.html
  add(path.join(ROOT, 'src/middleware.ts'));    // Next.js
  add(path.join(ROOT, 'src/instrumentation.ts'));
  add(path.join(ROOT, 'prisma/seed.ts'));

  for (const file of allFiles) {
    const rel = path.relative(ROOT, file);
    // Next.js App Router conventions are entry points by filename.
    if (rel.startsWith(`src${path.sep}app${path.sep}`) &&
        /[\\/](route|page|layout|template|error|loading|not-found)\.tsx?$/.test(rel)) {
      entries.push(file);
    }
    if (/__tests__|\.test\.tsx?$|\.spec\.tsx?$/.test(rel)) entries.push(file);
  }
  return entries;
}

const allFiles = listSourceFiles(path.join(ROOT, SOURCE_DIRS[0]))
  .concat(...SOURCE_DIRS.slice(1).map((d) => listSourceFiles(path.join(ROOT, d))));

const reachable = new Set<string>();
const queue = entryPoints(allFiles);
while (queue.length) {
  const file = queue.pop()!;
  if (reachable.has(file)) continue;
  reachable.add(file);
  for (const target of importedFiles(file)) {
    if (!reachable.has(target)) queue.push(target);
  }
}

const unreachable = allFiles
  // Ambient declarations are loaded via tsconfig `include`, never imported.
  .filter((f) => !f.endsWith('.d.ts'))
  .filter((f) => !reachable.has(f))
  .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
  .sort();

describe('module reachability', () => {
  it('walks a real graph (guards against the analysis silently finding nothing)', () => {
    // If entry-point discovery or specifier resolution breaks, everything looks
    // unreachable or everything looks reachable; both would make this gate
    // useless while still passing. Assert the graph is plausible instead.
    expect(allFiles.length).toBeGreaterThan(500);
    expect(reachable.size).toBeGreaterThan(allFiles.length * 0.9);
  });

  it('has no unreferenced source files outside the baseline', () => {
    const unexpected = unreachable.filter((f) => !(f in BASELINE));
    expect(
      unexpected,
      `Unreferenced source file(s) — nothing in the app, the API, or the tests imports these.\n` +
        `Delete them, or add each to BASELINE in this file with the reason it must stay:\n` +
        unexpected.map((f) => `  ${f}`).join('\n'),
    ).toEqual([]);
  });

  it('keeps the baseline honest — a file that is referenced again must leave it', () => {
    const stale = Object.keys(BASELINE).filter((f) => !unreachable.includes(f));
    expect(
      stale,
      `BASELINE lists file(s) that are now referenced (or no longer exist). Remove them:\n` +
        stale.map((f) => `  ${f}`).join('\n'),
    ).toEqual([]);
  });
});

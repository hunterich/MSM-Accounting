/**
 * Period-guard policy gate.
 *
 * Closing a month is only worth anything if every path that writes to the
 * ledger respects it. `assertPeriodOpen` is wired into the posting paths by
 * hand, one call at a time, which means a new one can be added without it and
 * nothing will say so — the period simply stops being closed for that path.
 *
 * That is not hypothetical. When this gate was written it found four live
 * gaps: the CSV opening-balance import, the migration cutover journal, opening
 * stock on item create/update, and marketplace settlement posting.
 *
 * The rule: a file that writes a journal entry must call `assertPeriodOpen`,
 * **or** every non-test file that imports it must be covered by the same rule.
 * The second clause is what lets a shared helper like `bill-posting.ts` stay
 * clean while its five callers each guard — and it fails the moment someone
 * adds a sixth caller that does not. A file nothing imports (every route) has
 * to guard itself: coverage is never vacuous.
 *
 * `EXEMPT` is for the writes that cannot be covered either way. Each entry
 * needs a reason. Removing one is the goal; adding one should be argued for.
 *
 * This is a ratchet, not a proof — it matches text, so it cannot tell that a
 * guard is on the right date or reachable on every branch. It catches the
 * failure that actually happens: a posting path that never mentions the guard
 * at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SCAN_DIRS = ['src/app/api/v1', 'lib'];

/** Writes a journal entry: directly, or through the shared writer. */
const WRITES_JOURNAL = /journalEntry\.create|postJournalEntry\(/;
const GUARDS = /assertPeriodOpen\(/;

const EXEMPT: Record<string, string> = {
  'lib/journal-posting.ts':
    'The shared writer. It cannot guard unconditionally — lib/fiscal-year-close.ts ' +
    'posts the closing entry INTO the period being closed — so its callers guard instead.',
  'lib/fiscal-year-close.ts':
    'The year-end closing entry is dated the last day of the year, inside a period the ' +
    'close requires to be CLOSED. It is not a document; it is the act of closing, and it ' +
    'is the one write that belongs in a locked period.',
  'lib/pos/batch-stock-in.ts':
    'Reachable only from the integration suite (receiveBatch), never from a route. ' +
    'If it ever gains a production caller, delete this entry and guard it.',
};

function listSourceFiles(dir: string): string[] {
  const abs = path.join(REPO_ROOT, dir);
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
      if (entry.name.endsWith('.test.ts')) continue;
      out.push(full);
    }
  };
  walk(abs);
  return out;
}

/** Repo-relative, POSIX separators, so messages are identical on every machine. */
const rel = (abs: string): string => path.relative(REPO_ROOT, abs).split(path.sep).join('/');

/**
 * Resolve an import specifier to a repo-relative file, or null when it leaves
 * the scanned tree (node_modules, @prisma/client, a .tsx component).
 */
function resolveSpecifier(fromAbs: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('.')) {
    base = path.resolve(path.dirname(fromAbs), spec);
  } else if (spec.startsWith('@/lib/')) {
    base = path.join(REPO_ROOT, 'lib', spec.slice('@/lib/'.length));
  } else if (spec.startsWith('@/')) {
    base = path.join(REPO_ROOT, 'src', spec.slice('@/'.length));
  } else {
    return null;
  }
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return rel(candidate);
  }
  return null;
}

const IMPORT_RE = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

describe('period-guard policy gate', () => {
  it('every journal-writing path calls assertPeriodOpen, directly or through its callers', () => {
    const files = SCAN_DIRS.flatMap(listSourceFiles);
    expect(files.length).toBeGreaterThan(100);

    const text = new Map<string, string>();
    for (const abs of files) text.set(rel(abs), fs.readFileSync(abs, 'utf8'));

    // importer -> the in-tree files it imports.
    const importsOf = new Map<string, string[]>();
    for (const abs of files) {
      const source = text.get(rel(abs))!;
      const targets = new Set<string>();
      for (const match of source.matchAll(IMPORT_RE)) {
        const resolved = resolveSpecifier(abs, match[1]);
        if (resolved) targets.add(resolved);
      }
      importsOf.set(rel(abs), [...targets]);
    }

    const importersOf = new Map<string, string[]>();
    for (const [importer, targets] of importsOf) {
      for (const target of targets) {
        importersOf.set(target, [...(importersOf.get(target) ?? []), importer]);
      }
    }

    const guards = (file: string): boolean => GUARDS.test(text.get(file) ?? '');

    /**
     * Covered = guards itself, is exempt, or has at least one importer and all
     * of them are covered. `seen` breaks import cycles by treating a file
     * already on the stack as unproven rather than as covered.
     */
    const memo = new Map<string, boolean>();
    const isCovered = (file: string, seen: Set<string> = new Set()): boolean => {
      if (file in EXEMPT) return true;
      if (guards(file)) return true;
      if (memo.has(file)) return memo.get(file)!;
      if (seen.has(file)) return false;

      const importers = (importersOf.get(file) ?? []).filter((f) => f !== file);
      if (importers.length === 0) return false;

      const next = new Set(seen).add(file);
      const covered = importers.every((importer) => isCovered(importer, next));
      memo.set(file, covered);
      return covered;
    };

    const writers = [...text.keys()].filter((f) => WRITES_JOURNAL.test(text.get(f)!));
    expect(writers.length, 'no journal-writing files found — the scan is broken').toBeGreaterThan(10);

    const unguarded = writers.filter((f) => !isCovered(f)).sort();
    const staleExemptions = Object.keys(EXEMPT)
      .filter((f) => text.has(f) && guards(f))
      .sort();
    const missingExemptions = Object.keys(EXEMPT).filter((f) => !text.has(f)).sort();

    const messages: string[] = [];
    if (unguarded.length > 0) {
      messages.push(
        'These files write a journal entry, but neither they nor all of their callers call ' +
          '`assertPeriodOpen` — a closed period will not stop them:\n  - ' +
          unguarded
            .map((f) => {
              const importers = importersOf.get(f) ?? [];
              const offenders = importers.filter((i) => !isCovered(i));
              return offenders.length > 0
                ? `${f} (via unguarded caller${offenders.length > 1 ? 's' : ''}: ${offenders.join(', ')})`
                : f;
            })
            .join('\n  - '),
      );
    }
    if (staleExemptions.length > 0) {
      messages.push(
        'These files are listed in EXEMPT but now guard themselves. Remove them from EXEMPT ' +
          'in this file — that is the ratchet:\n  - ' + staleExemptions.join('\n  - '),
      );
    }
    if (missingExemptions.length > 0) {
      messages.push(
        'EXEMPT names files that no longer exist. Remove them:\n  - ' +
          missingExemptions.join('\n  - '),
      );
    }

    if (messages.length > 0) throw new Error(messages.join('\n\n'));
  });
});

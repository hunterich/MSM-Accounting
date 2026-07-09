#!/usr/bin/env node
/**
 * Create the next Prisma migration from a schema change — WITHOUT a shadow
 * database and WITHOUT `prisma migrate dev` (which would trip over the partial
 * unique index Prisma can't model; see scripts/apply-db-indexes.mjs).
 *
 *   npm run db:migration -- add_supplier_rating
 *
 * It diffs your CURRENT dev database (kept in sync by earlier `migrate deploy`
 * runs) against prisma/schema.prisma and writes the SQL to a new, timestamped
 * migration folder. Then:
 *
 *   1. Review the generated migration.sql.
 *   2. Apply it to your dev DB:   npm run prisma:migrate:deploy
 *   3. Commit the migration folder.
 *
 * On the server, upgrades run `prisma migrate deploy`, which applies it there.
 */
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envText = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  const match = envText.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  if (!match) throw new Error('DATABASE_URL not found in environment or .env');
  return match[1];
}

const rawName = process.argv.slice(2).join(' ').trim();
if (!rawName) {
  console.error('Usage: npm run db:migration -- <name>   (e.g. add_supplier_rating)');
  process.exit(1);
}
const name = rawName.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();

const now = new Date();
const ts =
  now.getUTCFullYear().toString() +
  String(now.getUTCMonth() + 1).padStart(2, '0') +
  String(now.getUTCDate()).padStart(2, '0') +
  String(now.getUTCHours()).padStart(2, '0') +
  String(now.getUTCMinutes()).padStart(2, '0') +
  String(now.getUTCSeconds()).padStart(2, '0');

const dir = resolve(process.cwd(), 'prisma', 'migrations', `${ts}_${name}`);
mkdirSync(dir, { recursive: true });

const dbUrl = loadDatabaseUrl();
console.log(`[new-migration] diffing dev DB → schema.prisma …`);
const sql = execFileSync(
  'npx',
  [
    'prisma', 'migrate', 'diff',
    '--from-url', dbUrl,
    '--to-schema-datamodel', 'prisma/schema.prisma',
    '--script',
  ],
  { encoding: 'utf8' },
);

if (!sql.trim() || /^\s*(--\s*This is an empty migration\.?)?\s*$/i.test(sql)) {
  rmSync(dir, { recursive: true, force: true });
  console.log('[new-migration] No schema changes detected — nothing to do.');
  process.exit(0);
}

const file = resolve(dir, 'migration.sql');
writeFileSync(file, sql);
console.log(`[new-migration] wrote ${file}`);
console.log('[new-migration] Next: review it, then `npm run prisma:migrate:deploy`, then commit.');

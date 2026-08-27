/**
 * Build the disposable database the end-to-end tests run against.
 *
 *   npm run test:e2e:setup   # then: npm run test:e2e
 *
 * Playwright drives the real UI against the real API, so it needs a real
 * database — but pointing it at the development one means every run mutates the
 * data you are working with, which is why nobody wants to run it. This creates
 * `<db>_e2e` from the migration history, seeds the demo company into it, and
 * leaves the development database untouched.
 *
 * Recreated from scratch each time, so a run always starts from the same
 * fixture and a failed run cannot poison the next one. Safe to re-run.
 *
 * Postgres can come from anywhere — a local install or a container. Only
 * DATABASE_URL matters; see deploy/README.md for the container option.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma, tsx, deriveDatabaseUrl } from './lib/prisma-cli.mjs';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envText = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  const match = envText.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  if (!match) throw new Error('DATABASE_URL not found in environment or .env');
  return match[1];
}

const { baseUrl, url: e2eUrl, name: e2eDbName } = deriveDatabaseUrl(loadDatabaseUrl(), 'e2e');

// Guard against the one mistake that would really hurt: the suffix logic should
// never hand back the database the developer works in.
const baseName = new URL(baseUrl).pathname.replace(/^\//, '');
if (baseName === e2eDbName) {
  throw new Error(`Refusing to run: "${e2eDbName}" is the base database, not a disposable copy.`);
}

console.log(`[e2e-db-setup] recreating "${e2eDbName}" (fresh)…`);
prisma(['db', 'execute', '--url', baseUrl, '--stdin'], {
  input: `DROP DATABASE IF EXISTS "${e2eDbName}";`,
  stdio: ['pipe', 'inherit', 'inherit'],
});
prisma(['db', 'execute', '--url', baseUrl, '--stdin'], {
  input: `CREATE DATABASE "${e2eDbName}";`,
  stdio: ['pipe', 'inherit', 'inherit'],
});

console.log('[e2e-db-setup] applying migrations…');
prisma(['migrate', 'deploy'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: e2eUrl } });

// The same partial unique index the integration harness applies: Prisma's schema
// cannot express a filtered unique index, and the approval engine relies on it.
console.log('[e2e-db-setup] applying partial unique index on ApprovalRequest…');
prisma(['db', 'execute', '--url', e2eUrl, '--stdin'], {
  input: `CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalRequest_open_pending_unique"
ON "ApprovalRequest" ("organizationId", "documentType", "documentId")
WHERE status = 'PENDING';`,
  stdio: ['pipe', 'inherit', 'inherit'],
});

console.log('[e2e-db-setup] seeding the demo company…');
tsx('prisma/seed.ts', { DATABASE_URL: e2eUrl });

console.log(`[e2e-db-setup] done. DATABASE_URL for the e2e stack:\n  ${e2eUrl}`);

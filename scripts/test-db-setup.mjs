/**
 * One-time setup for the GL integration tests: ensure a `<db>_test` database
 * exists and has the current Prisma schema pushed into it.
 *
 *   npm run test:int:setup   # then: npm run test:int
 *
 * Reads DATABASE_URL from the environment or `.env`, derives the `_test`
 * variant, creates it if missing, and runs `prisma db push` against it.
 * Safe to re-run.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envText = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
  const match = envText.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m)
  if (!match) throw new Error('DATABASE_URL not found in environment or .env')
  return match[1]
}

const baseUrl = loadDatabaseUrl()
const testUrlObj = new URL(baseUrl)
const baseDbName = testUrlObj.pathname.replace(/^\//, '')
const testDbName = baseDbName.endsWith('_test') ? baseDbName : `${baseDbName}_test`
testUrlObj.pathname = `/${testDbName}`
const testUrl = testUrlObj.toString()

console.log(`[test-db-setup] ensuring database "${testDbName}" exists…`)
try {
  execFileSync(
    'npx',
    ['prisma', 'db', 'execute', '--url', baseUrl, '--stdin'],
    { input: `CREATE DATABASE "${testDbName}";`, stdio: ['pipe', 'inherit', 'pipe'] },
  )
  console.log(`[test-db-setup] created "${testDbName}".`)
} catch (err) {
  const stderr = String(err.stderr ?? err.message ?? '')
  if (/already exists/i.test(stderr)) {
    console.log(`[test-db-setup] "${testDbName}" already exists — ok.`)
  } else {
    console.error(stderr)
    process.exit(1)
  }
}

console.log('[test-db-setup] pushing schema…')
execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: testUrl },
})

// Apply the partial unique index that Prisma's schema cannot express (a
// partial/filtered unique index). This is the DB-level backstop for Bug A:
// at most one OPEN (PENDING) ApprovalRequest per (org, documentType, document).
// MUST also be created in prod at merge — see the note on the ApprovalRequest
// model in prisma/schema.prisma. Idempotent via IF NOT EXISTS.
console.log('[test-db-setup] applying partial unique index on ApprovalRequest…')
execFileSync(
  'npx',
  ['prisma', 'db', 'execute', '--url', testUrl, '--stdin'],
  {
    input: `CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalRequest_open_pending_unique"
ON "ApprovalRequest" ("organizationId", "documentType", "documentId")
WHERE status = 'PENDING';`,
    stdio: ['pipe', 'inherit', 'inherit'],
  },
)
console.log('[test-db-setup] done.')

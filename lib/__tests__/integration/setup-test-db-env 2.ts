/**
 * Integration-test setup: force the *default* DATABASE_URL to the `<db>_test`
 * variant before any module loads.
 *
 * The GL-invariant tests pass the harness's `_test`-scoped Prisma client into
 * every posting function, so they never depend on this. The approval engine is
 * different: `approveRequest` / `rejectRequest` open their own transaction via
 * the shared `@/lib/prisma` client, which connects using the ambient
 * DATABASE_URL when that client is constructed. Without this rewrite the engine
 * client would talk to the dev/prod DB while the harness seeds the `_test` DB —
 * the request the engine looks up would not exist, and (worse) it could mutate
 * the real DB.
 *
 * Note: @prisma/client auto-loads `.env` (via dotenv) when a PrismaClient is
 * constructed, but dotenv does NOT override an env var that is already set. By
 * resolving the `_test` URL here — reading `.env` directly the same way the
 * harness does, since the var may be UNSET at this point — and assigning it to
 * process.env.DATABASE_URL, the engine's client constructs against `_test`.
 *
 * Running as a vitest `setupFiles` entry guarantees this executes before the
 * test module (and therefore before `@/lib/prisma` is first imported).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function resolveBaseUrl(): string | undefined {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const envText = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    return envText.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m)?.[1];
  } catch {
    return undefined;
  }
}

function toTestUrl(base: string): string {
  const url = new URL(base);
  const db = url.pathname.replace(/^\//, '');
  if (!db.endsWith('_test')) url.pathname = `/${db}_test`;
  if (!url.pathname.replace(/^\//, '').endsWith('_test')) {
    throw new Error(`Refusing to run integration tests against non-test DB: ${url.pathname}`);
  }
  return url.toString();
}

const base = resolveBaseUrl();
if (base) {
  process.env.DATABASE_URL = toTestUrl(base);
}

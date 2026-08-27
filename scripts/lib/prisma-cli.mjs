/**
 * Run the Prisma CLI from a Node script, portably.
 *
 * Setup scripts used to shell out to `npx`. On Windows that resolves to
 * `npx.cmd`, which `execFileSync` cannot launch without a shell, so those
 * scripts died with `spawnSync npx ENOENT` before doing any work. Resolving the
 * CLI's own entry point and running it through `process.execPath` needs no
 * shell on any platform, and keeps connection URLs as plain argv entries rather
 * than something a shell might re-quote.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PRISMA_CLI = require.resolve('prisma/build/index.js');

/** @param {string[]} args @param {import('node:child_process').ExecFileSyncOptions} [opts] */
export function prisma(args, opts = {}) {
  return execFileSync(process.execPath, [PRISMA_CLI, ...args], opts);
}

/** Run a project script (e.g. prisma/seed.ts) through tsx with a given env. */
export function tsx(scriptPath, env) {
  const tsxBin = require.resolve('tsx/cli');
  return execFileSync(process.execPath, [tsxBin, scriptPath], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

/**
 * Derive a sibling database URL from DATABASE_URL — `<db>` becomes `<db>_<suffix>`.
 * Returns both the base URL (for CREATE/DROP DATABASE, which must run against a
 * different database than the one being dropped) and the derived one.
 */
export function deriveDatabaseUrl(baseUrl, suffix) {
  const url = new URL(baseUrl);
  const baseName = url.pathname.replace(/^\//, '');
  const name = baseName.endsWith(`_${suffix}`) ? baseName : `${baseName}_${suffix}`;
  url.pathname = `/${name}`;
  return { baseUrl, url: url.toString(), name };
}

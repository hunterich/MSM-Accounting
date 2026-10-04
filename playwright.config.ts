import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * End-to-end config.
 *
 * Playwright starts its own backend + web server on dedicated ports, pointed at
 * the disposable `<db>_e2e` database (built by `npm run test:e2e:setup`). That
 * matters for two reasons: a run can never mutate the database you are
 * developing against, and it cannot collide with a dev stack already listening
 * on 3000/5173 — so the suite stays safe to run at any time, which is the only
 * way anyone actually runs it.
 *
 *   npm run test:e2e:setup   # once, or whenever the schema changes
 *   npm run test:e2e
 */

// The project is ESM, so __dirname is not defined here.
const projectRoot = dirname(fileURLToPath(import.meta.url))

const WEB_PORT = 5273
const API_PORT = 3100
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`
const API_ORIGIN = `http://localhost:${API_PORT}`

function e2eDatabaseUrl(): string {
  const base =
    process.env.DATABASE_URL ??
    readFileSync(resolve(projectRoot, '.env'), 'utf8').match(
      /^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m,
    )?.[1]
  if (!base) throw new Error('DATABASE_URL not found in environment or .env')
  const url = new URL(base)
  const name = url.pathname.replace(/^\//, '')
  url.pathname = `/${name.endsWith('_e2e') ? name : `${name}_e2e`}`
  return url.toString()
}

const DATABASE_URL = e2eDatabaseUrl()

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Keep POS selectable separately for local runs. Its specs create their
      // own company, register and stock; CI runs both projects with test:e2e:all.
      testIgnore: /pos-.*\.spec\.ts/,
    },
    {
      name: 'pos',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /pos-.*\.spec\.ts/,
    },
  ],
  webServer: [
    {
      // Invoke the installed CLIs through this Node executable. This also works
      // on Windows when Node is available but npm.cmd is not on PATH.
      command: `"${process.execPath}" "${resolve(projectRoot, 'node_modules/next/dist/bin/next')}" dev --port ${API_PORT}`,
      url: `${API_ORIGIN}/api/v1/auth/me`,
      // /auth/me answers 401 when signed out; that is still proof the API is up.
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        DATABASE_URL,
        // lib/cors.ts defaults to :5173; the e2e web origin has to be allowed
        // or every request from the page is blocked.
        FRONTEND_ORIGIN: WEB_ORIGIN,
        JWT_SECRET: process.env.JWT_SECRET ?? 'e2e-test-secret',
      },
    },
    {
      command: `"${process.execPath}" "${resolve(projectRoot, 'node_modules/vite/bin/vite.js')}" --port ${WEB_PORT} --strictPort`,
      url: WEB_ORIGIN,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { VITE_API_URL: API_ORIGIN },
    },
  ],
})

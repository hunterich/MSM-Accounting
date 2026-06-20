import { defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Integration test config — runs the GL invariant suite against a real Postgres
 * `<db>_test` database. Kept separate from the default (mock-based) unit run so
 * `npm test` stays fast and DB-free. Run with `npm run test:int`.
 */
export default defineConfig({
  resolve: {
    extensions: ['.mjs', '.ts', '.tsx', '.js', '.jsx', '.json'],
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    include: ['lib/__tests__/integration/**/*.int.test.ts'],
    // Serial: deterministic ordering, one DB connection pool.
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
  },
})

import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'migration-stage-errors.spec.ts',
  use: { baseURL: 'http://localhost:5373', ...devices['Desktop Chrome'] },
  webServer: { command: 'node node_modules/vite/bin/vite.js --port 5373 --strictPort',
    url: 'http://localhost:5373', reuseExistingServer: false, timeout: 120000 },
});

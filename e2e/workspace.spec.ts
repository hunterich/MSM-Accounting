// e2e/workspace.spec.ts
import { test, expect } from '@playwright/test';

// The flag must be on for these runs: start the dev server with VITE_WORKSPACE_TABS=1.
test.describe('workspace tabs — foundation', () => {
    test('opens, keeps both mounted, switches, and closes tabs', async ({ page }) => {
        await page.goto('/');
        // Seed two generic tabs directly through the store (no module wiring yet).
        await page.evaluate(() => {
            const store = (window as any).__MSM_WORKSPACE__;
            store.openTab({ id: 't1', kind: 'list', title: 'Tab One', target: { module: 'demo', entity: 'one', recordId: '1' }, path: '/', status: 'clean' });
            store.openTab({ id: 't2', kind: 'list', title: 'Tab Two', target: { module: 'demo', entity: 'two', recordId: '2' }, path: '/', status: 'clean' });
        });
        await expect(page.getByRole('button', { name: /Tab One/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Tab Two/ })).toBeVisible();
        await expect(page.getByText('Open tabs: 2/10')).toBeVisible();

        await page.getByRole('button', { name: /Tab One/ }).click();
        await expect(page.getByText('No renderer registered for "demo/one" yet.')).toBeVisible();

        await page.getByRole('button', { name: /Tab Two/ }).locator('.workbench-doc-tab-close').click();
        await expect(page.getByRole('button', { name: /Tab Two/ })).toHaveCount(0);
    });
});

// e2e/workspace.spec.ts
import { test, expect } from '@playwright/test';

// The flag must be on for these runs: start the dev server with VITE_WORKSPACE_TABS=1.

// Shared login — every test in this file needs an authenticated session.
test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@demo.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard/);
});

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

test.describe('workspace tabs — sales orders', () => {
    test('keep-alive preserves a half-typed new SO across a tab switch', async ({ page }) => {
        await page.goto('/ar/sales-orders/new');
        // type a reference on the Additional info tab
        await page.getByRole('button', { name: 'Additional info' }).click();
        await page.getByPlaceholder(/reference/i).fill('KEEP-ALIVE-123');
        // open the SO list as a second tab, then come back
        await page.evaluate(() => {
            (window as any).__MSM_WORKSPACE__.openTab({ id: 'ar:sales-order:view:catalog', kind: 'list', title: 'Sales Orders', target: { module: 'ar', entity: 'sales-order', recordId: 'catalog', mode: 'view' }, path: '/ar/sales-orders', status: 'clean' });
        });
        await page.getByRole('button', { name: /New sales order/ }).click();
        await page.getByRole('button', { name: 'Additional info' }).click();
        await expect(page.getByPlaceholder(/reference/i)).toHaveValue('KEEP-ALIVE-123');
    });

    test('reload restores the unsaved draft as a form and posts nothing', async ({ page }) => {
        await page.goto('/ar/sales-orders/new');
        await page.getByRole('button', { name: 'Additional info' }).click();
        await page.getByPlaceholder(/reference/i).fill('SURVIVE-RELOAD');
        await page.waitForTimeout(800); // let the debounced autosave flush
        const before = await page.evaluate(() => (window as any).__MSM_WORKSPACE__.tabs.length);
        await page.reload();
        // the draft tab is back, as an editable form, with the typed value intact
        await page.getByRole('button', { name: /New sales order/ }).click();
        await page.getByRole('button', { name: 'Additional info' }).click();
        await expect(page.getByPlaceholder(/reference/i)).toHaveValue('SURVIVE-RELOAD');
        const after = await page.evaluate(() => (window as any).__MSM_WORKSPACE__.tabs.length);
        expect(after).toBe(before); // no extra/committed document
    });
});

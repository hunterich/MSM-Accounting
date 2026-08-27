// e2e/workspace.spec.ts
//
// Two-level workspace tabs (row 1 = modules, row 2 = the active document
// module's records). Requires the dev server
// and the backend running. `window.__MSM_WORKSPACE__` is a DEV-only bridge to
// the workspace store, exposed by WorkspaceShell.
import { test, expect } from '@playwright/test';
import { passCompanyPicker } from './helpers';

test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@demo.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    // Login redirects to the app root ("/"); just wait until we've left /login.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 });
    await passCompanyPicker(page);
});

test.describe('two-level tab bar — modules', () => {
    test('renders a top-row tab per module and closes a module', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => Boolean((window as unknown as { __MSM_WORKSPACE__?: unknown }).__MSM_WORKSPACE__));
        // Two distinct modules → two distinct top-row tabs.
        await page.evaluate(() => {
            const s = (window as unknown as { __MSM_WORKSPACE__: any }).__MSM_WORKSPACE__;
            s.openTab({ id: 'a1', kind: 'list', title: 'Alpha', target: { module: 'demoa', entity: 'one', recordId: '1' }, path: '/', status: 'clean' });
            s.openTab({ id: 'b1', kind: 'list', title: 'Beta', target: { module: 'demob', entity: 'two', recordId: '2' }, path: '/', status: 'clean' });
        });
        await expect(page.getByRole('button', { name: /Alpha/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Beta/ })).toBeVisible();

        // Closing the Beta module removes it; Alpha stays.
        await page.getByRole('button', { name: /Beta/ }).locator('.workbench-doc-tab-close').click();
        await expect(page.getByRole('button', { name: /Beta/ })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Alpha/ })).toBeVisible();
    });
});

test.describe('two-level tab bar — sales orders', () => {
    // The "Delivery / internal notes" field is always visible on the SO form.
    const noteSel = 'textarea[placeholder*="warehouse"]';

    test('a new SO opens from the second row and keep-alive survives a module switch', async ({ page }) => {
        await page.goto('/ar/sales-orders');
        await expect(page.locator('.workbench-doc-tab-new')).toBeVisible();
        await page.locator('.workbench-doc-tab-new').click();

        await page.locator(noteSel).fill('KEEP-ALIVE-123');

        // Open the Invoices module, switch to it, then back to Sales orders.
        await page.evaluate(() => {
            const s = (window as unknown as { __MSM_WORKSPACE__: any }).__MSM_WORKSPACE__;
            s.openTab({ id: 'ar:invoice:view:catalog', kind: 'list', title: 'Invoices', target: { module: 'ar', entity: 'invoice', recordId: 'catalog', mode: 'view' }, path: '/ar/invoices', status: 'clean' });
            s.activateModule('ar/invoice');
        });
        await page.waitForTimeout(150);
        await page.evaluate(() => (window as unknown as { __MSM_WORKSPACE__: any }).__MSM_WORKSPACE__.activateModule('ar/sales-order'));

        await expect(page.locator(noteSel)).toHaveValue('KEEP-ALIVE-123');
    });

    test('reload restores the unsaved draft as a form and posts nothing', async ({ page }) => {
        await page.goto('/ar/sales-orders');
        await expect(page.locator('.workbench-doc-tab-new')).toBeVisible();
        await page.locator('.workbench-doc-tab-new').click();

        await page.locator(noteSel).fill('SURVIVE-RELOAD');
        await page.waitForTimeout(800); // let the debounced autosave flush

        const before = await page.evaluate(() => (window as unknown as { __MSM_WORKSPACE__: any }).__MSM_WORKSPACE__.tabs.length);
        await page.reload();
        await page.waitForTimeout(500);

        // The draft tab is the active one again — reopened as an editable form.
        await expect(page.locator(noteSel)).toHaveValue('SURVIVE-RELOAD');

        const after = await page.evaluate(() => (window as unknown as { __MSM_WORKSPACE__: any }).__MSM_WORKSPACE__.tabs.length);
        expect(after).toBe(before); // nothing committed/duplicated
    });

    test('the New button opens multiple independent draft tabs', async ({ page }) => {
        await page.goto('/ar/sales-orders');
        await expect(page.locator('.workbench-doc-tab-new')).toBeVisible();
        await page.locator('.workbench-doc-tab-new').click();
        await page.locator('.workbench-doc-tab-new').click();

        const newDrafts = await page.evaluate(() =>
            (window as unknown as { __MSM_WORKSPACE__: any }).__MSM_WORKSPACE__.tabs
                .filter((t: any) => t.target.entity === 'sales-order' && t.target.recordId === null).length,
        );
        expect(newDrafts).toBe(2);
    });
});

// e2e/workspace-doc-modules.spec.ts
//
// The five modules migrated to per-document workspace tabs (Customers, AR
// Payments, Stock Counts, Returns & Credits, Banking). Each renders a second
// row (document module) and opens records as their own doc-view tabs. Requires
// the dev server and the backend running.
import { test, expect } from '@playwright/test';

type Bridge = { __MSM_WORKSPACE__: any };

test.beforeEach(async ({ page }) => {
    // Persisted workspace tabs accumulate across tests; with MODULE_CAP=10 the
    // 11th distinct module would be blocked. Clear the store on each full page
    // load (SPA row-clicks within a test don't re-trigger this) so every test
    // starts from an empty workspace.
    await page.addInitScript(() => { try { localStorage.removeItem('msm-workspace'); } catch { /* ignore */ } });
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@demo.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 });
});

const docViewEntities = (page: import('@playwright/test').Page) =>
    page.evaluate(() => (window as unknown as Bridge).__MSM_WORKSPACE__.tabs
        .filter((t: any) => t.kind === 'doc-view')
        .map((t: any) => t.target.entity));

// Each migrated module shows the document-module second row (the "New" button).
for (const path of ['/ar/customers', '/ar/payments', '/inventory/counts', '/ar/credits', '/banking', '/ap/pos', '/ap/bills', '/ap/payments', '/ap/vendors', '/ar/delivery-notes', '/ap/debits']) {
    test(`${path} renders as a document module (second-row New button)`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator('.workbench-doc-tab-new')).toBeVisible();
    });
}

// A real data row has action buttons; loading/empty-state rows don't.
const firstDataRow = (page: import('@playwright/test').Page) =>
    page.locator('table tbody tr').filter({ has: page.locator('button') }).first();

test('clicking a customer row opens it as a doc-view tab', async ({ page }) => {
    await page.goto('/ar/customers');
    await expect(page.locator('.workbench-doc-tab-new')).toBeVisible();
    await firstDataRow(page).click();
    await page.waitForFunction(() => (window as unknown as Bridge).__MSM_WORKSPACE__.tabs.some((t: any) => t.kind === 'doc-view' && t.target.entity === 'customer'));
    expect(await docViewEntities(page)).toContain('customer');
});

test('clicking a bank transaction row opens it as a doc-view tab', async ({ page }) => {
    await page.goto('/banking');
    await expect(page.locator('.workbench-doc-tab-new')).toBeVisible();
    await firstDataRow(page).click();
    await page.waitForFunction(() => (window as unknown as Bridge).__MSM_WORKSPACE__.tabs.some((t: any) => t.kind === 'doc-view' && t.target.entity === 'transaction'));
    expect(await docViewEntities(page)).toContain('transaction');
});

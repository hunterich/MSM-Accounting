// e2e/workspace-doc-modules.spec.ts
//
// The five modules migrated to per-document workspace tabs (Customers, AR
// Payments, Stock Counts, Returns & Credits, Banking). Each renders a second
// row (document module) and opens records as their own doc-view tabs. Requires
// the dev server started with VITE_WORKSPACE_TABS=1 and the backend running.
import { test, expect } from '@playwright/test';

type Bridge = { __MSM_WORKSPACE__: any };

test.beforeEach(async ({ page }) => {
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
for (const path of ['/ar/customers', '/ar/payments', '/inventory/counts', '/ar/credits', '/banking']) {
    test(`${path} renders as a document module (second-row New button)`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator('.workbench-doc-tab-new')).toBeVisible();
    });
}

test('clicking a customer row opens it as a doc-view tab', async ({ page }) => {
    await page.goto('/ar/customers');
    await expect(page.locator('.workbench-doc-tab-new')).toBeVisible();
    await page.locator('table tbody tr').first().click();
    await page.waitForFunction(() => (window as unknown as Bridge).__MSM_WORKSPACE__.tabs.some((t: any) => t.kind === 'doc-view' && t.target.entity === 'customer'));
    expect(await docViewEntities(page)).toContain('customer');
});

test('clicking a bank transaction row opens it as a doc-view tab', async ({ page }) => {
    await page.goto('/banking');
    await expect(page.locator('.workbench-doc-tab-new')).toBeVisible();
    await page.locator('table tbody tr').first().click();
    await page.waitForFunction(() => (window as unknown as Bridge).__MSM_WORKSPACE__.tabs.some((t: any) => t.kind === 'doc-view' && t.target.entity === 'transaction'));
    expect(await docViewEntities(page)).toContain('transaction');
});

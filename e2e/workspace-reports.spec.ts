// e2e/workspace-reports.spec.ts
//
// Reports migrated to per-document workspace tabs: a second row with the
// catalog button but NO "New" button, and choosing a report opens it as its
// own `report` sub-tab (the card grid / "Laporan Lainnya" no longer sit under a
// generated report). Requires the dev server
// and the backend running (same setup as the other workspace specs).
import { test, expect } from '@playwright/test';
import { passCompanyPicker } from './helpers';

type Bridge = { __MSM_WORKSPACE__: { tabs: Array<{ kind: string; target: { module: string; entity: string } }> } };

const reportTabExists = (page: import('@playwright/test').Page) =>
    page.evaluate(() => (window as unknown as Bridge).__MSM_WORKSPACE__.tabs
        .some((t) => t.kind === 'report' && t.target.module === 'reports'));

test.beforeEach(async ({ page }) => {
    // Persisted workspace tabs accumulate across tests; clear the store on each
    // full page load so every test starts from an empty workspace.
    await page.addInitScript(() => { try { localStorage.removeItem('msm-workspace'); } catch { /* ignore */ } });
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@demo.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 });
    await passCompanyPicker(page);
});

test('Reports is a document module with a catalog row but no New button', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.locator('.workbench-doc-tab-catalog')).toBeVisible();
    await expect(page.locator('.workbench-doc-tab-new')).toHaveCount(0);
});

test('running a report opens it as a report sub-tab', async ({ page }) => {
    await page.goto('/reports');
    // Default category is Sales; open a sales report card → parameter modal → run.
    // The modal pre-fills the date range, so "Tampilkan" runs immediately. The
    // report tab is created synchronously by the run action, before any fetch
    // resolves, so this assertion does not depend on backend report data.
    await page.getByRole('button', { name: /Sales by Customer/ }).first().click();
    await page.getByRole('button', { name: 'Tampilkan' }).click();
    await page.waitForFunction(() => (window as unknown as { __MSM_WORKSPACE__: { tabs: Array<{ kind: string; target: { module: string } }> } })
        .__MSM_WORKSPACE__.tabs.some((t) => t.kind === 'report' && t.target.module === 'reports'), { timeout: 15000 });
    expect(await reportTabExists(page)).toBe(true);
});

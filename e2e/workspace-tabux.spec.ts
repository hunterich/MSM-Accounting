// e2e/workspace-tabux.spec.ts
//
// Tab UX: the at-cap prompt (replaces the old window.alert), the right-click
// tab context menu, and reopen-closed. Requires the dev server started with
// the backend running. Drives the DEV-only workspace
// store bridge `window.__MSM_WORKSPACE__` exposed by WorkspaceShell.
//
// Tests run on /ar/invoices so the active module stays a document module (the
// second tab row is visible). Store *setup* happens inside a single
// page.evaluate() so the shell's route reconcile can't desync a multi-step setup.
import { test, expect } from '@playwright/test';

type Bridge = { __MSM_WORKSPACE__: any };

test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@demo.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 });
    await page.goto('/ar/invoices');
    await page.waitForFunction(() => Boolean((window as unknown as Bridge).__MSM_WORKSPACE__));
    await expect(page.locator('.workbench-doc-tab-new')).toBeVisible();
});

// Open N invoice record tabs in ONE evaluate and focus the module.
const seedInvoiceTabs = (page: import('@playwright/test').Page, n: number) =>
    page.evaluate((count) => {
        const w = window as unknown as Bridge;
        w.__MSM_WORKSPACE__.closeAll();
        for (let i = 0; i < count; i++) {
            w.__MSM_WORKSPACE__.openTab({ id: `ar:invoice:view:R${i}`, kind: 'doc-view', title: `INV-${i}`, target: { module: 'ar', entity: 'invoice', recordId: `R${i}`, mode: 'view' }, path: '/ar/invoices', status: 'clean' });
        }
        w.__MSM_WORKSPACE__.activateModule('ar/invoice');
    }, n);

const invoiceRecordIds = (page: import('@playwright/test').Page) =>
    page.evaluate(() => (window as unknown as Bridge).__MSM_WORKSPACE__.tabs
        .filter((t: any) => t.kind === 'doc-view' && t.target.entity === 'invoice')
        .map((t: any) => t.target.recordId));

test.describe('at-cap prompt', () => {
    test('the modal opens a stashed tab via "Close oldest & open" instead of dead-ending', async ({ page }) => {
        await seedInvoiceTabs(page, 3);
        await page.evaluate(() => {
            (window as unknown as Bridge).__MSM_WORKSPACE__.promptForCap({ id: 'ar:invoice:view:BLOCKED', kind: 'doc-view', title: 'INV-BLOCKED', target: { module: 'ar', entity: 'invoice', recordId: 'BLOCKED', mode: 'view' }, path: '/ar/invoices', status: 'clean' });
        });

        await expect(page.getByText(/already has 10 tabs/)).toBeVisible();
        await page.getByRole('button', { name: /Close oldest & open/ }).click();

        const state = await page.evaluate(() => {
            const s = (window as unknown as Bridge).__MSM_WORKSPACE__;
            return { hasBlocked: s.tabs.some((t: any) => t.id === 'ar:invoice:view:BLOCKED'), hasR0: s.tabs.some((t: any) => t.id === 'ar:invoice:view:R0'), capPrompt: s.capPrompt };
        });
        expect(state.hasBlocked).toBe(true); // the blocked doc is now open
        expect(state.hasR0).toBe(false);     // the oldest tab was closed to make room
        expect(state.capPrompt).toBeNull();
        await expect(page.getByText(/already has 10 tabs/)).toHaveCount(0);
    });

    test('Cancel dismisses the prompt and changes nothing', async ({ page }) => {
        await seedInvoiceTabs(page, 2);
        await page.evaluate(() => {
            (window as unknown as Bridge).__MSM_WORKSPACE__.promptForCap({ id: 'ar:invoice:view:BLOCKED', kind: 'doc-view', title: 'INV-BLOCKED', target: { module: 'ar', entity: 'invoice', recordId: 'BLOCKED', mode: 'view' }, path: '/ar/invoices', status: 'clean' });
        });
        await expect(page.getByText(/already has 10 tabs/)).toBeVisible();
        await page.getByRole('button', { name: 'Cancel' }).click();
        await expect(page.getByText(/already has 10 tabs/)).toHaveCount(0);
        expect(await invoiceRecordIds(page)).toEqual(['R0', 'R1']);
    });
});

test.describe('tab context menu', () => {
    test('right-click a record tab shows the full close menu and "Close others" works', async ({ page }) => {
        await seedInvoiceTabs(page, 3);
        const tab = page.locator('.workbench-doc-tab-scroll .workbench-doc-tab', { hasText: 'INV-1' });
        await tab.click({ button: 'right' });

        for (const label of ['Close', 'Close others', 'Close to the right', 'Close all', 'Reopen closed tab']) {
            await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
        }

        await page.getByRole('menuitem', { name: 'Close others' }).click();
        expect(await invoiceRecordIds(page)).toEqual(['R1']);
    });
});

test.describe('reopen closed', () => {
    test('the reopen-closed shortcut brings back the last-closed tab', async ({ page }) => {
        // Seed + close in ONE evaluate so the close isn't undone by route reconcile.
        await page.evaluate(() => {
            const w = window as unknown as Bridge;
            w.__MSM_WORKSPACE__.closeAll();
            for (const id of ['R0', 'R1']) {
                w.__MSM_WORKSPACE__.openTab({ id: `ar:invoice:view:${id}`, kind: 'doc-view', title: `INV-${id}`, target: { module: 'ar', entity: 'invoice', recordId: id, mode: 'view' }, path: '/ar/invoices', status: 'clean' });
            }
            w.__MSM_WORKSPACE__.activateModule('ar/invoice');
            w.__MSM_WORKSPACE__.closeTab('ar:invoice:view:R1');
        });
        expect(await invoiceRecordIds(page)).toEqual(['R0']);

        // Dispatch the real shortcut to the window handler (Chrome would otherwise
        // intercept Ctrl+Shift+T as its own "reopen tab" before the page sees it).
        await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', ctrlKey: true, shiftKey: true, bubbles: true })));

        expect(await invoiceRecordIds(page)).toContain('R1');
    });
});

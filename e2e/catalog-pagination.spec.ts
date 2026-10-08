import { test, expect } from '@playwright/test';
import { login } from './helpers';

for (const catalog of [
    { path: '/ap/bills', endpoint: 'bills', label: 'bills', party: { vendor: { name: 'Pagination vendor' } } },
    { path: '/ar/payments', endpoint: 'ar-payments', label: 'payments', party: { customer: { name: 'Pagination customer' } } },
    { path: '/ap/payments', endpoint: 'ap-payments', label: 'payments', party: { vendor: { name: 'Pagination vendor' } } },
]) {
    test(`${catalog.endpoint} exposes later pages, searches beyond the first page, and scrolls`, async ({ page }) => {
        await login(page);
        const records = Array.from({ length: 65 }, (_, index) => ({
            id: `catalog-${index + 1}`, number: `CAT-${String(index + 1).padStart(3, '0')}`,
            date: '2026-09-18T00:00:00Z', issueDate: '2026-09-18T00:00:00Z', dueDate: '2026-10-18T00:00:00Z',
            status: catalog.endpoint === 'bills' ? 'OPEN' : 'COMPLETED', totalAmount: 1000, lines: [], ...catalog.party,
        }));
        await page.route(`**/api/v1/${catalog.endpoint}?*`, async route => {
            const params = new URL(route.request().url()).searchParams;
            const pageNo = Number(params.get('page') || 1);
            const limit = Number(params.get('limit') || 20);
            const search = (params.get('search') || '').toLowerCase();
            const matching = records.filter(record => record.number.toLowerCase().includes(search));
            await route.fulfill({ json: { data: matching.slice((pageNo - 1) * limit, pageNo * limit), total: matching.length, page: pageNo, limit } });
        });
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto(catalog.path);
        const paging = page.getByRole('navigation', { name: `${catalog.label} pagination`, exact: true });
        await expect(paging).toContainText('Showing 1–20 of 65');
        await paging.getByRole('button', { name: 'Next', exact: true }).click();
        await expect(paging).toContainText('Showing 21–40 of 65');
        await expect(page.getByText('CAT-021', { exact: true })).toBeVisible();
        await page.getByRole('textbox', { name: 'Search', exact: true }).fill('CAT-065');
        await expect(paging).toContainText('Showing 1–1 of 1');
        await expect(page.getByText('CAT-065', { exact: true })).toBeVisible();
        await page.getByRole('textbox', { name: 'Search', exact: true }).fill('');
        await expect(paging).toContainText('Showing 1–20 of 65');
        await paging.getByLabel(`${catalog.label} per page`).selectOption('50');
        await expect(paging).toContainText('Showing 1–50 of 65');
        const scroll = page.getByLabel(`${catalog.label} table`, { exact: true });
        await expect.poll(() => scroll.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
        await scroll.hover();
        await page.mouse.wheel(0, 600);
        await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        await paging.getByRole('button', { name: 'Last', exact: true }).click();
        await expect(paging).toContainText('Showing 51–65 of 65');
        await expect(paging.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    });
}

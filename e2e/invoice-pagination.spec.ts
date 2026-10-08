import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('invoice catalog pages, filters the whole dataset, and scrolls within the table', async ({ page }) => {
    await login(page);
    // A read-only catalog fixture verifies the UI boundary without writing dozens
    // of accounting documents solely to produce multiple list pages.
    const invoices = Array.from({ length: 65 }, (_, index) => ({
        id: `pagination-${index + 1}`, number: `PAGE-${String(index + 1).padStart(3, '0')}`,
        issueDate: '2026-09-18T00:00:00Z', status: index < 40 ? 'PAID' : 'DRAFT',
        customerId: 'page-customer', customer: { name: 'Pagination customer' },
        totalAmount: 1000, lines: [],
    }));
    await page.route('**/api/v1/invoices?*', async (route) => {
        const params = new URL(route.request().url()).searchParams;
        const pageNo = Number(params.get('page') || 1);
        const limit = Number(params.get('limit') || 20);
        const status = params.get('status');
        const search = (params.get('search') || '').toLowerCase();
        const matching = invoices.filter((invoice) => (!status || invoice.status === status)
            && (!search || invoice.number.toLowerCase().includes(search)));
        await route.fulfill({ json: { data: matching.slice((pageNo - 1) * limit, pageNo * limit), total: matching.length, page: pageNo, limit } });
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/ar/invoices');
    const paging = page.getByRole('navigation', { name: 'Invoice pagination' });
    await expect(paging).toContainText('Showing 1–20 of 65 invoices');
    await page.getByRole('button', { name: 'Next invoice page' }).click();
    await expect(paging).toContainText('Showing 21–40 of 65 invoices');
    await expect(page.getByText('PAGE-021', { exact: true })).toBeVisible();
    await page.getByLabel('Status', { exact: true }).selectOption('Draft');
    await expect(paging).toContainText('Showing 1–20 of 25 invoices');
    await expect(page.getByText('PAGE-041', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search', exact: true }).fill('PAGE-065');
    await expect(paging).toContainText('Showing 1–1 of 1 invoices');
    await expect(page.getByText('PAGE-065', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search', exact: true }).fill('');
    await page.getByLabel('Status', { exact: true }).selectOption('');
    await expect(paging).toContainText('Showing 1–20 of 65 invoices');
    await page.getByLabel('Invoices per page').selectOption('50');
    await expect(paging).toContainText('Showing 1–50 of 65 invoices');
    const scroll = page.getByTestId('invoice-table-scroll');
    await expect.poll(() => scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await scroll.hover();
    await page.mouse.wheel(0, 700);
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(paging).toBeInViewport();
    await page.getByLabel('Go to invoice page').fill('2');
    await paging.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(paging).toContainText('Showing 51–65 of 65 invoices');
    await expect(page.getByRole('button', { name: 'Next invoice page' })).toBeDisabled();
});

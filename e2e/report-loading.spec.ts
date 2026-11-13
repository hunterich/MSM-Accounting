import { expect, test, type Page } from '@playwright/test';
import type { WorkspaceTab } from '../src/stores/workspace/types';

// These UI checks mock the API and never touch accounting data.
const requests: URL[] = [];
type Bridge = { __MSM_WORKSPACE__: { tabs: WorkspaceTab[]; activeTabId: string; activateTab(id: string): void } };
const catalog: WorkspaceTab = {
  id: 'reports:catalog:view:catalog', kind: 'list', title: 'Reports',
  target: { module: 'reports', entity: 'catalog', recordId: 'catalog', mode: 'view' },
  path: '/reports', status: 'clean',
};

test.beforeEach(async ({ page }) => {
  requests.length = 0;
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.setItem('msm-active-org', 'review-org');
    localStorage.setItem('msm:app-updates:read:review-user', JSON.stringify(['2026-10-08.1']));
  });
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const path = url.pathname;
    let json: unknown = [];
    if (path.endsWith('/auth/me')) json = {
      user: { id: 'review-user', fullName: 'Review User', email: 'review@example.test' },
      org: { id: 'review-org', name: 'Review org', costingMethod: 'FIFO' },
      roleType: 'ADMIN', permissions: [], memberships: [{ orgId: 'review-org', name: 'Review org', roleType: 'ADMIN' }],
    };
    else if (path.endsWith('/access-schedule')) json = { allowed: true, exempt: true, timezone: 'Asia/Jakarta', schedule: {}, serverNow: new Date().toISOString() };
    else if (path.endsWith('/organization/settings')) json = { id: 'review-org', displayName: 'Review org', costingMethod: 'FIFO' };
    else if (/\/(customers|vendors|items)$/.test(path)) {
      const kind = path.split('/').pop()!;
      const search = url.searchParams.get('search');
      const pageNo = Number(url.searchParams.get('page') || 1);
      json = { data: [{ id: `${kind}-${search ? 150 : pageNo}`, name: search ? `Archived ${search}` : `First ${kind}`, code: search ? 'LATE150' : 'FIRST' }], total: search ? 1 : 150, page: pageNo, limit: 20 };
    }
    else if (/\/(customers|vendors|items)\/[^/]+$/.test(path)) json = { id: path.split('/').pop(), name: 'Restored vendor', code: 'LATE150' };
    else if (path.endsWith('/reports/ap')) json = {
      party: { id: url.searchParams.get('vendorId'), name: 'Archived Vendor150', code: 'LATE150' },
      period: { dateFrom: '2026-10-01', dateTo: '2026-10-16' }, openingBalance: 0, rows: [],
      summary: { totalDebits: 0, totalCredits: 0, closingBalance: 0, aging: {} },
    };
    else if (path.endsWith('/reports/control-reconciliation')) json = {
      kind: url.searchParams.get('kind'), asOf: url.searchParams.get('asOfDate'), accounts: [],
      totals: { glBalance: 0, subledgerBalance: 0, difference: 0 },
    };
    else if (path.includes('/reports/')) json = { rows: [], sections: [], summary: {}, grandTotal: 0 };
    else if (path.endsWith('/invoices')) json = { data: [], total: 0, page: 1, limit: 20 };
    await route.fulfill({ json });
  });
});

async function openReports(page: Page) {
  await page.goto('/reports');
  await expect(page.getByRole('button', { name: /Sales by Customer/ }).first()).toBeVisible();
}

for (const kind of ['ar', 'ap'] as const) test(`${kind} control reconciliation remains available`, async ({ page }) => {
  await openReports(page);
  await page.getByRole('button', { name: kind === 'ar' ? 'Receivables' : 'Payables', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`${kind.toUpperCase()} Control Reconciliation`) }).click();
  await page.getByLabel('Report as-of date').fill('2026-09-30');
  await page.getByRole('button', { name: 'Tampilkan', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Control account reconciliation' })).toBeVisible();
  expect(requests.some(url => url.pathname.endsWith('/reports/control-reconciliation') && url.searchParams.get('kind') === kind && url.searchParams.get('asOfDate') === '2026-09-30')).toBe(true);
});

test('report catalog and financial filters do not download unrelated master lists', async ({ page }) => {
  await openReports(page);
  await page.locator('#main-content').getByRole('button', { name: 'General Ledger', exact: true }).click();
  await page.getByRole('button', { name: /Trial Balance/ }).click();
  await expect(page.getByText('Parameter Laporan', { exact: true })).toBeVisible();
  expect(requests.filter(url => /\/(customers|vendors|items|accounts|warehouses|item-categories|bank-accounts)$/.test(url.pathname))).toEqual([]);
});

test('customer picker searches beyond the first page and preserves the selected filter', async ({ page }) => {
  await openReports(page);
  await page.getByRole('button', { name: /Sales by Customer/ }).first().click();
  expect(requests.some(url => url.pathname.endsWith('/customers'))).toBe(false);
  await page.getByRole('button', { name: /Pelanggan \(Opsional\)/ }).click();
  await expect(page.getByRole('button', { name: /First customers/ })).toBeVisible();
  await page.getByRole('button', { name: 'Berikutnya' }).click();
  await expect.poll(() => requests.some(url => url.pathname.endsWith('/customers') && url.searchParams.get('page') === '2')).toBe(true);
  await page.getByRole('textbox', { name: /Cari Pelanggan/ }).fill('Customer150');
  await page.getByRole('button', { name: /Archived Customer150/ }).click();
  await page.getByRole('button', { name: 'Tampilkan', exact: true }).click();
  await expect.poll(() => requests.some(url => url.pathname.endsWith('/reports/sales') && url.searchParams.get('customerSearch') === 'Archived Customer150')).toBe(true);
  expect(requests.filter(url => url.pathname.endsWith('/customers')).every(url => url.searchParams.get('limit') === '20' && url.searchParams.get('status') === 'ALL')).toBe(true);
  await page.getByRole('button', { name: /Ubah Filter/ }).click();
  await expect(page.getByRole('button', { name: /Pelanggan \(Opsional\).*Archived Customer150/ })).toBeVisible();
});

test('vendor statements search archived vendors and restore selections by id', async ({ page }) => {
  await openReports(page);
  await page.getByRole('button', { name: 'Payables', exact: true }).click();
  await page.getByRole('button', { name: /Vendor Statement/ }).click();
  await page.getByRole('button', { name: /Vendor Pilih vendor/ }).click();
  await page.getByRole('textbox', { name: 'Cari Vendor', exact: true }).fill('Vendor150');
  await page.getByRole('button', { name: /Archived Vendor150/ }).click();
  await page.getByRole('button', { name: 'Tampilkan', exact: true }).click();
  await expect.poll(() => requests.some(url => url.pathname.endsWith('/reports/ap') && url.searchParams.get('vendorId') === 'vendors-150')).toBe(true);
  await page.getByRole('button', { name: /Ubah Filter/ }).click();
  await expect(page.getByRole('button', { name: /Vendor Restored vendor/ })).toBeVisible();
});

test('restored background forms wait for first visit and retain edits when switching tabs', async ({ page }) => {
  await page.addInitScript((reportCatalog) => {
    const form: WorkspaceTab = {
      id: 'review-invoice', kind: 'doc-form', title: 'Draft invoice',
      target: { module: 'ar', entity: 'invoice', recordId: null, mode: 'create' },
      path: '/ar/invoices/new', status: 'new',
    };
    localStorage.setItem('msm-workspace:review-org', JSON.stringify({ version: 2, state: {
      tabs: [reportCatalog, form], activeTabId: reportCatalog.id, moduleActive: { reports: reportCatalog.id, 'ar/invoice': form.id }, closedStack: [],
    } }));
  }, catalog);
  await openReports(page);
  expect(requests.some(url => /\/(items|invoices|customers)$/.test(url.pathname))).toBe(false);
  await page.evaluate(() => (window as unknown as Bridge).__MSM_WORKSPACE__.activateTab('review-invoice'));
  await page.getByRole('button', { name: 'Logistics & Notes' }).click();
  const notes = page.locator('textarea[name="notes"]');
  await expect(notes).toBeVisible();
  await notes.fill('Keep this unsaved edit');
  const reportsId = await page.evaluate(() => (window as unknown as Bridge).__MSM_WORKSPACE__.tabs.find(tab => tab.target.module === 'reports')!.id);
  await page.evaluate(id => (window as unknown as Bridge).__MSM_WORKSPACE__.activateTab(id), reportsId);
  await expect(notes).toBeHidden();
  await page.evaluate(() => (window as unknown as Bridge).__MSM_WORKSPACE__.activateTab('review-invoice'));
  await expect(notes).toHaveValue('Keep this unsaved edit');
});

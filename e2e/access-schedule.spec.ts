import { expect, test, type Page } from '@playwright/test';
import type { WorkspaceTab } from '../src/stores/workspace/types';

let serverNow: string;
let unrestricted: boolean;
let roleType: string;
let importStarted: () => void;
let releaseImport: Promise<void>;
const fixtureOrg = 'schedule-org';
const fixtureUser = 'schedule-user';
const checkpointKey = `msm-invoice-import:${fixtureUser}:${fixtureOrg}`;
const invoiceTab: WorkspaceTab = {
  id: 'schedule-invoice', kind: 'doc-form', title: 'Draft invoice',
  target: { module: 'ar', entity: 'invoice', recordId: null, mode: 'create' },
  path: '/ar/invoices/new', status: 'new',
};

test.beforeEach(async ({ page }) => {
  serverNow = '2026-10-19T09:59:55Z'; unrestricted = false; roleType = 'CUSTOM';
  await page.addInitScript(() => {
    sessionStorage.setItem('msm-active-org', 'schedule-org');
    localStorage.setItem('msm-ui-language', JSON.stringify({ state: { language: 'en' }, version: 0 }));
    localStorage.setItem('msm:app-updates:read:schedule-user', JSON.stringify(['2026-10-08.1']));
  });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (path.endsWith('/auth/me')) json = {
      user: { id: fixtureUser, fullName: 'Schedule User', email: 'schedule@example.test' },
      org: { id: fixtureOrg, name: 'Schedule org', costingMethod: 'FIFO' },
      roleType, permissions: ['AR_INVOICES', 'AR_CUSTOMERS', 'INV_ITEMS', 'SETTINGS', 'REPORTS', 'DASHBOARD'].map(moduleKey => ({ moduleKey, canView: true, canCreate: true, canEdit: true })),
      memberships: [{ orgId: fixtureOrg, name: 'Schedule org', roleType }],
    };
    else if (path.endsWith('/access-schedule')) json = {
      allowed: unrestricted || roleType === 'ADMIN' || serverNow < '2026-10-19T10:00:00Z', exempt: roleType === 'ADMIN',
      timezone: 'Asia/Jakarta', serverNow, schedule: unrestricted ? {} : { allowedDays: [], startTime: '08:00', endTime: '17:00' },
    };
    else if (path.endsWith('/organization/settings')) json = { id: fixtureOrg, displayName: 'Schedule org', costingMethod: 'FIFO', taxEnabled: false };
    else if (path.endsWith('/roles')) json = { data: [{ id: 'staff-role', name: 'Unrestricted staff', roleType: 'CUSTOM', isActive: true, allowedDays: null, startTime: null, endTime: null, permissions: [], memberCount: 1 }] };
    else if (path.endsWith('/integrations')) json = { data: [{ id: 'shop', shopName: 'Schedule shop', platform: 'SHOPEE', status: 'ACTIVE', customerId: 'customer', importStatusFilter: 'Selesai' }] };
    else if (path.endsWith('/items/sku-index')) json = { data: [{ id: 'item', sku: 'QA-SKU', name: 'QA product', isActive: true }] };
    else if (path.endsWith('/import/preview')) json = {
      create: 1, logisticsUpdates: 0, alreadyImported: 0, blocked: 0, amountDifferences: 0,
      sourceTotal: 100, invoiceTotal: 100, taxAmount: 0, paymentAccountMissing: false, setupErrors: [],
      orders: [{ orderNo: 'QA-ORDER', status: 'create', sourceTotal: 100, invoiceTotal: 100, taxAmount: 0, difference: 0 }],
    };
    else if (path.endsWith('/shop/import')) {
      importStarted?.(); await releaseImport;
      json = { created: 1, logisticsUpdated: 0, skipped: 0, failed: [] };
    }
    else if (/\/(invoices|customers|items|users)$/.test(path)) json = { data: [], total: 0, page: 1, limit: 20 };
    await route.fulfill({ json });
  });
});

async function seedInvoice(page: Page) {
  await page.addInitScript(tab => {
    if (!localStorage.getItem('msm-workspace:schedule-org')) localStorage.setItem('msm-workspace:schedule-org', JSON.stringify({ version: 2, state: {
      tabs: [tab], activeTabId: tab.id, moduleActive: { 'ar/invoice': tab.id }, closedStack: [],
    } }));
  }, invoiceTab);
}

test('warns before cutoff, preserves the last invoice keystroke and restores after reopening', async ({ page }) => {
  await page.clock.install();
  await seedInvoice(page);
  await page.goto('/ar/invoices/new');
  await expect(page.getByText(/Access ends within 5 minutes/)).toBeVisible();
  await page.getByRole('button', { name: 'Logistics & Notes' }).click();
  const notes = page.locator('textarea[name="notes"]');
  await notes.fill('Earlier invoice edit');
  await page.clock.runFor(4600);
  await notes.fill('The very last invoice edit');
  // Cross cutoff before the normal 600ms autosave debounce can run.
  await page.clock.runFor(550);
  await expect(page.getByRole('heading', { name: 'Outside your access hours' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('msm-workspace:schedule-org')!).state.tabs.find((t: { id: string }) => t.id === 'schedule-invoice').draft.notes)).toBe('The very last invoice edit');
  await expect(notes.locator('xpath=ancestor::*[@inert]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  serverNow = '2026-10-19T10:00:10Z';
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Outside your access hours' })).toBeVisible();
  unrestricted = true;
  await page.getByRole('button', { name: 'Check access', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Outside your access hours' })).toBeHidden();
  await page.getByRole('button', { name: 'Logistics & Notes' }).click();
  await expect(page.locator('textarea[name="notes"]')).toHaveValue('The very last invoice edit');
});

test('keeps an accepted import mounted through cutoff and preserves its completed result', async ({ page }) => {
  await page.clock.install();
  let resolveImport!: () => void;
  releaseImport = new Promise(resolve => { resolveImport = resolve; });
  const started = new Promise<void>(resolve => { importStarted = resolve; });
  await page.addInitScript(key => {
    localStorage.setItem(key, JSON.stringify({ version: 1, data: {
      step: 'configure', shopId: 'shop', localMappings: { 'QA-SKU': 'item' }, recordPayment: false, dateField: 'completionDate', fallbackDate: '', importResult: null,
      parseResult: { parsedOrders: [{ orderNumber: 'QA-ORDER', orderDate: '2026-10-19', completionDate: '2026-10-19', paymentDate: null,
        buyerUsername: 'Buyer', recipientName: 'Buyer', phone: '', shippingAddress: '', city: '', province: '', paymentMethod: '', trackingNumber: '', totalPayment: 100, totalProductAmount: 100,
        items: [{ productName: 'QA product', variationName: '', priceAfterDiscount: 100, quantity: 1, productTotal: 100, parentSKU: 'QA-SKU', skuReference: 'QA-SKU', sellerDiscount: 0, shopeeDiscount: 0 }] }],
        uniqueProducts: [{ key: 'QA-SKU', productName: 'QA product', variationName: '', parentSKU: 'QA-SKU', skuReference: 'QA-SKU' }], warnings: [], stats: { totalRows: 1, totalOrders: 1, skippedRows: 0, totalAmount: 100 }, headerReport: { resolvedHeaders: {}, missingRequired: [], missingOptional: [], unknownHeaders: [], actualHeaders: [] } },
    } }));
  }, checkpointKey);
  await page.goto('/ar/invoices');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('button', { name: /Import 1 New/ }).click();
  await started;
  serverNow = '2026-10-19T10:00:02Z';
  await page.clock.runFor(6000);
  await expect(page.getByRole('heading', { name: 'Outside your access hours' })).toBeVisible();
  await page.keyboard.press('Escape');
  resolveImport();
  await expect.poll(async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).data.importResult?.created, checkpointKey)).toBe(1);
  unrestricted = true;
  await page.getByRole('button', { name: 'Check access', exact: true }).click();
  await expect(page.getByText('Import Complete', { exact: true })).toBeVisible();
});

test('unconfigured role editor retains blank times instead of inventing office hours', async ({ page }) => {
  roleType = 'ADMIN';
  await page.goto('/users');
  await expect(page.getByText('Unrestricted staff', { exact: true })).toBeVisible();
  await page.getByText('Unrestricted staff', { exact: true }).locator('xpath=ancestor::tr').getByRole('button').first().click();
  await expect(page.locator('input[type="time"]').nth(0)).toHaveValue('');
  await expect(page.locator('input[type="time"]').nth(1)).toHaveValue('');
  await expect(page.getByText(/Saved — not enforced yet/)).toHaveCount(0);
});

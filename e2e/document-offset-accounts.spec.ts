import { expect, test, type Page } from '@playwright/test';

let writes: Array<{ path: string; body: Record<string, unknown> }>;
let inclusive: boolean | null;
const accounts = [
  { id: 'ar', code: '1210', name: 'AR control', type: 'ASSET', normalSide: 'DEBIT', isPartyControlAccount: true },
  { id: 'ap', code: '2100', name: 'AP control', type: 'LIABILITY', normalSide: 'CREDIT', isPartyControlAccount: true },
  { id: 'alternate', code: '5999', name: 'Alternate control', type: 'EXPENSE', normalSide: 'DEBIT', isPartyControlAccount: true },
  { id: 'rent', code: '5100', name: 'Rent expense', type: 'EXPENSE', normalSide: 'DEBIT', isPartyControlAccount: false },
  { id: 'holding', code: '1400', name: 'Prepaid holding', type: 'ASSET', normalSide: 'DEBIT', isPartyControlAccount: false },
].map(account => ({ ...account, isActive: true, isPostable: true }));
const charge = { id: 'charge', label: 'Freight', accountId: 'ar', amount: 25, taxRate: 0 };
function invoice() {
  const taxed = inclusive !== null;
  return { id: 'invoice', number: 'INV-OFFSET', customerId: 'customer', customer: { id: 'customer', name: 'Customer' }, status: 'DRAFT', issueDate: '2026-09-10', subtotal: 100, totalAmount: taxed && !inclusive ? 138.75 : 125,
    taxEnabled: taxed, taxInclusive: inclusive ?? false, taxRate: taxed ? 11 : 0, taxAmount: taxed ? (inclusive ? 12.39 : 13.75) : 0,
    lines: [{ id: 'line', lineNo: 1, description: 'Service', quantity: 1, unit: 'PCS', price: 100, lineSubtotal: 100 }], charges: [{ ...charge, taxRate: taxed ? 11 : 0 }] };
}
const bill = { id: 'bill', number: 'BILL-OFFSET', vendorId: 'vendor', vendorInvoiceNo: 'FAKTUR', issueDate: '2026-09-10', status: 'DRAFT', subtotal: 100, totalAmount: 125, taxable: false,
  lines: [{ id: 'bill-line', lineNo: 1, description: 'Service', quantity: 1, unit: 'PCS', price: 100, lineTotal: 100, accountId: 'alternate' }], charges: [charge] };
const adjustment = { id: 'adjustment', number: 'ADJ-OFFSET', date: '2026-09-10', type: 'QUANTITY', status: 'DRAFT', reason: 'QA', lines: [{ id: 'adj-line', itemId: 'item', item: { id: 'item', name: 'Product' }, accountId: 'ar', oldQty: 0, newQty: 1, qtyDiff: 1, unitCost: 100 }] };

test.beforeEach(async ({ page }) => {
  writes = []; inclusive = null;
  await page.addInitScript(() => {
    sessionStorage.setItem('msm-active-org', 'offset-org');
    localStorage.setItem('msm:app-updates:read:offset-user', JSON.stringify(['2026-10-08.1']));
    if (!localStorage.getItem('msm-ui-language')) localStorage.setItem('msm-ui-language', JSON.stringify({ state: { language: 'en' }, version: 0 }));
  });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'PUT') writes.push({ path, body: route.request().postDataJSON() });
    let json: unknown = [];
    if (path.endsWith('/auth/me')) json = { user: { id: 'offset-user', fullName: 'Offset User', email: 'offset@test' }, org: { id: 'offset-org', name: 'Offset org', costingMethod: 'FIFO' }, roleType: 'ADMIN', permissions: [], memberships: [{ orgId: 'offset-org', name: 'Offset org', roleType: 'ADMIN' }] };
    else if (path.endsWith('/access-schedule')) json = { allowed: true, exempt: true, timezone: 'Asia/Jakarta', serverNow: new Date().toISOString(), schedule: {} };
    else if (path.endsWith('/organization/settings')) json = { id: 'offset-org', displayName: 'Offset org', costingMethod: 'FIFO', taxEnabled: false };
    else if (path.endsWith('/accounts')) json = { data: accounts, total: accounts.length };
    else if (path.endsWith('/bills/bill')) json = bill;
    else if (path.endsWith('/bills')) json = { data: [bill], total: 1 };
    else if (path.endsWith('/invoices/invoice')) json = invoice();
    else if (path.endsWith('/invoices')) json = { data: [{ ...invoice(), charges: undefined }], total: 1 };
    else if (path.endsWith('/stock-adjustments')) json = { data: [adjustment], total: 1 };
    else if (path.endsWith('/customers')) json = { data: [{ id: 'customer', code: 'C1', name: 'Customer', isActive: true }], total: 1 };
    else if (path.endsWith('/vendors')) json = { data: [{ id: 'vendor', code: 'V1', name: 'Vendor', isActive: true }], total: 1 };
    else if (path.endsWith('/items')) json = { data: [{ id: 'item', sku: 'P1', name: 'Product', type: 'PRODUCT', isActive: true, currentStock: 0 }], total: 1 };
    await route.fulfill({ json });
  });
});
async function openDocument(page: Page, module: 'ar' | 'ap', entity: 'bill' | 'invoice') {
  const path = module === 'ap' ? '/ap/bills/edit?billId=bill' : '/ar/invoices/edit?invoiceId=invoice';
  await page.addInitScript(({ path, module, entity }) => {
    if (!localStorage.getItem('msm-workspace:offset-org')) localStorage.setItem('msm-workspace:offset-org', JSON.stringify({ version: 2, state: {
      tabs: [{ id: 'offset-editor', kind: 'doc-form', title: 'Offset editor', target: { module, entity, recordId: entity, mode: 'edit' }, path, status: 'clean' }], activeTabId: 'offset-editor', moduleActive: { [`${module}/${entity}`]: 'offset-editor' }, closedStack: [],
    } }));
  }, { path, module, entity });
  await page.goto(path);
}

test('bill lines and charges retain invalid selections visibly and allow valid replacements', async ({ page }) => {
  await openDocument(page, 'ap', 'bill');
  const line = page.getByRole('combobox', { name: 'Bill line account', exact: true });
  const cost = page.getByRole('combobox', { name: 'Additional cost account', exact: true });
  await expect(line).toHaveValue('alternate');
  await expect(line.locator('option[value="alternate"]')).toBeDisabled();
  await expect(line.locator('option[value="ar"]')).toHaveCount(0);
  await line.selectOption('rent');
  await page.getByRole('button', { name: 'Additional costs', exact: true }).click();
  await expect(cost).toHaveValue('ar');
  await expect(cost.locator('option[value="ar"]')).toBeDisabled();
  await cost.selectOption('holding');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: 'rent' })]));
  expect(writes[0].body.charges).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: 'holding', amount: 25 })]));
});

test('stock adjustment picker excludes controls and explains a legacy selection in Bahasa', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('msm-ui-language', JSON.stringify({ state: { language: 'id' }, version: 0 })));
  await page.goto('/inventory/adjustments/edit?id=adjustment&mode=edit');
  const picker = page.getByRole('combobox', { name: 'Stock adjustment offset account', exact: true });
  await expect(picker).toHaveValue('ar');
  await expect(picker.locator('option[value="ar"]')).toBeDisabled();
  await expect(page.getByRole('alert').filter({ hasText: 'Tidak dapat digunakan sebagai akun lawan' })).toBeVisible();
  await expect(picker.locator('option[value="alternate"]')).toHaveCount(0);
  await picker.selectOption('holding'); await expect(picker).toHaveValue('holding');
});

for (const taxInclusive of [false, true]) test(`invoice charge account repair retains amounts and ${taxInclusive ? 'inclusive' : 'exclusive'} tax`, async ({ page }) => {
  inclusive = taxInclusive;
  await openDocument(page, 'ar', 'invoice');
  const picker = page.getByRole('combobox', { name: 'Freight account', exact: true });
  await expect(picker).toHaveValue('ar');
  await expect(picker.locator('option[value="ar"]')).toBeDisabled();
  await picker.selectOption('holding');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.totalAmount).toBe(taxInclusive ? 125 : 138.75);
  expect(writes[0].body.charges).toEqual([expect.objectContaining({ accountId: 'holding', amount: 25, taxRate: 11 })]);
});

test('an older recovered invoice draft keeps its notes and hydrates saved charges', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('msm-workspace:offset-org', JSON.stringify({ version: 2, state: {
    tabs: [{ id: 'ar:invoice:edit:invoice', kind: 'doc-form', title: 'Recovered invoice', target: { module: 'ar', entity: 'invoice', recordId: 'invoice', mode: 'edit' }, path: '/ar/invoices/edit?invoiceId=invoice', status: 'dirty',
      draft: { customerId: 'customer', notes: 'Keep recovered notes', items: [{ id: 'line', code: '', description: 'Service', quantity: 1, unit: 'PCS', price: 100 }], taxSettings: { enabled: false, inclusive: false, rate: 0 } } }],
    activeTabId: 'ar:invoice:edit:invoice', moduleActive: { 'ar/invoice': 'ar:invoice:edit:invoice' }, closedStack: [],
  } })));
  await page.goto('/ar/invoices/edit?invoiceId=invoice');
  await expect(page.getByRole('combobox', { name: 'Freight account', exact: true })).toHaveValue('ar');
  await page.getByRole('button', { name: 'Logistics & Notes' }).click();
  await expect(page.locator('textarea[name="notes"]')).toHaveValue('Keep recovered notes');
});

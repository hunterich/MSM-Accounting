import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { accountingCompany, cleanupAccountingCompany, db } from './accounting-helpers';

test.setTimeout(120_000);
test.afterEach(cleanupAccountingCompany);
test.afterAll(() => db.$disconnect());

test('exports every filtered invoice across pages with exact total', async ({ page }) => {
  const { orgId, customer } = await accountingCompany(page);
  await db.salesInvoice.createMany({ data: Array.from({ length: 35 }, (_, i) => ({
    organizationId: orgId, customerId: customer.id, number: `QA-EXPORT-${String(i).padStart(2, '0')}`,
    issueDate: new Date('2026-09-15T00:00:00Z'), status: 'DRAFT' as const, totalAmount: 100,
  })) });
  await db.salesInvoice.create({ data: { organizationId: orgId, customerId: customer.id,
    number: 'EXCLUDED', issueDate: new Date('2026-09-15T00:00:00Z'), totalAmount: 999 } });
  await page.goto('/ar/invoices');
  await page.getByPlaceholder('Search invoice # or customer...').fill('QA-EXPORT');
  await expect(page.getByText(/of 35 invoices/)).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all filtered CSV' }).click();
  const file = await downloaded;
  const csv = await readFile((await file.path())!, 'utf8');
  const rows = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1).map(line => line.split(','));
  expect(rows).toHaveLength(35);
  expect(new Set(rows.map(row => row[0])).size).toBe(35);
  expect(rows.reduce((total, row) => total + Number(row[7]), 0)).toBe(3500);
  expect(csv).not.toContain('EXCLUDED');
});

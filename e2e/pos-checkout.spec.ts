import { test, expect } from '@playwright/test';

// Prereqs to RUN this locally (not run in the default unit CI):
//   1) Dev DB seeded: `npm run db:seed` (adds POS Operator role, WALK-IN customer, REG-1),
//      plus at least one active PRODUCT item with a non-expired StockBatch on REG-1's warehouse.
//   2) Servers up: `npm run dev` (:5173) and `npm run backend:dev` (:3000).
//   3) A cashier login exists (e.g. cashier@demo.com / cashier123 from the seed).
test.describe('POS cashier checkout', () => {
  test('login, open shift, sell an item for cash, see receipt', async ({ page }) => {
    await page.goto('/pos.html');
    await page.fill('input[type="email"]', 'cashier@demo.com');
    await page.fill('input[type="password"]', 'cashier123');
    await page.click('button[type="submit"]');

    // Shift open screen
    await expect(page.getByRole('heading', { name: 'Buka shift' })).toBeVisible();
    await page.fill('input[type="number"]', '100000');
    await page.getByRole('button', { name: 'Buka shift' }).click();

    // Checkout: search an item and add it
    await page.getByPlaceholder('Pindai / cari barang').fill('Paracetamol');
    await page.getByRole('button', { name: /Paracetamol/ }).first().click();

    // Pay
    await page.getByRole('button', { name: 'Bayar' }).click();
    await page.getByLabel('Uang diterima').fill('50000');
    await page.getByRole('button', { name: 'Selesaikan' }).click();

    // Receipt
    await expect(page.getByText('Kembalian')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Transaksi baru' })).toBeVisible();
  });
});

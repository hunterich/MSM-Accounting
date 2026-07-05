import { test, expect } from '@playwright/test';

// Prereqs to RUN this locally (not in the default unit CI): dev DB seeded (POS Operator role
// incl. POS_RETAIL, WALK-IN customer, REG-1) + a stocked batch-tracked item; `npm run dev`
// (:5173) + `npm run backend:dev` (:3000).
test.describe('POS offline', () => {
  test('open shift + cash sale offline, then sync on reconnect', async ({ page, context }) => {
    await page.goto('/pos.html');
    await page.fill('input[type="email"]', 'cashier@demo.com');
    await page.fill('input[type="password"]', 'cashier123');
    await page.click('button[type="submit"]');
    await expect(page.getByRole('heading', { name: 'Buka shift' })).toBeVisible();
    // Give the login-time cache warm-up a moment so the catalog is available offline.
    await page.waitForTimeout(1500);

    await context.setOffline(true);
    await page.fill('input[type="number"]', '100000');
    await page.getByRole('button', { name: 'Buka shift' }).click();
    await page.getByPlaceholder('Pindai / cari barang').fill('Paracetamol');
    await page.getByRole('button', { name: /Paracetamol/ }).first().click();
    await page.getByRole('button', { name: /Bayar/ }).click();
    await page.getByLabel('Uang diterima').fill('50000');
    await page.getByRole('button', { name: 'Selesaikan' }).click();
    await expect(page.getByText('Kembalian')).toBeVisible(); // receipt printed locally, offline
    await page.getByRole('button', { name: 'Transaksi baru' }).click(); // back to checkout (has the OfflineBar)

    await context.setOffline(false);
    await expect(page.getByText('Online')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/antre/)).toHaveCount(0, { timeout: 15000 }); // queue drained
  });
});

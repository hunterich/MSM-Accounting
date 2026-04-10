import { test, expect } from '@playwright/test'

test.describe('Invoices', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', 'admin@demo.com')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/dashboard/)
  })

  test('invoice list page loads', async ({ page }) => {
    await page.goto('/ar/invoices')
    await expect(page.locator('table, [role="table"]').first()).toBeVisible({ timeout: 10000 })
  })
})

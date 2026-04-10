import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto('/login')
    await page.fill('input[type="email"]', 'admin@demo.com')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/dashboard/)
  })

  test('dashboard loads with widgets', async ({ page }) => {
    await expect(page.locator('.dashboard-widget, [data-widget]').first()).toBeVisible({ timeout: 10000 })
  })

  test('navigation sidebar is visible', async ({ page }) => {
    await expect(page.locator('nav, [role="navigation"]').first()).toBeVisible()
  })
})

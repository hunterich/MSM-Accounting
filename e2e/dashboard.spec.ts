import { test, expect } from '@playwright/test'
import { login } from './helpers'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('dashboard renders its widgets from real data', async ({ page }) => {
    // The old assertion looked for `.dashboard-widget` / `[data-widget]`, class
    // names that exist nowhere in the app. Assert the widgets that actually
    // render, and that seeded data reached them — this covers the dashboard
    // aggregation queries, not just that the route mounted.
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('heading', { name: 'Cash on Hand' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Recent Invoices' })).toBeVisible()
    await expect(page.getByText('INV-0001').first()).toBeVisible()
  })

  test('navigation sidebar is visible', async ({ page }) => {
    await expect(page.locator('nav, [role="navigation"]').first()).toBeVisible()
  })
})

import { test, expect } from '@playwright/test'
import { login } from './helpers'

test.describe('Invoices', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('invoice list shows the seeded invoices', async ({ page }) => {
    await page.goto('/ar/invoices')
    // Asserting a seeded invoice number proves the whole path — database, API,
    // normalizer, workspace pane — not merely that some <table> exists.
    await expect(page.getByText('INV-0001').first()).toBeVisible({ timeout: 15000 })
  })
})

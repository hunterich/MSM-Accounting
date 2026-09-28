// e2e/purchase-order-form.spec.ts
//
// New PO: create a vendor straight from the vendor search, and save with a
// manually typed PO number instead of the auto-assigned one.
import { test, expect } from '@playwright/test'
import { login } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('msm-workspace') } catch { /* ignore */ } })
  await login(page)
})

test('adds a new vendor from the search and saves the PO with a manual number', async ({ page }) => {
  const suffix = Date.now().toString().slice(-6)
  const vendorName = `Toko Cantik ${suffix}`
  const poNumber = `PO-TC-${suffix}`
  const alerts: string[] = []
  page.on('dialog', (d) => { alerts.push(d.message()); void d.dismiss() })

  await page.goto('/ap/pos/new')

  // Search for a vendor that does not exist yet → offer to add it.
  await page.locator('.cursor-pointer', { hasText: 'Search & select vendor…' }).first().click()
  await page.getByPlaceholder('Search...').fill(vendorName)
  await page.getByRole('button', { name: `Add new "${vendorName}"` }).click()

  // The quick-create panel carries over what was typed.
  await expect(page.getByPlaceholder('Vendor name *')).toHaveValue(vendorName)
  await page.getByRole('button', { name: 'Create & select' }).click()
  await expect(page.locator('.cursor-pointer', { hasText: vendorName })).toBeVisible()
  await expect(page.getByPlaceholder('Vendor name *')).toHaveCount(0)

  // Manual PO number.
  await page.getByLabel('PO numbering').selectOption('manual')
  await page.getByPlaceholder('e.g. PO-TC-0001').fill(poNumber)

  // One custom line so the PO is valid.
  await page.getByPlaceholder('Search SKU or name to add…').fill('Kemiri oil 75ml')
  await page.getByText('Add “Kemiri oil 75ml” as a custom line').click()

  await page.getByRole('button', { name: 'Save draft' }).click()
  await page.waitForURL((url) => url.pathname === '/ap/pos', { timeout: 15_000 }).catch(() => {
    throw new Error(`PO was not saved. Alerts: ${alerts.join(' | ') || '(none)'} · URL: ${page.url()}`)
  })
  await expect(page.getByText(poNumber).first()).toBeVisible()
})

test('footer "Add new vendor" opens the panel pre-filled with the search text', async ({ page }) => {
  await page.goto('/ap/pos/new')
  await page.locator('.cursor-pointer', { hasText: 'Search & select vendor…' }).first().click()
  await page.getByPlaceholder('Search...').fill('CV Baru')
  await page.getByRole('button', { name: 'Add new vendor' }).click()
  await expect(page.getByPlaceholder('Vendor name *')).toHaveValue('CV Baru')
})

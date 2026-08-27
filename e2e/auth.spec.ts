import { test, expect } from '@playwright/test'
import { login, passCompanyPicker } from './helpers'

test.describe('Authentication', () => {
  test('login with valid credentials lands in the app', async ({ page }) => {
    await login(page)
    // Login redirects to the app root, not /dashboard — assert we are in the
    // workspace rather than guessing at a path.
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('nav, [role="navigation"]').first()).toBeVisible()
  })

  test('login lands on the company picker, which offers to create a company', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', 'admin@demo.com')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')

    // Accurate-style: the company list comes first, even for this
    // single-company account — the app itself is not rendered yet.
    const picker = page.getByTestId('company-picker')
    await expect(picker).toBeVisible()
    await expect(page.getByTestId('company-picker-option')).toHaveCount(1)
    await expect(page.locator('nav')).toHaveCount(0)

    // Creating a company is reachable from here, which is what makes the
    // picker survivable for an account that has none yet. Only the affordance
    // is asserted: submitting would add a company to the shared fixture and
    // change what every later spec's picker shows.
    await page.getByTestId('company-picker-new').click()
    await expect(page.getByRole('button', { name: 'Create and open' })).toBeVisible()

    // And the list still gets you into the app.
    await passCompanyPicker(page)
    await expect(page.locator('nav').first()).toBeVisible()
  })

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', 'wrong@email.com')
    await page.fill('input[type="password"]', 'wrongpass')
    await page.click('button[type="submit"]')
    await expect(page.locator('[role="alert"], .text-danger-600, .text-red-500')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })
})

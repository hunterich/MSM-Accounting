import { test, expect } from '@playwright/test'
import { login } from './helpers'

test.describe('Authentication', () => {
  test('login with valid credentials lands in the app', async ({ page }) => {
    await login(page)
    // Login redirects to the app root, not /dashboard — assert we are in the
    // workspace rather than guessing at a path.
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('nav, [role="navigation"]').first()).toBeVisible()
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

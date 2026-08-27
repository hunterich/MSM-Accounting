import { expect, type Page } from '@playwright/test'

/**
 * Sign in as the seeded admin.
 *
 * Three specs used to inline this and wait for `/dashboard`, a URL the app never
 * navigates to — login lands on `/`. They had been failing on that for a while.
 * Waiting for "no longer on /login" is what the workspace specs already do, and
 * it does not care where the app decides to land.
 */
export async function login(
  page: Page,
  email = 'admin@demo.com',
  password = 'admin123',
): Promise<void> {
  await page.goto('/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
}

/** Open a workspace route and wait for the DEV-only store bridge to appear. */
export async function gotoWorkspace(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.waitForFunction(
    () => Boolean((window as unknown as { __MSM_WORKSPACE__?: unknown }).__MSM_WORKSPACE__),
    undefined,
    { timeout: 30_000 },
  )
}

/** The searchable-select used across the document forms: open it, pick by label. */
export async function pickFromSearchableSelect(
  page: Page,
  placeholder: string,
  optionText: string | RegExp,
): Promise<void> {
  await page.locator('.cursor-pointer', { hasText: placeholder }).first().click()
  await page.locator('.cursor-pointer', { hasText: optionText }).first().click()
  await expect(page.locator('.cursor-pointer', { hasText: placeholder })).toHaveCount(0)
}

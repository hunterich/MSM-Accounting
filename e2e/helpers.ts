import { expect, type Page } from '@playwright/test'

/**
 * Pick the first company on the post-login picker, if it is showing.
 *
 * Every fresh sign-in lands on the company list (Accurate-style), including
 * single-company accounts — so a spec that only waits for "no longer on
 * /login" would otherwise assert against the picker instead of the app.
 *
 * Two things make the naive version flaky, and both are handled here:
 *
 *  - The screen flickers. `login()` populates the auth store, so the picker
 *    paints immediately; ProtectedRoute's mount effect then re-runs
 *    `checkSession`, which flips `isLoading` back on and unmounts the picker
 *    for a beat. Deciding "is the picker up?" with a separate round trip can
 *    land in that gap and wrongly conclude the app is already showing — hence
 *    one atomic waitForFunction that ignores the loading state entirely and
 *    returns WHICH screen settled.
 *  - Absence proves nothing. This is a client-rendered bundle, so "no picker
 *    in the DOM" is equally true of the empty document before React mounts.
 *    Every wait below is for something present.
 *
 * Idempotent: returns immediately when the app is already showing, so specs
 * that reuse a tab already pinned to a company are unaffected.
 */
export async function passCompanyPicker(page: Page): Promise<void> {
  const PICKER = '[data-testid="company-picker"]'

  const settled = await page.waitForFunction(
    (picker) => {
      if (document.querySelector('[data-testid="session-loading"]')) return null
      if (document.querySelector(picker)) return 'picker'
      return document.querySelector('nav') ? 'app' : null
    },
    PICKER,
    { timeout: 30_000 },
  )
  if ((await settled.jsonValue()) === 'app') return

  // Selecting hard-reloads through the ?org= handshake. Tag this document
  // first: its absence is unambiguous proof that the wait below is polling the
  // NEW document, which polling for the picker's absence alone is not.
  await page.evaluate(() => {
    ;(window as unknown as { __beforeOrgHandshake?: true }).__beforeOrgHandshake = true
  })
  await page.getByTestId('company-picker-option').first().click()
  await page.waitForFunction(
    (picker) => {
      if ((window as unknown as { __beforeOrgHandshake?: true }).__beforeOrgHandshake) return false
      // The pin is written by the new document's bootstrap, so this is what
      // proves the handshake completed rather than merely started.
      try {
        if (!sessionStorage.getItem('msm-active-org')) return false
      } catch {
        /* storage blocked — fall back to the DOM signals below */
      }
      return !document.querySelector(picker) && Boolean(document.querySelector('nav'))
    },
    PICKER,
    { timeout: 30_000 },
  )
}

/**
 * Sign in as the seeded admin and enter their company.
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
  await passCompanyPicker(page)
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

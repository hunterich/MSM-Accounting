import { test, expect } from '@playwright/test'
import { login } from './helpers'

/**
 * The "this date is in a closed period" warning, end to end.
 *
 * Until now a blocked post only surfaced on submit, as the server guard's 422.
 * This closes a real period, checks the journal form warns about a date inside
 * it before anything is saved, and reopens the period — so the fixture is left
 * exactly as it was found and this can run alongside `period-close.spec.ts`.
 */
test.describe('Closed-period warning on transaction forms', () => {
  test('warns on a journal date inside a closed period, and clears on reopen', async ({ page }) => {
    await login(page)
    await page.goto('/company-setup')

    // Company Setup renders several tables, so anchor on the row that actually
    // carries a Close button. Its first column is the period name, e.g.
    // "2026-12" — read before closing, so the journal date below lands inside
    // that exact period.
    const closeButton = page.getByRole('button', { name: 'Close', exact: true }).first()
    await expect(closeButton).toBeVisible()
    const periodRow = page.locator('tr', { has: closeButton })
    const periodName = (await periodRow.locator('td').first().innerText()).trim()
    expect(periodName).toMatch(/^\d{4}-\d{2}$/)
    const dateInPeriod = `${periodName}-15`

    await closeButton.click()
    await expect(page.getByText('Unposted journal entries')).toBeVisible()
    await page.getByRole('button', { name: 'Close period' }).click()
    await expect(page.getByRole('button', { name: 'Reopen', exact: true }).first()).toBeVisible()

    try {
      await page.goto('/gl/journals/new')
      const dateField = page.locator('input[name="date"]')
      await expect(dateField).toBeVisible()

      // The form defaults to today, which is normally in an open period.
      const banner = page.getByTestId('closed-period-banner')
      await dateField.fill(dateInPeriod)
      await expect(banner).toContainText(periodName)
      await expect(banner).toContainText('closed')

      // The period the date resolves to is shown too — it used to be a
      // hardcoded four-month dropdown that no database ever agreed with.
      await expect(page.getByTestId('je-resolved-period')).toContainText(periodName)

      // Moving out of the closed period clears the warning. The month before
      // it is either open or undefined — only the one period just closed
      // blocks — so either way the banner goes away.
      const [y, m] = periodName.split('-').map(Number)
      const prev = new Date(Date.UTC(y, m - 2, 15))
      await dateField.fill(prev.toISOString().slice(0, 10))
      await expect(banner).toHaveCount(0)
    } finally {
      await page.goto('/company-setup')
      await page.getByRole('button', { name: 'Reopen', exact: true }).first().click()
      await page.getByRole('button', { name: 'Reopen period' }).click()
      await expect(page.getByRole('button', { name: 'Close', exact: true }).first()).toBeVisible()
    }
  })
})

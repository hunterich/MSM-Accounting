import { test, expect } from '@playwright/test'
import { login } from './helpers'

/**
 * Month-end close through the real UI.
 *
 * Leaves the fixture as it found it: the period is closed and then reopened,
 * so this can run in any order alongside the other specs.
 */
test.describe('Month-end close', () => {
  test('closes a period behind the checklist, then reopens it', async ({ page }) => {
    await login(page)
    await page.goto('/company-setup')

    // Real periods from the database — this table used to be twelve rows
    // derived from fiscalYearStart, labelling any past month "Closed".
    await expect(page.getByText('Accounting Periods')).toBeVisible()
    const firstClose = page.getByRole('button', { name: 'Close', exact: true }).first()
    await expect(firstClose).toBeVisible()

    await firstClose.click()

    // The confirm step leads with the pre-close checklist, not a bare
    // "are you sure" — closing is what starts refusing posts in the period.
    await expect(page.getByText('Unposted journal entries')).toBeVisible()
    await page.getByRole('button', { name: 'Close period' }).click()

    // Row flips: a closed period offers Reopen instead of Close.
    const reopen = page.getByRole('button', { name: 'Reopen', exact: true }).first()
    await expect(reopen).toBeVisible()

    await reopen.click()
    await page.getByRole('button', { name: 'Reopen period' }).click()
    await expect(page.getByRole('button', { name: 'Close', exact: true }).first()).toBeVisible()
  })
})

import { test, expect } from '@playwright/test'
import { login } from './helpers'

/**
 * Fiscal-year close, read-only.
 *
 * Deliberately stops short of posting the closing entry: doing so needs all
 * twelve months closed, which would leave the shared fixture with no open
 * period for period-close.spec to close, plus a closing journal entry every
 * later spec would have to account for. The close mechanics — the roll-up
 * maths, the guards, reopen — are covered against a real database in
 * lib/__tests__/integration/fiscal-year-close.int.test.ts.
 */
test.describe('Fiscal year close', () => {
  test('shows the year, its figures, and why it cannot close yet', async ({ page }) => {
    await login(page)
    await page.goto('/company-setup')

    await expect(page.getByText('Fiscal Year Close')).toBeVisible()

    // Real numbers from the ledger, not a placeholder.
    await expect(page.getByText('Revenue', { exact: true })).toBeVisible()
    await expect(page.getByText(/Net (income|loss)/)).toBeVisible()

    // The seeded company has open months, so the close is blocked and says so.
    await expect(page.getByText(/Close every month of the year first/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Close fiscal year' })).toBeDisabled()
  })
})

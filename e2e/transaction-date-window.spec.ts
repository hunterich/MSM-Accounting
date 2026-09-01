import { test, expect } from '@playwright/test'
import { login } from './helpers'

/**
 * Transaction-date restriction, end to end: configure it in Settings, then see
 * the journal form react to a date outside it.
 *
 * Restores the policy at the end, so this runs in any order alongside the other
 * specs and can be run twice without a re-seed.
 */
test.describe('Transaction-date window', () => {
  test('warns on the journal form once a window is configured, and clears when disabled', async ({
    page,
  }) => {
    // A failed save shows window.alert, which Playwright auto-dismisses — so
    // without this the test would fail later with no sign of the real cause.
    const alerts: string[] = []
    page.on('dialog', (d) => { alerts.push(d.message()); void d.dismiss() })

    await login(page)
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Restrictions' }).click()

    const enable = page.getByRole('checkbox', { name: 'Restrict transaction dates' })
    await expect(enable).toBeVisible()

    try {
      await enable.check()
      // Nothing older than 5 days, nothing later than today.
      await page.getByLabel('Days before today').fill('5')
      await page.getByLabel('Days after today').fill('0')
      await page.getByLabel('When a date is outside').selectOption('WARN')
      await page.getByRole('button', { name: 'Save Changes' }).click()
      await expect.poll(() => alerts).toEqual([])

      // Wait for the save to land before navigating. Without this the test was
      // flaky in a way that looked like a broken banner: `page.goto` aborts
      // in-flight requests, so the PUT never reached the server and the journal
      // page loaded with no policy at all. Polling the API also proves the save
      // wrote the field, which a screen that keeps its own local state cannot.
      await expect
        .poll(async () => {
          const res = await page.request.get('http://localhost:3100/api/v1/organization/settings')
          const body = await res.json()
          return (body.data ?? body).transactionDatePolicy
        })
        .toMatchObject({ enabled: true, mode: 'WARN', daysBefore: 5, daysAfter: 0 })

      await page.goto('/gl/journals/new')
      const dateField = page.locator('input[name="date"]')
      await expect(dateField).toBeVisible()

      // Today is inside the window, so nothing shows.
      const banner = page.getByTestId('transaction-date-banner')
      await expect(banner).toHaveCount(0)

      // A year back is well outside it.
      const longAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)
      await dateField.fill(longAgo)
      await expect(banner).toContainText('in the past')
      await expect(banner).toContainText('You can still save')
      await expect(banner).toHaveAttribute('data-mode', 'WARN')

      // Back inside the window and the warning goes away.
      await dateField.fill(new Date().toISOString().slice(0, 10))
      await expect(banner).toHaveCount(0)
    } finally {
      await page.goto('/settings')
      await page.getByRole('button', { name: 'Restrictions' }).click()
      await page.getByRole('checkbox', { name: 'Restrict transaction dates' }).uncheck()
      await page.getByRole('button', { name: 'Save Changes' }).click()
    }
  })
})

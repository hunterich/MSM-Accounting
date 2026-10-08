import { test, expect } from '@playwright/test'

test('release board remembers dismissal per user and can reopen on mobile', async ({ page, context }) => {
  let userId = 'updates-user-one'
  await context.route('**/api/v1/**', async route => {
    const data = route.request().url().includes('/auth/me') ? {
      user: { id: userId, fullName: 'Update Preview', email: 'preview@local.invalid' },
      org: { id: 'updates-org', name: 'Preview Company', costingMethod: 'FIFO' },
      role: { type: 'ADMIN', permissions: [] },
      memberships: [{ orgId: 'updates-org', name: 'Preview Company', roleType: 'ADMIN' }],
    } : {}
    await route.fulfill({ json: data })
  })
  await page.goto('/403?org=updates-org')
  const board = page.getByRole('dialog', { name: 'What’s new' })
  await expect(board).toBeVisible()
  await board.getByRole('button', { name: 'Close', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'What’s new' })).toBeVisible()
  await expect(board).not.toBeVisible()
  await page.getByRole('button', { name: 'What’s new' }).click()
  await expect(board).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(board).not.toBeVisible()
  userId = 'updates-user-two'
  await page.reload()
  await expect(board).toBeVisible()
  await board.getByRole('button', { name: 'Got it' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'What’s new' }).click()
  await expect(board).toBeVisible()
  const bounds = await board.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.width).toBeLessThanOrEqual(390)
})

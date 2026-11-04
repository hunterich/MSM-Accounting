import { expect, test } from '@playwright/test'
import { accountingCompany, cleanupAccountingCompany, db } from './accounting-helpers'

test.setTimeout(120_000)
test.afterEach(async () => { await cleanupAccountingCompany() })
test.afterAll(async () => { await db.$disconnect() })

test('wizard corrects rejected rows before committing the complete file', async ({ page }) => {
  const { orgId } = await accountingCompany(page)
  await page.goto('/tools?tab=migration-wizard')
  await page.getByLabel('Cutover date').fill('2026-01-01')
  await page.getByRole('button', { name: 'Start migration' }).click()
  await page.getByRole('button', { name: 'Skip this step' }).click()
  const batch = await db.migrationBatch.findFirstOrThrow({ where: { organizationId: orgId } })
  const upload = async (csv: string) => {
    await page.locator('input[type=file]').setInputFiles({ name: 'customers.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await page.getByRole('button', { name: 'Next: preview' }).click()
    await page.getByRole('button', { name: 'Stage 2 rows' }).click()
  }
  await upload('name,email\nAlpha,alpha@example.com\nBeta,bad-email')
  await expect(page.getByText(/1 valid rows are staged/)).toBeVisible()
  await expect(page.getByText(/Row 3:/)).toBeVisible()
  let staged = (await db.migrationBatch.findUniqueOrThrow({ where: { id: batch.id } })).stagedData as { customers: Array<{ name: string }> }
  expect(staged.customers.map(c => c.name)).toEqual(['Alpha'])
  await page.getByRole('button', { name: 'Back to mapping' }).click()
  await page.getByRole('button', { name: 'Back to upload' }).click()
  await expect(page.getByRole('button', { name: 'Skip this step' })).toBeDisabled()
  await upload('name,email\nAlpha,alpha@example.com\nBeta,beta@example.com')
  await expect.poll(async () => {
    const data = (await db.migrationBatch.findUniqueOrThrow({ where: { id: batch.id } })).stagedData as { customers: Array<{ name: string }> }
    return data.customers.map(c => c.name)
  }).toEqual(['Alpha', 'Beta'])
  await expect(page.getByRole('button', { name: 'Skip this step' })).toBeEnabled()
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Skip this step' }).click()
  await expect(page.getByText('All checks pass — ready to commit')).toBeVisible()
  await page.getByRole('button', { name: 'Continue to commit' }).click()
  await page.getByRole('button', { name: 'Commit migration' }).click()
  await expect.poll(async () => (await db.migrationBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe('COMMITTED')
  const customers = await db.customer.findMany({ where: { organizationId: orgId, migrationBatchId: batch.id }, orderBy: { name: 'asc' } })
  expect(customers.map(c => [c.name, c.email])).toEqual([['Alpha', 'alpha@example.com'], ['Beta', 'beta@example.com']])
})

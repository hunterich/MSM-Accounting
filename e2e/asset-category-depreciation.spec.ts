import { test, expect } from '@playwright/test'
import { accountingCompany, cleanupAccountingCompany, api, db, expectJournal } from './accounting-helpers'

test.afterEach(async () => { await cleanupAccountingCompany() })
test.afterAll(async () => { await db.$disconnect() })

test('configure category accounts and post depreciation to the chosen ledger accounts', async ({ page }) => {
  const { orgId } = await accountingCompany(page)
  const expense = await db.account.create({ data: {
    organizationId: orgId, code: '5998', name: 'Depreciation expense test',
    type: 'EXPENSE', normalSide: 'DEBIT', isActive: true, isPostable: true,
  } })
  const accumulated = await db.account.create({ data: {
    organizationId: orgId, code: '1998', name: 'Accumulated depreciation test',
    type: 'ASSET', normalSide: 'CREDIT', isActive: true, isPostable: true,
  } })
  const inactive = await db.account.create({ data: {
    organizationId: orgId, code: '5999', name: 'Inactive expense test',
    type: 'EXPENSE', normalSide: 'DEBIT', isActive: false, isPostable: true,
  } })
  const category = await db.assetCategory.create({ data: { organizationId: orgId, name: 'Equipment test' } })
  const asset = await db.asset.create({ data: {
    organizationId: orgId, assetNo: 'ASSET-E2E', name: 'Machine', categoryId: category.id,
    acquisitionDate: new Date('2026-01-01T00:00:00Z'), acquisitionCost: 12000,
    depreciationMethod: 'STRAIGHT_LINE', usefulLifeMonths: 12, salvageValue: 0,
    accumulatedDepreciation: 0, bookValue: 12000, status: 'ACTIVE',
  } })
  const refused = await page.request.post('http://localhost:3100/api/v1/assets/depreciation/run', {
    headers: { 'x-active-org': orgId }, data: { month: 9, year: 2026 },
  })
  expect(refused.status()).toBe(422)
  expect(await db.assetDepreciation.count({ where: { assetId: asset.id } })).toBe(0)

  await page.goto('/assets/categories')
  await page.getByRole('row').filter({ hasText: 'Equipment test' }).locator('button').first().click()
  await expect(page.getByLabel('Depreciation expense account').locator(`option[value="${inactive.id}"]`)).toHaveCount(0)
  await expect(page.getByLabel('Depreciation expense account').locator(`option[value="${accumulated.id}"]`)).toHaveCount(0)
  await page.getByLabel('Depreciation expense account').selectOption(expense.id)
  await page.getByLabel('Accumulated depreciation account').selectOption(accumulated.id)
  const categoryUrl = '**/api/v1/asset-categories/*'
  await page.route(categoryUrl, async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 500, json: { error: 'Save failed' } })
    else await route.fallback()
  })
  await page.getByRole('button', { name: 'Update Category' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('Depreciation expense account')).toHaveValue(expense.id)
  await page.unroute(categoryUrl)
  await page.getByRole('button', { name: 'Update Category' }).click()
  await expect(page.getByText('Edit Asset Category')).not.toBeVisible()
  const saved = await db.assetCategory.findUniqueOrThrow({ where: { id: category.id } })
  expect([saved.depExpenseAccountId, saved.accumDepAccountId]).toEqual([expense.id, accumulated.id])

  await page.getByRole('row').filter({ hasText: 'Equipment test' }).locator('button').first().click()
  await expect(page.getByLabel('Depreciation expense account')).toHaveValue(expense.id)
  await expect(page.getByLabel('Accumulated depreciation account')).toHaveValue(accumulated.id)
  await page.getByRole('button', { name: 'Cancel' }).click()

  const run = await api(page, '/assets/depreciation/run', { month: 9, year: 2026 }, 'POST')
  expect(run.assetsProcessed).toBe(1)
  const entry = await db.assetDepreciation.findFirstOrThrow({ where: { assetId: asset.id } })
  expect(entry.journalEntryId).toBeTruthy()
  await expectJournal(orgId, entry.journalEntryId!, [['5998', 1000, 0], ['1998', 0, 1000]])

  await page.getByRole('button', { name: 'New Category' }).click()
  await page.getByPlaceholder('e.g. Office Equipment').fill('New equipment test')
  await page.getByLabel('Depreciation expense account').selectOption(expense.id)
  await page.getByLabel('Accumulated depreciation account').selectOption(accumulated.id)
  await page.getByRole('button', { name: 'Save Category' }).click()
  await expect(page.getByText('New Asset Category')).not.toBeVisible()
  const created = await db.assetCategory.findFirstOrThrow({ where: { organizationId: orgId, name: 'New equipment test' } })
  expect([created.depExpenseAccountId, created.accumDepAccountId]).toEqual([expense.id, accumulated.id])
})

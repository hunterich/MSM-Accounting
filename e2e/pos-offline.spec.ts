import { test, expect } from '@playwright/test'
import { cleanupAccountingCompany, db } from './accounting-helpers'
import { stockedTill, checkout, expectTillSale } from './pos-accounting-helpers'

test.setTimeout(120_000)
test.afterEach(cleanupAccountingCompany)
test.afterAll(async () => { await db.$disconnect() })

test('offline shift and cash sale persist, reconnect once, and reconcile the database', async ({ page, context }) => {
  const { orgId, batchId } = await stockedTill(page)
  await context.setOffline(true)
  await page.locator('input[type="number"]').fill('0')
  await page.getByRole('button', { name: 'Buka shift', exact: true }).click()
  await checkout(page)
  expect(await db.posSale.count({ where: { organizationId: orgId } })).toBe(0)
  await page.getByRole('button', { name: 'Transaksi baru' }).click()
  await expect.poll(() => page.evaluate(async () => {
    // @ts-expect-error Browser/Vite module URL.
    const { db } = await import('/src/pos/offline/db.ts')
    return db.outbox.where('status').equals('pending').count()
  })).toBe(2)
  await context.setOffline(false)
  await expect.poll(() => db.posSale.count({ where: { organizationId: orgId } }), { timeout: 30000 }).toBe(1)
  await expect.poll(() => page.evaluate(async () => {
    // @ts-expect-error Browser/Vite module URL.
    const { db } = await import('/src/pos/offline/db.ts')
    return db.outbox.where('status').equals('pending').count()
  })).toBe(0)
  await expectTillSale(orgId, batchId)
  await page.reload()
  await expect(page.getByPlaceholder('Pindai / cari barang')).toBeVisible()
  await expectTillSale(orgId, batchId)
})

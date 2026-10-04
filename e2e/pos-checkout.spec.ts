import { test, expect } from '@playwright/test'
import { api, cleanupAccountingCompany, db, DATE, expectJournal } from './accounting-helpers'
import { stockedTill, checkout, expectTillSale } from './pos-accounting-helpers'

test.setTimeout(120_000)
test.afterEach(cleanupAccountingCompany)
test.afterAll(async () => { await db.$disconnect() })

test('stocked POS checkout, replay and shift close reconcile cash, tax, COGS and stock', async ({ page }) => {
  const { orgId, register, item, batchId } = await stockedTill(page)
  await page.locator('input[type="number"]').fill('0')
  await page.getByRole('button', { name: 'Buka shift', exact: true }).click()
  await checkout(page)
  const sale = await expectTillSale(orgId, batchId)
  const replay = await api(page, '/pos/sales', { clientSaleId: sale.clientSaleId, registerId: register.id, shiftId: sale.shiftId,
    lines: [{ itemId: item.id, description: item.name, quantity: 1, price: 2220, discountPct: 0 }],
    tenders: [{ method: 'CASH', amount: 5000 }] }, 'POST')
  expect(replay.posSaleId).toBe(sale.id)
  await expectTillSale(orgId, batchId)
  const closed = await api(page, `/pos/shifts/${sale.shiftId}/close`, { countedCash: 2220 }, 'POST')
  expect(closed).toMatchObject({ status: 'CLOSED', expectedCash: 2220, cashVariance: 0, zReport: { saleCount: 1, totalSales: 2220, cashCollected: 2220 } })
})

test('back-office refund of a paid POS sale credits cash and void restores cash without changing stock', async ({ page }) => {
  const { orgId, customer, register, batchId } = await stockedTill(page)
  await page.locator('input[type="number"]').fill('0')
  await page.getByRole('button', { name: 'Buka shift', exact: true }).click()
  await checkout(page)
  const sale = await expectTillSale(orgId, batchId)
  const note = await api(page, '/credit-notes', { customerId: customer.id, sourceInvoiceId: sale.salesInvoiceId,
    date: DATE, settlementType: 'REFUND', settlementAccountId: register.cashAccountId,
    amount: 2220, taxAmount: 220, applyTax: true }, 'POST')
  await api(page, `/credit-notes/${note.id}`, { status: 'APPLIED' }, 'PUT')
  const saved = await db.creditNote.findUniqueOrThrow({ where: { id: note.id } })
  await expectJournal(orgId, saved.journalEntryId!, [['5-2000', 2000, 0], ['2-1100', 220, 0], ['1-1000', 0, 2220]])
  await api(page, `/credit-notes/${note.id}`, { status: 'APPLIED' }, 'PUT')
  expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(5)
  await page.goto('/ar/credits')
  const row = page.getByRole('row').filter({ hasText: saved.number })
  page.once('dialog', d => d.accept())
  const response = page.waitForResponse(r => r.url().endsWith(`/credit-notes/${note.id}/void`) && r.request().method() === 'POST')
  await row.getByRole('button', { name: 'Void', exact: true }).click()
  const result = await response
  expect(result.ok(), await result.text()).toBeTruthy()
  const reversal = await db.journalEntry.findFirstOrThrow({ where: { organizationId: orgId, source: 'REVERSAL' } })
  await expectJournal(orgId, reversal.id, [['5-2000', 0, 2000], ['2-1100', 0, 220], ['1-1000', 2220, 0]])
  expect(Number((await db.stockBatch.findUniqueOrThrow({ where: { id: batchId } })).qtyOnHand)).toBe(9)
  expect((await db.salesInvoice.findUniqueOrThrow({ where: { id: sale.salesInvoiceId } })).status).toBe('PAID')
})

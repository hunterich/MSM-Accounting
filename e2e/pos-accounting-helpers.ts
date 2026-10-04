import { expect, type Page } from '@playwright/test'
import { accountingCompany, db, expectJournal } from './accounting-helpers'
import { receiveBatch } from '../lib/pos/batch-stock-in'

export async function stockedTill(page: Page) {
  const company = await accountingCompany(page)
  const { orgId, item, customer } = company
  await db.customer.update({ where: { id: customer.id }, data: { code: 'WALK-IN' } })
  await db.item.update({ where: { id: item.id }, data: { sellingPrice: 2220, requiresBatchTracking: true } })
  const cash = await db.account.findFirstOrThrow({ where: { organizationId: orgId, code: '1-1000' } })
  const register = await db.posRegister.create({ data: { organizationId: orgId, code: 'QA-TILL', name: 'QA Till', cashAccountId: cash.id } })
  const batchId = await db.$transaction(tx => receiveBatch(tx, orgId, {
    itemId: item.id, warehouseId: null, batchNumber: 'QA-STOCK', expiryDate: new Date('2099-12-31'),
    qty: 10, unitCost: 1000, date: new Date('2026-09-15'),
  }))
  await page.goto('/pos.html')
  await expect(page.getByRole('heading', { name: 'Buka shift' })).toBeVisible()
  await page.locator('select').selectOption(register.id)
  await expect.poll(() => page.evaluate(async () => {
    // @ts-expect-error This is a browser/Vite module URL, not a Node import.
    const { db } = await import('/src/pos/offline/db.ts')
    const catalog = await db.catalog.get('current')
    const registers = await db.registers.get('current')
    return Boolean(catalog?.rows.some((r: { sku: string }) => r.sku === 'JOURNEY-1') && registers?.rows.length)
  })).toBe(true)
  return { ...company, register, batchId }
}

export async function checkout(page: Page) {
  await page.getByPlaceholder('Pindai / cari barang').fill('Journey Widget')
  await page.getByRole('button', { name: /Journey Widget/ }).first().click()
  await page.getByRole('button', { name: /Bayar/ }).click()
  await page.getByLabel('Uang diterima').fill('5000')
  await page.getByRole('button', { name: 'Selesaikan' }).click()
  await expect(page.getByRole('button', { name: 'Transaksi baru' })).toBeVisible()
}

export async function expectTillSale(orgId: string, batchId: string) {
  const sales = await db.posSale.findMany({ where: { organizationId: orgId } })
  expect(sales).toHaveLength(1)
  const sale = sales[0]
  const invoice = await db.salesInvoice.findUniqueOrThrow({ where: { id: sale.salesInvoiceId }, include: { lines: true } })
  expect(invoice.status).toBe('PAID')
  expect([Number(invoice.taxAmount), Number(invoice.totalAmount)]).toEqual([220, 2220])
  expect(Number(invoice.lines[0].cogsAmount)).toBe(1000)
  const entries = await db.journalEntry.findMany({ where: { organizationId: orgId } })
  expect(entries).toHaveLength(4)
  const revenue = entries.find(e => e.memo?.startsWith('Sales recognition:'))!
  const cogs = entries.find(e => e.memo?.startsWith('COGS auto-post:'))!
  const receipt = await db.aRPayment.findFirstOrThrow({ where: { organizationId: orgId } })
  await expectJournal(orgId, revenue.id, [['1-1200', 2220, 0], ['4-1000', 0, 2000], ['2-1100', 0, 220]])
  await expectJournal(orgId, cogs.id, [['5-1000', 1000, 0], ['1-1300', 0, 1000]])
  await expectJournal(orgId, receipt.journalEntryId!, [['1-1000', 2220, 0], ['1-1200', 0, 2220]])
  expect(Number((await db.stockBatch.findUniqueOrThrow({ where: { id: batchId } })).qtyOnHand)).toBe(9)
  const stock = await db.inventoryLedgerEntry.findMany({ where: { organizationId: orgId } })
  expect(stock.reduce((s, l) => s + Number(l.qtyIn) - Number(l.qtyOut), 0)).toBe(9)
  expect(stock.reduce((s, l) => s + Number(l.valueChange), 0)).toBe(9000)
  return sale
}

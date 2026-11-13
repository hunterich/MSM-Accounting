import { test, expect } from '@playwright/test'
import { accountingCompany, cleanupAccountingCompany, db } from './accounting-helpers'
import { addCostLayer } from '../lib/inventory-costing'
import { loadOrgAccountDefaults, resolveAccountDefaultId } from '../lib/account-defaults'

test.afterAll(() => db.$disconnect())
test.afterEach(cleanupAccountingCompany)
test('discounted partial return creates a matching applied credit note', async ({ page }) => {
  const { orgId, customer, item } = await accountingCompany(page)
  await db.$transaction(async tx => {
    const accounts = await tx.account.findMany({ where: { organizationId: orgId, isActive: true } })
    const inventoryAccountId = resolveAccountDefaultId(accounts, await loadOrgAccountDefaults(tx, orgId), 'inventoryAsset')
    await addCostLayer(tx, orgId, item.id, null, 5, 1000, 'PURCHASE', 'discount-qa', new Date('2026-01-01'), undefined, inventoryAccountId)
  })
  const invoice = await db.salesInvoice.create({ data: { organizationId: orgId, customerId: customer.id,
    number: 'INV-DISCOUNT', issueDate: new Date('2026-01-01'), status: 'DRAFT', subtotal: 450000, discountAmount: 45000,
    taxEnabled: true, taxInclusive: false, taxRate: 11, taxAmount: 44550, totalAmount: 449550,
    lines: { create: { lineNo: 1, itemId: item.id, description: 'Discounted widget', quantity: 5, price: 100000, discountPct: 10, lineSubtotal: 450000 } } } })
  const sent = await page.request.put(`http://localhost:3100/api/v1/invoices/${invoice.id}`, { data: { status: 'SENT' } })
  expect(sent.ok(), await sent.text()).toBeTruthy()
  await page.goto('/ar/credits')
  await page.locator('.workbench-doc-tab-new').click()
  await page.locator('main input[type="date"]:visible').first().fill('2026-09-15')
  for (const [placeholder, label] of [['Select Customer...', 'Journey Customer'], ['Select Invoice...', 'INV-DISCOUNT']]) {
    const control = page.locator('div.cursor-pointer', { hasText: placeholder }).first()
    await control.click()
    await control.locator('xpath=following-sibling::div[1]').locator('div.cursor-pointer', { hasText: label }).first().click()
  }
  await page.getByRole('row').filter({ hasText: 'Discounted widget' }).locator('input[type="number"]').fill('2')
  await expect(page.locator('.panel-summary-total .value')).toHaveText('Rp 179.820,00')
  const save = page.waitForResponse(r => r.url().endsWith('/api/v1/sales-returns') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Save & Create Credit Note' }).click()
  const response = await save
  expect(response.ok(), await response.text()).toBeTruthy()
  const result = await response.json(), returnId = result.id ?? result.data?.id
  await expect(page.getByRole('heading', { name: 'Credit Note' })).toBeVisible()
  const settlement = page.locator('main select').filter({ has: page.locator('option', { hasText: 'INV-DISCOUNT' }) }).first()
  await settlement.selectOption(invoice.id)
  const noteSave = page.waitForResponse(r => r.url().endsWith('/api/v1/credit-notes') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Save & Apply' }).click()
  const noteResponse = await noteSave
  expect(noteResponse.ok(), await noteResponse.text()).toBeTruthy()
  await expect.poll(async () => (await db.creditNote.findFirst({ where: { salesReturnId: returnId } }))?.status).toBe('APPLIED')
  const ret = await db.salesReturn.findUniqueOrThrow({ where: { id: returnId }, include: { lines: true } })
  const note = await db.creditNote.findFirstOrThrow({ where: { salesReturnId: returnId }, include: { journalEntry: { include: { lines: true } } } })
  expect([Number(ret.subtotal), Number(ret.taxAmount), Number(ret.totalAmount), Number(ret.lines[0].lineTotal)]).toEqual([162000, 17820, 179820, 162000])
  expect([Number(note.amount), Number(note.taxAmount)]).toEqual([179820, 17820])
  expect(note.journalEntry?.lines.map(line => [Number(line.debit), Number(line.credit)]).sort()).toEqual([[0, 179820], [17820, 0], [162000, 0]].sort())
})

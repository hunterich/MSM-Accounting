import { test, expect } from '@playwright/test'
import { accountingCompany, cleanupAccountingCompany, api, DATE, db, expectJournal } from './accounting-helpers'

test.setTimeout(120_000)
test.afterEach(cleanupAccountingCompany)
test.afterAll(async () => { await db.$disconnect() })

for (const path of ['/ap/pos', '/ap/receiving']) {
  test(`partial receipts through ${path} omit unreceived lines and post exact inventory/GRIR`, async ({ page }) => {
    const { orgId, vendor, item } = await accountingCompany(page)
    const second = await db.item.create({ data: { organizationId: orgId, sku: 'RECEIPT-2', name: 'Second Widget', costPrice: 1000 } })
    const po = await api(page, '/purchase-orders', { vendorId: vendor.id, date: DATE, status: 'APPROVED', taxable: false,
      subtotal: 3500, totalAmount: 3500, lines: [
        { itemId: item.id, description: item.name, quantity: 1.5, price: 1000, lineTotal: 1500 },
        { itemId: second.id, description: second.name, quantity: 2, price: 1000, lineTotal: 2000 },
      ] }, 'POST')
    await page.goto(path)
    await page.getByRole('row').filter({ hasText: po.number }).getByRole('button', { name: 'Receive', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Receive Goods' })
    const firstQty = dialog.getByLabel(`Quantity to receive: ${item.name}`)
    const secondQty = dialog.getByLabel(`Quantity to receive: ${second.name}`)
    const confirm = dialog.getByRole('button', { name: 'Confirm Receipt' })
    await firstQty.fill('0')
    await secondQty.fill('0')
    await expect(confirm).toBeDisabled()
    await firstQty.fill('-1')
    await expect(confirm).toBeDisabled()
    await firstQty.fill('2')
    await expect(confirm).toBeDisabled()
    expect(await db.bill.count({ where: { organizationId: orgId } })).toBe(0)
    expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(0)

    await firstQty.fill('0.5')
    await expect(confirm).toBeEnabled()
    const firstResponse = page.waitForResponse(r => r.url().endsWith(`/purchase-orders/${po.id}/receive`) && r.request().method() === 'POST')
    await confirm.click()
    const response = await firstResponse
    expect(response.ok(), await response.text()).toBeTruthy()
    expect(response.request().postDataJSON().lines).toHaveLength(1)
    await expect(dialog).not.toBeVisible()
    const firstBill = await db.bill.findFirstOrThrow({ where: { organizationId: orgId }, include: { lines: true } })
    expect(firstBill.lines).toHaveLength(1)
    expect(Number(firstBill.lines[0].quantity)).toBe(0.5)
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('PARTIAL_RECEIVED')
    const firstJournal = await db.journalEntry.findFirstOrThrow({ where: { organizationId: orgId } })
    await expectJournal(orgId, firstJournal.id, [['1-1300', 500, 0], ['2150', 0, 500]])

    await page.goto(path)
    await page.getByRole('row').filter({ hasText: po.number }).getByRole('button', { name: 'Receive', exact: true }).click()
    await expect(firstQty).toHaveValue('1')
    await expect(secondQty).toHaveValue('2')
    const secondResponse = page.waitForResponse(r => r.url().endsWith(`/purchase-orders/${po.id}/receive`) && r.request().method() === 'POST')
    await confirm.click()
    expect((await secondResponse).ok()).toBeTruthy()
    await expect(dialog).not.toBeVisible()
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('CLOSED')
    const journals = await db.journalEntry.findMany({ where: { organizationId: orgId, id: { not: firstJournal.id } } })
    expect(journals).toHaveLength(1)
    await expectJournal(orgId, journals[0].id, [['1-1300', 3000, 0], ['2150', 0, 3000]])
    const stock = await db.inventoryLedgerEntry.findMany({ where: { organizationId: orgId } })
    expect(stock).toHaveLength(3)
    expect(stock.filter(l => l.itemId === item.id).reduce((sum, l) => sum + Number(l.qtyIn), 0)).toBe(1.5)
    expect(stock.filter(l => l.itemId === second.id).reduce((sum, l) => sum + Number(l.qtyIn), 0)).toBe(2)
    expect(stock.reduce((sum, l) => sum + Number(l.valueChange), 0)).toBe(3500)
  })
}

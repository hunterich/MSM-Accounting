import { test, expect } from '@playwright/test'
import { accountingCompany, cleanupAccountingCompany, api, DATE, db } from './accounting-helpers'

test.setTimeout(180_000)
test.afterEach(cleanupAccountingCompany)
test.afterAll(async () => { await db.$disconnect() })

async function balance(orgId: string, code: string) {
  const lines = await db.journalLine.findMany({ where: { account: { organizationId: orgId, code }, entry: { status: 'POSTED' } } })
  return lines.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0)
}
async function snapshot(orgId: string) {
  const where = { organizationId: orgId }, orderBy = { id: 'asc' as const }
  return {
    lots: await db.inventoryLot.findMany({ where, orderBy }),
    ledger: await db.inventoryLedgerEntry.findMany({ where, orderBy, include: { lotDraws: { orderBy } } }),
    journals: await db.journalEntry.findMany({ where, orderBy, include: { lines: { orderBy } } }),
    bills: await db.bill.findMany({ where, orderBy, include: { lines: { orderBy } } }),
    orders: await db.purchaseOrder.findMany({ where, orderBy, include: { lines: { orderBy } } }),
    invoices: await db.salesInvoice.findMany({ where, orderBy, include: { lines: { orderBy } } }),
  }
}
for (const switchMethod of [false, true]) {
  test(`${switchMethod ? 'FIFO to WA' : 'WA'}: unequal PO receipts through the dialog, 4/4/2 sales and reversals preserve exact book value`, async ({ page }) => {
    const { orgId, vendor, customer, item } = await accountingCompany(page)
    await db.organization.update({ where: { id: orgId }, data: { costingMethod: switchMethod ? 'FIFO' : 'WEIGHTED_AVERAGE' } })
    const receiptIds: string[] = [], poIds: string[] = [], invoiceIds: string[] = []
    for (const price of [1000, 1200]) {
      const po = await api(page, '/purchase-orders', { vendorId: vendor.id, date: DATE, status: 'APPROVED', taxable: false,
        subtotal: 5 * price, totalAmount: 5 * price, lines: [{ itemId: item.id, description: item.name, quantity: 5, price, lineTotal: 5 * price }] }, 'POST')
      poIds.push(po.id)
      await page.goto('/ap/receiving')
      await page.getByRole('row').filter({ hasText: po.number }).getByRole('button', { name: 'Receive', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Receive Goods' })
      const received = page.waitForResponse(r => r.url().endsWith(`/purchase-orders/${po.id}/receive`) && r.request().method() === 'POST')
      await dialog.getByRole('button', { name: 'Confirm Receipt' }).click()
      const response = await received
      expect(response.status(), await response.text()).toBe(201)
      await expect(dialog).not.toBeVisible()
      receiptIds.push((await db.bill.findFirstOrThrow({ where: { organizationId: orgId, poId: po.id } })).id)
    }
    const originalLots = await db.inventoryLot.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' } })
    expect(originalLots.map(lot => Number(lot.unitCost)).sort((a, b) => a - b)).toEqual([1000, 1200])
    const today = new Date().toISOString().slice(0, 10)
    if (switchMethod) {
      const result = await api(page, '/inventory/recalculate-costing', { newMethod: 'WEIGHTED_AVERAGE', effectiveDate: today }, 'POST')
      expect(result.totalValueChange).toBe(0)
      expect(result.journalEntryId).toBeNull()
      expect((await db.inventoryLot.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' } })).map(lot => [lot.id, Number(lot.unitCost)]))
        .toEqual(originalLots.map(lot => [lot.id, Number(lot.unitCost)]))
    }
    for (const [quantity, remaining, cogs] of [[4, 6600, 4400], [4, 2200, 8800], [2, 0, 11000]]) {
      const invoice = await api(page, '/invoices', { customerId: customer.id, issueDate: today,
        tax: { enabled: false, inclusive: false, rate: 0 }, lines: [{ itemId: item.id, description: item.name, quantity, price: 3000 }] }, 'POST')
      invoiceIds.push(invoice.id)
      await api(page, `/invoices/${invoice.id}`, { status: 'SENT' }, 'PUT')
      expect(await balance(orgId, '1-1300')).toBe(remaining)
      expect(await balance(orgId, '5-1000')).toBe(cogs)
      const lots = await db.inventoryLot.findMany({ where: { organizationId: orgId } })
      expect(lots.reduce((sum, lot) => sum + Number(lot.carryingValue), 0)).toBe(remaining)
      const valuation = await api(page, '/inventory/valuation')
      expect(valuation.summary.totalValue).toBe(remaining)
      if (quantity === 4 && remaining === 6600) {
        const before = await snapshot(orgId)
        const refused = await page.request.post(`http://localhost:3100/api/v1/bills/${receiptIds[1]}/unreceive`, { data: {} })
        expect(refused.status()).toBe(422)
        expect(await snapshot(orgId)).toEqual(before)
      }
    }
    expect(await balance(orgId, '2150')).toBe(-11000)
    expect(await balance(orgId, '2-1000')).toBe(0)
    expect(await balance(orgId, '1-1200')).toBe(30000)
    for (const id of invoiceIds.reverse()) await api(page, `/invoices/${id}/void`, {}, 'POST')
    expect(await balance(orgId, '5-1000')).toBe(0)
    expect(await balance(orgId, '1-1200')).toBe(0)
    expect(await balance(orgId, '1-1300')).toBe(11000)
    const restored = await db.inventoryLot.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' } })
    expect(restored.map(lot => [lot.id, Number(lot.unitCost), Number(lot.qtyBalance)]))
      .toEqual(originalLots.map(lot => [lot.id, Number(lot.unitCost), Number(lot.qtyBalance)]))
    for (const id of receiptIds.reverse()) await api(page, `/bills/${id}/unreceive`, {}, 'POST')
    expect(await db.inventoryLot.count({ where: { organizationId: orgId } })).toBe(0)
    const ledger = await db.inventoryLedgerEntry.findMany({ where: { organizationId: orgId } })
    expect(ledger.reduce((sum, row) => sum + Number(row.qtyIn) - Number(row.qtyOut), 0)).toBe(0)
    expect(ledger.reduce((sum, row) => sum + Number(row.valueChange), 0)).toBe(0)
    expect(await balance(orgId, '1-1300')).toBe(0)
    expect(await balance(orgId, '2150')).toBe(0)
    expect((await db.purchaseOrder.findMany({ where: { id: { in: poIds } } })).every(po => po.status === 'APPROVED')).toBe(true)
    const trial = await api(page, `/reports/gl?type=trial-balance&asOfDate=${today}`)
    expect(trial.summary.endingDebit).toBe(trial.summary.endingCredit)
  })
}

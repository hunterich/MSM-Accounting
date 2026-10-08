import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { hash } from 'bcryptjs'
import { login } from './helpers'
import { accountingCompany, cleanupAccountingCompany, api, choose, DATE, db, expectJournal, payThroughForm } from './accounting-helpers'

test.setTimeout(120_000)
test.use({ actionTimeout: 15_000 })
test.afterEach(cleanupAccountingCompany)
test.afterAll(async () => { await db.$disconnect() })

async function purchase(page: Page, vendorId: string, itemId: string, quantity = 2) {
  return api(page, '/bills', { vendorId, vendorInvoiceNo: randomUUID(), issueDate: DATE,
    status: 'OPEN', taxable: false, taxRate: 0, subtotal: quantity * 1000, totalAmount: quantity * 1000,
    lines: [{ itemId, description: 'Journey Widget', quantity, price: 1000, lineTotal: quantity * 1000 }] }, 'POST')
}

async function sell(page: Page, customerId: string, itemId: string) {
  const invoice = await api(page, '/invoices', { customerId, issueDate: DATE, tax: { enabled: false, inclusive: false, rate: 0 },
    lines: [{ itemId, description: 'Journey Widget', quantity: 1, price: 2000 }] }, 'POST')
  await api(page, `/invoices/${invoice.id}`, { status: 'SENT' }, 'PUT')
  return db.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } })
}

async function voidThroughList(page: Page, path: string, number: string, endpoint: string) {
  await page.goto(path)
  const row = page.getByRole('row').filter({ hasText: number })
  const response = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'POST')
  page.once('dialog', d => d.accept())
  await row.getByRole('button', { name: 'Void', exact: true }).click()
  const result = await response
  expect(result.ok(), await result.text()).toBeTruthy()
}

async function expectReversal(orgId: string, originalId: string) {
  const original = await db.journalEntry.findUniqueOrThrow({ where: { id: originalId }, include: { lines: { include: { account: true } } } })
  const reversals = await db.journalEntry.findMany({ where: { organizationId: orgId, source: 'REVERSAL' }, include: { lines: true } })
  expect(reversals).toHaveLength(1)
  await expectJournal(orgId, reversals[0].id, original.lines.map(l => [l.account.code, Number(l.credit), Number(l.debit)]))
}

test('partial PO receipts clear GR/IR in batches and reject over-receipt atomically', async ({ page }) => {
  const { orgId, vendor, item } = await accountingCompany(page)
  const po = await api(page, '/purchase-orders', { vendorId: vendor.id, date: DATE, status: 'APPROVED', subtotal: 5000, totalAmount: 5000,
    lines: [{ itemId: item.id, description: item.name, quantity: 5, price: 1000, lineTotal: 5000 }] }, 'POST')
  const line = await db.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: po.id } })
  for (const qty of [2, 3]) {
    const receipt = await api(page, `/purchase-orders/${po.id}/receive`, { lines: [{ purchaseOrderLineId: line.id, qtyReceived: qty }] }, 'POST')
    const current = await db.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id } })
    expect(Number(current.receivedQty)).toBe(qty === 2 ? 2 : 5)
    const status = (await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status
    expect(status).toBe(qty === 2 ? 'PARTIAL_RECEIVED' : 'CLOSED')
    await api(page, `/bills/${receipt.billId}`, { status: 'OPEN', vendorInvoiceNo: `PARTIAL-${qty}` }, 'PUT')
    const bill = await db.bill.findUniqueOrThrow({ where: { id: receipt.billId } })
    await expectJournal(orgId, bill.journalEntryId!, [['2150', qty * 1000, 0], ['2-1000', 0, qty * 1000]])
  }
  const before = await db.journalEntry.count({ where: { organizationId: orgId } })
  const rejected = await page.request.post(`http://localhost:3100/api/v1/purchase-orders/${po.id}/receive`, {
    data: { lines: [{ purchaseOrderLineId: line.id, qtyReceived: 1 }] },
  })
  expect(rejected.status()).toBe(422)
  expect(await db.bill.count({ where: { organizationId: orgId } })).toBe(2)
  expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(before)
  const stock = await db.inventoryLedgerEntry.findMany({ where: { organizationId: orgId } })
  expect(stock.reduce((sum, l) => sum + Number(l.qtyIn), 0)).toBe(5)
  expect(stock.reduce((sum, l) => sum + Number(l.valueChange), 0)).toBe(5000)
  const report = await api(page, '/reports/gl?type=trial-balance&asOfDate=2099-12-31')
  expect(report.rows.find((r: { accountCode: string }) => r.accountCode === '2150')).toMatchObject({ endingDebit: 0, endingCredit: 0 })
})

for (const kind of ['ap', 'ar'] as const) {
  test(`partial ${kind.toUpperCase()} payment then form settles only the remaining balance; void restores it`, async ({ page }) => {
    const { orgId, vendor, customer, item } = await accountingCompany(page)
    const bill = await purchase(page, vendor.id, item.id)
    const document = kind === 'ap' ? await db.bill.findUniqueOrThrow({ where: { id: bill.id } }) : await sell(page, customer.id, item.id)
    const party = kind === 'ap' ? vendor : customer
    await payThroughForm(page, kind, party.name, kind === 'ap' ? document.number : document.id, DATE, { settlement: 600 })
    const partial = kind === 'ap' ? await db.aPPayment.findFirstOrThrow({ where: { organizationId: orgId } }) : await db.aRPayment.findFirstOrThrow({ where: { organizationId: orgId } })
    const partialPayment = kind === 'ap' ? await db.aPPayment.findUniqueOrThrow({ where: { id: partial.id } }) : await db.aRPayment.findUniqueOrThrow({ where: { id: partial.id } })
    await expectJournal(orgId, partialPayment.journalEntryId!, kind === 'ap' ? [['2-1000', 600, 0], ['1-1000', 0, 600]] : [['1-1000', 600, 0], ['1-1200', 0, 600]])
    const path = kind === 'ap' ? 'bills' : 'invoices'
    expect(await api(page, `/${path}/${document.id}/settlement`)).toMatchObject({ paid: 600, owing: 1400, state: 'PARTIAL' })
    await payThroughForm(page, kind, party.name, kind === 'ap' ? document.number : document.id)
    const payments = kind === 'ap' ? await db.aPPayment.findMany({ where: { organizationId: orgId } }) : await db.aRPayment.findMany({ where: { organizationId: orgId } })
    expect(payments).toHaveLength(2)
    const remainder = payments.find(p => p.id !== partial.id)!
    expect(Number(remainder.totalAmount)).toBe(1400)
    await expectJournal(orgId, remainder.journalEntryId!, kind === 'ap' ? [['2-1000', 1400, 0], ['1-1000', 0, 1400]] : [['1-1000', 1400, 0], ['1-1200', 0, 1400]])
    expect(await api(page, `/${path}/${document.id}/settlement`)).toMatchObject({ paid: 2000, owing: 0, state: 'PAID' })
    await voidThroughList(page, `/${kind}/payments`, remainder.number, `/api/v1/${kind}-payments/${remainder.id}/void`)
    await expectReversal(orgId, remainder.journalEntryId!)
    expect(await api(page, `/${path}/${document.id}/settlement`)).toMatchObject({ paid: 600, owing: 1400, state: 'PARTIAL' })
    const count = await db.journalEntry.count({ where: { organizationId: orgId } })
    const repeat = await page.request.post(`http://localhost:3100/api/v1/${kind}-payments/${remainder.id}/void`, { data: {} })
    expect(repeat.status()).toBe(422)
    expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(count)
  })
}

test('bill void through the UI reverses exact journal lines and stock once', async ({ page }) => {
  const { orgId, vendor, item } = await accountingCompany(page)
  const created = await purchase(page, vendor.id, item.id)
  const bill = await db.bill.findUniqueOrThrow({ where: { id: created.id } })
  await voidThroughList(page, '/ap/bills', bill.number, `/api/v1/bills/${bill.id}/void`)
  expect((await db.bill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe('VOID')
  await expectReversal(orgId, bill.journalEntryId!)
  const stock = await db.inventoryLedgerEntry.findMany({ where: { organizationId: orgId } })
  expect(stock.reduce((sum, l) => sum + Number(l.qtyIn) - Number(l.qtyOut), 0)).toBe(0)
  expect(stock.reduce((sum, l) => sum + Number(l.valueChange), 0)).toBe(0)
  const repeat = await page.request.post(`http://localhost:3100/api/v1/bills/${bill.id}/void`, { data: {} })
  expect(repeat.status()).toBe(422)
  expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(2)
})

test('double submit and response loss after commit cannot duplicate a supplier invoice', async ({ page }) => {
  const { orgId, vendor, item } = await accountingCompany(page)
  await page.goto('/ap/bills/new')
  await choose(page, 'Search & select vendor…', vendor.name)
  await page.getByPlaceholder('e.g. INV/DE/8842').fill('LOST-RESPONSE')
  await page.locator('main input[type="date"]:visible').first().fill(DATE)
  await page.getByPlaceholder('Search SKU or name to add…').fill(item.name)
  await page.getByText(item.name, { exact: true }).click()
  const row = page.getByRole('row').filter({ has: page.getByPlaceholder('Description') })
  await row.locator('input[type="number"]').nth(1).fill('1000')
  let posts = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/v1/bills', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    posts++
    const response = await route.fetch()
    expect(response.status()).toBe(201) // Proves the server committed before losing the response.
    await gate
    await route.abort('failed')
    await page.unroute('**/api/v1/bills')
  })
  const failure = page.waitForEvent('dialog')
  await page.getByRole('button', { name: 'Save & schedule payment', exact: true }).click()
  const saving = page.getByRole('button', { name: /Saving/ })
  await expect(saving).toBeDisabled()
  await saving.evaluate((button: HTMLButtonElement) => button.click())
  await expect.poll(() => db.bill.count({ where: { organizationId: orgId } })).toBe(1)
  release()
  await (await failure).dismiss()
  expect(posts).toBe(1)
  const duplicate = page.waitForEvent('dialog')
  await page.getByRole('button', { name: 'Save & schedule payment', exact: true }).click()
  await (await duplicate).dismiss()
  expect(await db.bill.count({ where: { organizationId: orgId } })).toBe(1)
  expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(1)
  expect(await db.inventoryLedgerEntry.count({ where: { organizationId: orgId } })).toBe(1)
})

test('invoice detail void reverses revenue and COGS and restores stock exactly once', async ({ page }) => {
  const { orgId, vendor, customer, item } = await accountingCompany(page)
  await purchase(page, vendor.id, item.id)
  const invoice = await sell(page, customer.id, item.id)
  await page.goto(`/ar/invoices?invoiceId=${invoice.id}`)
  page.once('dialog', d => d.accept())
  const response = page.waitForResponse(r => r.url().endsWith(`/invoices/${invoice.id}/void`) && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Void', exact: true }).click()
  const result = await response
  expect(result.ok(), await result.text()).toBeTruthy()
  await expect.poll(async () => (await db.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('VOID')
  const reversals = await db.journalEntry.findMany({ where: { organizationId: orgId, source: 'REVERSAL' }, include: { lines: { include: { account: true } } } })
  expect(reversals).toHaveLength(2)
  const revenue = reversals.find(e => e.lines.some(l => l.account.code === '1-1200'))!
  const cogs = reversals.find(e => e.lines.some(l => l.account.code === '5-1000'))!
  await expectJournal(orgId, revenue.id, [['1-1200', 0, 2000], ['4-1000', 2000, 0]])
  await expectJournal(orgId, cogs.id, [['5-1000', 0, 1000], ['1-1300', 1000, 0]])
  const stock = await db.inventoryLedgerEntry.findMany({ where: { organizationId: orgId } })
  expect(stock.reduce((sum, l) => sum + Number(l.qtyIn) - Number(l.qtyOut), 0)).toBe(2)
  expect(stock.reduce((sum, l) => sum + Number(l.valueChange), 0)).toBe(2000)
  const repeat = await page.request.post(`http://localhost:3100/api/v1/invoices/${invoice.id}/void`, { data: {} })
  expect(repeat.status()).toBe(422)
  expect(await db.journalEntry.count({ where: { organizationId: orgId, source: 'REVERSAL' } })).toBe(2)
})

test('tax-inclusive decimal quantities and discounts post independently calculated net and VAT', async ({ page }) => {
  const { orgId, vendor } = await accountingCompany(page)
  const expense = await db.account.findFirstOrThrow({ where: { organizationId: orgId, code: '5-1100' } })
  const bill = await api(page, '/bills', { vendorId: vendor.id, vendorInvoiceNo: 'DECIMAL-VAT', issueDate: DATE,
    status: 'OPEN', taxable: true, taxInclusive: true, taxRate: 11, subtotal: 16132, taxAmount: 1598.67, totalAmount: 16132,
    lines: [
      { accountId: expense.id, description: 'Discounted service', quantity: 1.5, price: 11100, discountPct: 10, lineTotal: 14985 },
      { accountId: expense.id, description: 'Fractional service', quantity: 0.25, price: 4440, lineTotal: 1110 },
      { accountId: expense.id, description: 'Penny rounding', quantity: 1, price: 37, lineTotal: 37 },
    ] }, 'POST')
  const saved = await db.bill.findUniqueOrThrow({ where: { id: bill.id }, include: { lines: true } })
  expect(Number(saved.totalAmount)).toBe(16132)
  expect(saved.lines.map(l => Number(l.quantity))).toEqual([1.5, 0.25, 1])
  await expectJournal(orgId, saved.journalEntryId!, [['5-1100', 14533.33, 0], ['1-1400', 1598.67, 0], ['2-1000', 0, 16132]])
  await page.goto(`/ap/bills/new?billId=${bill.id}`)
  await expect(page.getByPlaceholder('e.g. INV/DE/8842').filter({ visible: true })).toHaveValue('DECIMAL-VAT')
})

test('closed periods and a view-only user reject real posts without database side effects or tenant leaks', async ({ page }) => {
  const { orgId, vendor, item } = await accountingCompany(page)
  const period = await db.accountingPeriod.findFirstOrThrow({ where: { organizationId: orgId, startDate: { lte: new Date(DATE) }, endDate: { gte: new Date(DATE) } } })
  await db.accountingPeriod.update({ where: { id: period.id }, data: { status: 'CLOSED' } })
  const payload = { vendorId: vendor.id, vendorInvoiceNo: 'CLOSED-PERIOD', issueDate: DATE, status: 'OPEN', subtotal: 1000, totalAmount: 1000, lines: [{ itemId: item.id, description: item.name, quantity: 1, price: 1000, lineTotal: 1000 }] }
  const locked = await page.request.post('http://localhost:3100/api/v1/bills', { data: payload })
  expect(locked.status()).toBe(422)
  expect(await db.bill.count({ where: { organizationId: orgId } })).toBe(0)
  expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(0)
  await db.accountingPeriod.update({ where: { id: period.id }, data: { status: 'OPEN' } })
  const role = await db.role.create({ data: { organizationId: orgId, name: 'QA view only', roleType: 'CUSTOM',
    permissions: { create: [{ moduleKey: 'AP_BILLS', canView: true }, { moduleKey: 'DASHBOARD', canView: true }] } } })
  const email = `qa-${randomUUID()}@example.test`
  const user = await db.user.create({ data: { email, fullName: 'QA reader', passwordHash: await hash('qa-reader-password', 10) } })
  await db.userOrganization.create({ data: { userId: user.id, organizationId: orgId, roleId: role.id } })
  try {
    await page.context().clearCookies()
    await page.context().setExtraHTTPHeaders({})
    await login(page, email, 'qa-reader-password')
    await page.context().setExtraHTTPHeaders({ 'x-active-org': orgId })
    await page.goto('/ap/bills')
    const denied = await page.request.post('http://localhost:3100/api/v1/bills', { data: payload })
    expect(denied.status()).toBe(403)
    const other = await db.organization.findFirstOrThrow({ where: { id: { not: orgId } } })
    const cross = await page.request.get('http://localhost:3100/api/v1/bills', { headers: { 'x-active-org': other.id, 'x-org-id': other.id, 'x-role-type': 'ADMIN' } })
    expect(cross.status()).toBe(403)
    expect(await db.bill.count({ where: { organizationId: orgId } })).toBe(0)
    expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(0)
  } finally {
    await db.userOrganization.deleteMany({ where: { userId: user.id } })
    await db.user.delete({ where: { id: user.id } })
  }
})

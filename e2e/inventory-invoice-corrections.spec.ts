import { test, expect, type Page } from '@playwright/test'
import { accountingCompany, cleanupAccountingCompany, api, DATE, db } from './accounting-helpers'

test.setTimeout(120_000)
test.afterEach(cleanupAccountingCompany)
test.afterAll(async () => { await db.$disconnect() })

async function fixture(page: Page, method: 'FIFO' | 'WEIGHTED_AVERAGE' = 'FIFO') {
  const company = await accountingCompany(page)
  const { orgId, vendor, customer, item } = company
  await db.organization.update({ where: { id: orgId }, data: { costingMethod: method } })
  for (const [qty, price] of [[2, 1000], [5, 2000]]) {
    await api(page, '/bills', { vendorId: vendor.id, vendorInvoiceNo: `CORRECTION-STOCK-${price}`, issueDate: DATE, status: 'OPEN', taxable: false,
      taxRate: 0, subtotal: qty * price, totalAmount: qty * price,
      lines: [{ itemId: item.id, description: item.name, quantity: qty, price, lineTotal: qty * price }] }, 'POST')
  }
  // Give distinct FIFO dates; equal-date ordering is stable by lot ID as well.
  const lots = await db.inventoryLot.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'asc' } })
  await db.inventoryLot.update({ where: { id: lots[0].id }, data: { date: new Date('2026-09-13') } })
  await db.inventoryLot.update({ where: { id: lots[1].id }, data: { date: new Date('2026-09-14') } })
  const originalLots = await currentLots(orgId)
  const invoice = await api(page, '/invoices', { customerId: customer.id, issueDate: DATE,
    tax: { enabled: false, inclusive: false, rate: 0 },
    lines: [{ itemId: item.id, description: item.name, quantity: 3, price: 3000 }] }, 'POST')
  await api(page, `/invoices/${invoice.id}`, { status: 'SENT' }, 'PUT')
  const correction = (qty: number) => ({ subtotal: qty * 3000, totalAmount: qty * 3000,
    lines: [{ itemId: item.id, description: item.name, quantity: qty, price: 3000, lineSubtotal: qty * 3000 }] })
  return { ...company, invoice, originalLots, correction }
}
const currentLots = (orgId: string) => db.inventoryLot.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' } })
async function balance(orgId: string, code: string) {
  const lines = await db.journalLine.findMany({ where: { account: { organizationId: orgId, code }, entry: { status: 'POSTED' } } })
  return lines.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0)
}
async function assertBalanced(page: Page) {
  const report = await api(page, `/reports/gl?type=trial-balance&asOfDate=2026-10-09`)
  expect(report.summary.endingDebit).toBeCloseTo(report.summary.endingCredit, 2)
}

test('Sent inventory invoice → two real form corrections → void restores original FIFO lots and ledger', async ({ page }) => {
  const { orgId, invoice, originalLots } = await fixture(page)
  for (const qty of [1, 4]) {
    await page.goto(`/ar/invoices/edit?invoiceId=${invoice.id}`)
    const row = page.getByRole('row').filter({ has: page.getByPlaceholder('Description').filter({ visible: true }) })
    await expect(row.locator('input[type="number"]').nth(0)).toHaveValue(qty === 1 ? '3' : '1')
    await row.locator('input[type="number"]').nth(0).fill(String(qty))
    const saved = page.waitForResponse(r => r.url().endsWith(`/api/v1/invoices/${invoice.id}`) && r.request().method() === 'PUT')
    await page.getByRole('button', { name: 'Save correction', exact: true }).click()
    const response = await saved
    expect(response.ok(), await response.text()).toBeTruthy()
    expect((await api(page, `/invoices/${invoice.id}`)).status).toBe('SENT')
    expect(await balance(orgId, '1-1200')).toBe(qty * 3000)
    expect(await balance(orgId, '5-1000')).toBe(qty === 1 ? 1000 : 6000)
    await page.reload()
  }
  const before = await db.journalEntry.count({ where: { organizationId: orgId } })
  await page.goto(`/ar/invoices?invoiceId=${invoice.id}`)
  page.once('dialog', dialog => dialog.accept())
  const voided = page.waitForResponse(r => r.url().endsWith(`/invoices/${invoice.id}/void`) && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Void', exact: true }).click()
  expect((await voided).status()).toBe(200)
  expect(await currentLots(orgId)).toEqual(originalLots)
  expect(await balance(orgId, '1-1200')).toBe(0)
  expect(await balance(orgId, '5-1000')).toBe(0)
  expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(before + 2)
  await assertBalanced(page)
  const revive = await page.request.put(`http://localhost:3100/api/v1/invoices/${invoice.id}`, { data: { status: 'SENT' } })
  expect(revive.status()).toBe(422)
})

test('failed oversell and historical tracking guards preserve all invoice, journal and stock state', async ({ page }) => {
  const { orgId, invoice, correction } = await fixture(page)
  const before = { lots: await currentLots(orgId), document: await api(page, `/invoices/${invoice.id}`),
    journals: await db.journalEntry.count({ where: { organizationId: orgId } }) }
  const oversell = await page.request.put(`http://localhost:3100/api/v1/invoices/${invoice.id}`, { data: correction(8) })
  expect(oversell.status()).toBe(422)
  expect(await oversell.text()).toContain('Insufficient stock')
  expect(await api(page, `/invoices/${invoice.id}`)).toEqual(before.document)
  expect(await currentLots(orgId)).toEqual(before.lots)
  expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(before.journals)
  await db.salesInvoice.update({ where: { id: invoice.id }, data: { postingTracked: false } })
  const legacy = await page.request.put(`http://localhost:3100/api/v1/invoices/${invoice.id}`, { data: correction(1) })
  expect(legacy.status()).toBe(422)
  expect(await legacy.text()).toContain('historical invoice')
  expect(await currentLots(orgId)).toEqual(before.lots)
  expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(before.journals)
})

test('closed original/repost periods, linked credit notes and returns block a correction without side effects', async ({ page }) => {
  const { orgId, customer, invoice, correction } = await fixture(page)
  const url = `http://localhost:3100/api/v1/invoices/${invoice.id}`
  const beforeLots = await currentLots(orgId)
  const beforeJournals = await db.journalEntry.count({ where: { organizationId: orgId } })
  const period = await db.accountingPeriod.findFirstOrThrow({ where: { organizationId: orgId,
    startDate: { lte: new Date(DATE) }, endDate: { gte: new Date(DATE) } } })
  await db.accountingPeriod.update({ where: { id: period.id }, data: { isLocked: true } })
  const closed = await page.request.put(url, { data: correction(1) })
  expect(closed.status()).toBe(422)
  expect(await closed.text()).toContain('closed/locked')
  await db.accountingPeriod.update({ where: { id: period.id }, data: { isLocked: false } })
  const nextPeriod = await db.accountingPeriod.findFirstOrThrow({ where: { organizationId: orgId,
    startDate: { lte: new Date('2026-10-01') }, endDate: { gte: new Date('2026-10-01') } } })
  await db.accountingPeriod.update({ where: { id: nextPeriod.id }, data: { isLocked: true } })
  const moved = await page.request.put(url, { data: { ...correction(1), issueDate: '2026-10-01' } })
  expect(moved.status()).toBe(422)
  expect(await moved.text()).toContain('closed/locked')
  await db.accountingPeriod.update({ where: { id: nextPeriod.id }, data: { isLocked: false } })
  const note = await api(page, '/credit-notes', { customerId: customer.id, sourceInvoiceId: invoice.id,
    date: DATE, amount: 1000, applyTax: false, settlementType: 'APPLY_TO_INVOICE' }, 'POST')
  expect((await page.request.put(url, { data: correction(1) })).status()).toBe(422)
  await api(page, `/credit-notes/${note.id}`, undefined, 'DELETE')
  const returned = await db.salesReturn.create({ data: { organizationId: orgId, number: 'CORRECTION-RETURN', customerId: customer.id,
    invoiceId: invoice.id, returnDate: new Date(DATE), status: 'DRAFT' } })
  expect((await page.request.put(url, { data: correction(1) })).status()).toBe(422)
  await db.salesReturn.delete({ where: { id: returned.id } })
  expect(await currentLots(orgId)).toEqual(beforeLots)
  expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(beforeJournals)
  expect((await api(page, `/invoices/${invoice.id}`)).totalAmount).toBe('9000')
})

test('Weighted Average limit is visible before Save correction and a refused save changes nothing', async ({ page }) => {
  const { orgId, invoice } = await fixture(page, 'WEIGHTED_AVERAGE')
  await page.goto(`/ar/invoices/edit?invoiceId=${invoice.id}`)
  const notice = page.getByRole('note').filter({ hasText: 'Weighted Average corrections require' })
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Purchases at different costs can prevent a correction')
  await expect(page.getByRole('button', { name: 'Save correction', exact: true })).toBeVisible()
  await page.reload()
  await expect(notice).toBeVisible()
  const before = { doc: await api(page, `/invoices/${invoice.id}`), lots: await currentLots(orgId), journals: await db.journalEntry.count({ where: { organizationId: orgId } }) }
  const row = page.getByRole('row').filter({ has: page.getByPlaceholder('Description').filter({ visible: true }) })
  await row.locator('input[type="number"]').nth(0).fill('1')
  page.once('dialog', dialog => dialog.accept())
  const saved = page.waitForResponse(r => r.url().endsWith(`/api/v1/invoices/${invoice.id}`) && r.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Save correction', exact: true }).click()
  expect((await saved).status()).toBe(422)
  expect(await api(page, `/invoices/${invoice.id}`)).toEqual(before.doc)
  expect(await currentLots(orgId)).toEqual(before.lots)
  expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(before.journals)
  await page.evaluate(() => localStorage.setItem('msm-ui-language', JSON.stringify({ state: { language: 'id' }, version: 0 })))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Simpan koreksi', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save correction', exact: true })).toHaveCount(0)
  await expect(page.getByRole('note').filter({ hasText: 'Koreksi dengan metode Rata-rata Tertimbang' })).toBeVisible()
})

test('voided credit notes preserve their audit history and no longer block correction; active notes still block', async ({ page }) => {
  const { orgId, customer, invoice, correction } = await fixture(page)
  const note = await api(page, '/credit-notes', { customerId: customer.id, sourceInvoiceId: invoice.id,
    date: DATE, amount: 1000, applyTax: false, settlementType: 'APPLY_TO_INVOICE' }, 'POST')
  await api(page, `/credit-notes/${note.id}`, { status: 'APPLIED' }, 'PUT')
  const url = `http://localhost:3100/api/v1/invoices/${invoice.id}`
  expect((await page.request.put(url, { data: correction(1) })).status()).toBe(422)
  await api(page, `/credit-notes/${note.id}/void`, {}, 'POST')
  const noteBefore = await db.creditNote.findUniqueOrThrow({ where: { id: note.id } })
  await api(page, `/invoices/${invoice.id}`, correction(1), 'PUT')
  expect(await db.creditNote.findUniqueOrThrow({ where: { id: note.id } })).toEqual(noteBefore)
  expect((await api(page, `/invoices/${invoice.id}`)).status).toBe('SENT')
  expect(await balance(orgId, '1-1200')).toBe(3000)
  expect(await balance(orgId, '5-1000')).toBe(1000)
  await assertBalanced(page)
})

for (const competing of ['edit', 'void', 'payment'] as const) {
  test(`correction versus ${competing} serializes without double stock or journal reversal`, async ({ page }) => {
    const { orgId, customer, invoice, originalLots, correction } = await fixture(page)
    const url = `http://localhost:3100/api/v1/invoices/${invoice.id}`
    const results = await Promise.all([
      page.request.put(url, { data: correction(1) }),
      competing === 'edit' ? page.request.put(url, { data: correction(4) })
        : competing === 'void' ? page.request.post(`${url}/void`, { data: {} })
          : page.request.post('http://localhost:3100/api/v1/ar-payments', { data: { customerId: customer.id, date: DATE, status: 'COMPLETED', totalAmount: 3000,
              allocations: [{ invoiceId: invoice.id, amountApplied: 3000 }] } }),
    ])
    expect(results.some(response => response.ok())).toBeTruthy()
    expect(results.every(response => [200, 201, 403, 422].includes(response.status()))).toBeTruthy()
    const doc = await api(page, `/invoices/${invoice.id}`)
    const lots = await currentLots(orgId)
    const qty = doc.status === 'VOID' ? 0 : Number(doc.lines[0].quantity)
    expect(lots.reduce((sum, lot) => sum + Number(lot.qtyBalance), 0)).toBe(7 - qty)
    expect(await balance(orgId, '5-1000')).toBe(qty === 0 ? 0 : qty === 1 ? 1000 : qty === 3 ? 4000 : 6000)
    if (competing === 'void') {
      expect(doc.status).toBe('VOID')
      expect(lots).toEqual(originalLots)
    } else {
      if (competing === 'edit') expect(results.every(response => response.status() === 200)).toBeTruthy()
      else expect(results[1].status()).toBe(201)
      if (competing === 'payment') {
        expect([403, 422]).toContain((await page.request.put(url, { data: correction(2) })).status())
      }
    }
    await assertBalanced(page)
  })
}

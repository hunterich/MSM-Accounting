import { test, expect } from '@playwright/test'
import { accountingCompany, cleanupAccountingCompany, api, choose, DATE, db, payThroughForm } from './accounting-helpers'

test.setTimeout(120_000)
test.afterEach(cleanupAccountingCompany)
test.afterAll(async () => { await db.$disconnect() })

for (const kind of ['ap', 'ar'] as const) {
  test(`${kind.toUpperCase()} partial draft preserves allocation, discount and fee; payment clears only the selected balance`, async ({ page }) => {
    const { orgId, vendor, customer, item } = await accountingCompany(page)
    const bill = await api(page, '/bills', { vendorId: vendor.id, vendorInvoiceNo: 'PARTIAL-FORM', issueDate: DATE,
      status: 'OPEN', taxable: false, taxRate: 0, subtotal: 2000, totalAmount: 2000,
      lines: [{ itemId: item.id, description: item.name, quantity: 2, price: 1000, lineTotal: 2000 }] }, 'POST')
    let invoice
    if (kind === 'ar') {
      invoice = await api(page, '/invoices', { customerId: customer.id, issueDate: DATE, tax: { enabled: false, inclusive: false, rate: 0 },
        lines: [{ itemId: item.id, description: item.name, quantity: 1, price: 2000 }] }, 'POST')
      await api(page, `/invoices/${invoice.id}`, { status: 'SENT' }, 'PUT')
    }
    const doc = kind === 'ap' ? bill : invoice!
    const number = kind === 'ap' ? doc.number : doc.id
    const party = kind === 'ap' ? vendor : customer
    await page.goto(`/${kind}/payments/new`)
    await choose(page, kind === 'ap' ? 'Select vendor...' : 'Select Customer...', party.name)
    await page.locator('main input[type="date"]:visible').fill(DATE)
    await page.locator('button.invoice-tab:visible', { hasText: kind === 'ap' ? 'Bills' : 'Invoices' }).click()
    await page.getByRole('row').filter({ hasText: number }).getByRole('checkbox').check()
    const settlement = page.getByLabel(`Amount to settle for ${number}`, { exact: true }).filter({ visible: true })
    const discount = page.getByLabel(`Discount for ${number}`, { exact: true }).filter({ visible: true })
    const fee = page.getByLabel(`Fee for ${number}`, { exact: true }).filter({ visible: true })
    const beforeJournals = await db.journalEntry.count({ where: { organizationId: orgId } })
    for (const invalid of ['0', '-1', '2001']) {
      await settlement.fill(invalid)
      const rejection = page.waitForEvent('dialog')
      const click = page.getByRole('button', { name: 'Save Payment', exact: true }).click()
      const alert = await rejection
      expect(alert.message()).toContain('positive settlement')
      await alert.dismiss()
      await click
    }
    await settlement.fill('600.25')
    await discount.fill('50.10')
    await fee.fill('10.05')
    const saved = page.waitForResponse(r => r.url().endsWith(`/api/v1/${kind}-payments`) && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
    expect((await saved).ok()).toBeTruthy()
    await page.waitForURL(url => url.pathname === `/${kind}/payments`)
    const draft = kind === 'ap' ? await db.aPPayment.findFirstOrThrow({ where: { organizationId: orgId }, include: { allocations: true } })
      : await db.aRPayment.findFirstOrThrow({ where: { organizationId: orgId }, include: { allocations: true } })
    expect(draft.status).toBe('DRAFT')
    expect(Number(draft.totalAmount)).toBe(560.20)
    expect(draft.allocations).toHaveLength(1)
    expect([Number(draft.allocations[0].amountApplied), Number(draft.allocations[0].discountAmount), Number(draft.allocations[0].penaltyAmount)])
      .toEqual([550.15, 50.10, 10.05])
    expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(beforeJournals)

    await page.getByRole('row').filter({ hasText: draft.number }).getByRole('button', { name: 'Edit', exact: true }).click()
    await page.locator('button.invoice-tab:visible', { hasText: kind === 'ap' ? 'Bills' : 'Invoices' }).click()
    await expect(settlement).toHaveValue('600.25')
    await expect(discount).toHaveValue('50.1')
    await expect(fee).toHaveValue('10.05')
    const posted = page.waitForResponse(r => r.url().endsWith(`/api/v1/${kind}-payments/${draft.id}`) && r.request().method() === 'PUT')
    await page.getByRole('button', { name: 'Save Payment', exact: true }).click()
    const response = await posted
    expect(response.ok(), await response.text()).toBeTruthy()
    await page.waitForURL(url => url.pathname === `/${kind}/payments`)
    const payment = kind === 'ap' ? await db.aPPayment.findUniqueOrThrow({ where: { id: draft.id } }) : await db.aRPayment.findUniqueOrThrow({ where: { id: draft.id } })
    // Use saved account IDs; expected sides and amounts are fixed independently of UI math.
    const entries = await db.journalLine.findMany({ where: { entryId: payment.journalEntryId! } })
    const control = 'apAccountId' in payment ? payment.apAccountId : payment.arAccountId
    expect(Number(entries.find(l => l.accountId === control)![kind === 'ap' ? 'debit' : 'credit'])).toBe(600.25)
    expect(Number(entries.find(l => l.accountId === ('cashAccountId' in payment ? payment.cashAccountId : payment.depositAccountId))![kind === 'ap' ? 'credit' : 'debit'])).toBe(560.20)
    expect(Number(entries.find(l => l.accountId === payment.discountAccountId)![kind === 'ap' ? 'credit' : 'debit'])).toBe(50.10)
    expect(Number(entries.find(l => l.accountId === payment.penaltyAccountId)![kind === 'ap' ? 'debit' : 'credit'])).toBe(10.05)
    const endpoint = `/${kind === 'ap' ? 'bills' : 'invoices'}/${doc.id}/settlement`
    expect(await api(page, endpoint)).toMatchObject({ paid: 600.25, owing: 1399.75, state: 'PARTIAL' })
    await payThroughForm(page, kind, party.name, number)
    expect(await api(page, endpoint)).toMatchObject({ paid: 2000, owing: 0, state: 'PAID' })
  })
}

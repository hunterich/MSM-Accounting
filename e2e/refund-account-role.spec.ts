import { test, expect } from '@playwright/test'
import { accountingCompany, cleanupAccountingCompany, api, DATE, db } from './accounting-helpers'

test.setTimeout(120_000)
test.afterEach(cleanupAccountingCompany)
test.afterAll(async () => { await db.$disconnect() })

for (const ar of [true, false]) {
  test(`${ar ? 'customer' : 'supplier'} refund picker excludes controls and permits correcting a legacy draft`, async ({ page }) => {
    const { orgId, customer, vendor } = await accountingCompany(page)
    const cash = await db.account.findFirstOrThrow({ where: { organizationId: orgId, code: '1-1000' } })
    const control = await db.account.findFirstOrThrow({ where: { organizationId: orgId, code: '1-1200' } })
    const alternate = await db.account.create({ data: { organizationId: orgId, code: '1-1998', name: 'Alternate receivables', type: 'ASSET', normalSide: 'DEBIT' } })
    const holding = await db.account.create({ data: { organizationId: orgId, code: '1-1999', name: 'Refund Holding', type: 'ASSET', normalSide: 'DEBIT' } })
    await db.creditNote.create({ data: { organizationId: orgId, customerId: customer.id, number: 'ALTERNATE-DESIGNATION', date: new Date(DATE),
      amount: 1, arAccountId: alternate.id } })
    const path = ar ? '/credit-notes' : '/debit-notes'
    const note = await api(page, path, { [ar ? 'customerId' : 'vendorId']: ar ? customer.id : vendor.id, date: DATE,
      amount: 100, settlementType: ar ? 'REFUND' : 'REFUND_FROM_VENDOR', settlementAccountId: cash.id }, 'POST')
    // Reproduce a legacy saved refund pointing at control without bypassing the
    // application guard in the request being tested.
    if (ar) await db.creditNote.update({ where: { id: note.id }, data: { settlementAccountId: control.id } })
    else await db.debitNote.update({ where: { id: note.id }, data: { settlementAccountId: control.id } })
    await page.goto(`/${ar ? 'ar/credits' : 'ap/debits'}/edit?${ar ? 'creditId' : 'debitId'}=${note.id}`)
    const picker = page.getByRole('combobox', { name: ar ? 'Refund Account (CR)' : 'Refund Account (DR)', exact: true }).filter({ visible: true })
    await expect(picker).toBeVisible()
    await expect(picker).toHaveValue(control.id)
    await expect(picker.locator(`option[value="${control.id}"]`)).toBeDisabled()
    expect(await picker.locator(`option[value="${alternate.id}"]`).count()).toBe(0)
    await expect(picker.locator(`option[value="${cash.id}"]`)).toBeEnabled()
    await expect(picker.locator(`option[value="${holding.id}"]`)).toBeEnabled()
    await picker.selectOption(holding.id)
    await expect(picker).toHaveValue(holding.id)
    const blocked = await page.request.put(`http://localhost:3100/api/v1${path}/${note.id}`, { data: { settlementAccountId: alternate.id } })
    expect(blocked.status()).toBe(422)
    await api(page, `${path}/${note.id}`, { settlementAccountId: holding.id }, 'PUT')
    await page.evaluate(() => localStorage.setItem('msm-ui-language', JSON.stringify({ state: { language: 'id' }, version: 0 })))
    if (ar) await db.creditNote.update({ where: { id: note.id }, data: { settlementAccountId: control.id } })
    else await db.debitNote.update({ where: { id: note.id }, data: { settlementAccountId: control.id } })
    await page.reload()
    await expect(picker.locator(`option[value="${control.id}"]`)).toContainText('Tidak dapat digunakan untuk pengembalian dana')
  })
}

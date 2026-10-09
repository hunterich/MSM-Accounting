import { test, expect } from '@playwright/test'
import { accountingCompany, cleanupAccountingCompany, api, DATE, db } from './accounting-helpers'

test.setTimeout(120_000)
test.afterEach(cleanupAccountingCompany)
test.afterAll(async () => { await db.$disconnect() })

test('receipt deposits reject foreign, non-cash and inactive accounts at creation, completion and approval', async ({ page }) => {
  const { orgId, customer } = await accountingCompany(page)
  const foreign = await db.account.findFirstOrThrow({ where: { organizationId: { not: orgId }, type: 'ASSET', isActive: true, isPostable: true } })
  const revenue = await db.account.findFirstOrThrow({ where: { organizationId: orgId, type: 'REVENUE', isPostable: true } })
  const receivable = await db.account.findFirstOrThrow({ where: { organizationId: orgId, code: '1-1200' } })
  const parent = await db.account.create({ data: { organizationId: orgId, code: '1-1197', name: 'Bank Accounts Header', type: 'ASSET', normalSide: 'DEBIT', isPostable: false } })
  const child = await db.account.create({ data: { organizationId: orgId, code: '1-1198', name: 'Rekening Utama', type: 'ASSET', normalSide: 'DEBIT', parentId: parent.id } })
  const inactive = await db.account.create({ data: { organizationId: orgId, code: '1-1199', name: 'Inactive Cash', type: 'ASSET', normalSide: 'DEBIT', isActive: false } })
  const base = { customerId: customer.id, date: DATE, status: 'COMPLETED', totalAmount: 100 }
  const before = await db.journalEntry.count({ where: { organizationId: orgId } })
  for (const account of [foreign, revenue, receivable, parent, inactive]) {
    const response = await page.request.post('http://localhost:3100/api/v1/ar-payments', { data: { ...base, depositAccountId: account.id } })
    expect(response.status(), await response.text()).toBe(422)
    expect(await response.text()).toContain('cash or bank deposit account in this organization')
  }
  expect(await db.aRPayment.count({ where: { organizationId: orgId } })).toBe(0)
  expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(before)
  const draft = await api(page, '/ar-payments', { ...base, status: 'DRAFT', depositAccountId: foreign.id }, 'POST')
  const completed = await page.request.put(`http://localhost:3100/api/v1/ar-payments/${draft.id}`, { data: { status: 'COMPLETED' } })
  expect(completed.status()).toBe(422)
  expect((await db.aRPayment.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('DRAFT')
  await db.aRPayment.update({ where: { id: draft.id }, data: { status: 'PENDING_APPROVAL' } })
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@demo.com' } })
  const request = await db.approvalRequest.create({ data: { organizationId: orgId, documentType: 'AR_PAYMENT', documentId: draft.id, requestedById: admin.id } })
  const approval = await page.request.post(`http://localhost:3100/api/v1/approvals/${request.id}/approve`, { data: {} })
  expect(approval.status()).toBe(422)
  expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('PENDING')
  expect((await db.aRPayment.findUniqueOrThrow({ where: { id: draft.id } })).journalEntryId).toBeNull()
  expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(before)
  const posted = await api(page, '/ar-payments', { ...base, depositAccountId: child.id }, 'POST')
  const postedRow = await db.aRPayment.findUniqueOrThrow({ where: { id: posted.id } })
  expect(postedRow.journalEntryId).toBeTruthy()
  expect(await db.journalLine.count({ where: { entryId: postedRow.journalEntryId!, accountId: child.id, debit: 100 } })).toBe(1)
  const replay = await api(page, `/ar-payments/${posted.id}`, { status: 'COMPLETED' }, 'PUT')
  expect(replay.journalEntryId).toBe(postedRow.journalEntryId)
  await api(page, '/ar-payments', base, 'POST') // Existing default cash account remains supported.
  expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(before + 2)
})

for (const kind of ['ar', 'ap'] as const) {
  test(`${kind.toUpperCase()} payment API protects party, allocations, posted history and current balances`, async ({ page }) => {
    const { orgId, vendor, customer, item } = await accountingCompany(page)
    const bill = await api(page, '/bills', { vendorId: vendor.id, vendorInvoiceNo: 'PAY-SAFETY', issueDate: DATE,
      status: 'OPEN', taxable: false, taxRate: 0, subtotal: 2000, totalAmount: 2000,
      lines: [{ itemId: item.id, description: item.name, quantity: 2, price: 1000, lineTotal: 2000 }] }, 'POST')
    let invoice
    if (kind === 'ar') {
      invoice = await api(page, '/invoices', { customerId: customer.id, issueDate: DATE, tax: { enabled: false, inclusive: false, rate: 0 },
        lines: [{ itemId: item.id, description: item.name, quantity: 1, price: 2000 }] }, 'POST')
      await api(page, `/invoices/${invoice.id}`, { status: 'SENT' }, 'PUT')
    }
    const doc = kind === 'ar' ? invoice! : bill
    const link = kind === 'ar' ? { invoiceId: doc.id } : { billId: doc.id }
    const party = kind === 'ar' ? { customerId: customer.id } : { vendorId: vendor.id }
    const make = (amountApplied: number, discountAmount = 0, penaltyAmount = 0) => ({ ...link, amountApplied, discountAmount, penaltyAmount })
    const base = { ...party, date: DATE, status: 'COMPLETED', totalAmount: 2000 }
    const count = () => kind === 'ar' ? db.aRPayment.count({ where: { organizationId: orgId } }) : db.aPPayment.count({ where: { organizationId: orgId } })
    const before = await db.journalEntry.count({ where: { organizationId: orgId } })
    for (const payload of [
      { ...base, allocations: [make(1000), make(1000)] },
      { ...base, totalAmount: 500, allocations: [make(600)] },
      { ...base, allocations: [make(1900, 200)] },
    ]) {
      const response = await page.request.post(`http://localhost:3100/api/v1/${kind}-payments`, { data: payload })
      expect(response.status(), await response.text()).toBe(422)
    }
    const other = kind === 'ar' ? await db.customer.create({ data: { organizationId: orgId, code: 'OTHER', name: 'Other Customer' } })
      : await db.vendor.create({ data: { organizationId: orgId, code: 'OTHER', name: 'Other Vendor' } })
    const mismatch = await page.request.post(`http://localhost:3100/api/v1/${kind}-payments`, { data: {
      ...base, [kind === 'ar' ? 'customerId' : 'vendorId']: other.id, allocations: [make(2000)] } })
    expect(mismatch.status()).toBe(422)
    expect(await count()).toBe(0)
    expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(before)

    const processing = await api(page, `/${kind}-payments`, { ...base, status: 'PROCESSING', totalAmount: 560, allocations: [make(550, 50, 10)] }, 'POST')
    expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(before)
    const processingRow = kind === 'ar' ? await db.aRPayment.findUniqueOrThrow({ where: { id: processing.id } })
      : await db.aPPayment.findUniqueOrThrow({ where: { id: processing.id } })
    expect(processingRow.journalEntryId).toBeNull()
    const processingEdit = await page.request.put(`http://localhost:3100/api/v1/${kind}-payments/${processing.id}`, { data: { totalAmount: 1 } })
    expect(processingEdit.status()).toBe(409)
    const first = await api(page, `/${kind}-payments/${processing.id}`, { status: 'COMPLETED' }, 'PUT')
    const original = kind === 'ar' ? await db.aRPayment.findUniqueOrThrow({ where: { id: first.id }, include: { allocations: true } })
      : await db.aPPayment.findUniqueOrThrow({ where: { id: first.id }, include: { allocations: true } })
    for (const data of [{ totalAmount: 1 }, { allocations: [] }, { status: 'DRAFT' }]) {
      const result = await page.request.put(`http://localhost:3100/api/v1/${kind}-payments/${first.id}`, { data })
      expect(result.status(), await result.text()).toBe(409)
    }
    const deletion = await page.request.delete(`http://localhost:3100/api/v1/${kind}-payments/${first.id}`)
    expect(deletion.status()).toBe(422)
    const replay = await api(page, `/${kind}-payments/${first.id}`, { status: 'COMPLETED' }, 'PUT')
    expect(replay.journalEntryId).toBe(original.journalEntryId)
    const after = kind === 'ar' ? await db.aRPayment.findUniqueOrThrow({ where: { id: first.id }, include: { allocations: true } })
      : await db.aPPayment.findUniqueOrThrow({ where: { id: first.id }, include: { allocations: true } })
    expect(after).toEqual(original)
    const excess = await page.request.post(`http://localhost:3100/api/v1/${kind}-payments`, { data: { ...base, totalAmount: 1450, allocations: [make(1450)] } })
    expect(excess.status()).toBe(422) // 50 discount already cleared debt too.

    const noteKind = kind === 'ar' ? 'credit-notes' : 'debit-notes'
    const note = await api(page, `/${noteKind}`, { ...party, date: DATE, amount: 200, applyTax: false,
      [kind === 'ar' ? 'sourceInvoiceId' : 'sourceBillId']: doc.id,
      settlementType: kind === 'ar' ? 'APPLY_TO_INVOICE' : 'APPLY_TO_BILL' }, 'POST')
    await api(page, `/${noteKind}/${note.id}`, { status: 'APPLIED' }, 'PUT')
    const creditExcess = await page.request.post(`http://localhost:3100/api/v1/${kind}-payments`, { data: { ...base, totalAmount: 1300, allocations: [make(1300)] } })
    expect(creditExcess.status()).toBe(422) // Applied credit reduces 1400 to 1200.

    // Pending approval is not a reservation: finalization must recheck live debt.
    const held = await api(page, `/${kind}-payments`, { ...base, status: 'DRAFT', totalAmount: 1200, allocations: [make(1200)] }, 'POST')
    if (kind === 'ar') await db.aRPayment.update({ where: { id: held.id }, data: { status: 'PENDING_APPROVAL' } })
    else await db.aPPayment.update({ where: { id: held.id }, data: { status: 'PENDING_APPROVAL' } })
    const heldEdit = await page.request.put(`http://localhost:3100/api/v1/${kind}-payments/${held.id}`, { data: { status: 'COMPLETED' } })
    expect(heldEdit.status()).toBe(409)
    const races = await Promise.all([1, 2].map(() => page.request.post(`http://localhost:3100/api/v1/${kind}-payments`, { data: { ...base, totalAmount: 1200, allocations: [make(1200)] } })))
    expect(races.map(r => r.status()).sort()).toEqual([201, 422])
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@demo.com' } })
    const approval = await db.approvalRequest.create({ data: { organizationId: orgId, documentType: kind === 'ar' ? 'AR_PAYMENT' : 'AP_PAYMENT', documentId: held.id, requestedById: admin.id } })
    const approve = await page.request.post(`http://localhost:3100/api/v1/approvals/${approval.id}/approve`, { data: {} })
    expect(approve.status(), await approve.text()).toBe(422)
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe('PENDING')
    const pending = kind === 'ar' ? await db.aRPayment.findUniqueOrThrow({ where: { id: held.id } }) : await db.aPPayment.findUniqueOrThrow({ where: { id: held.id } })
    expect(pending.status).toBe('PENDING_APPROVAL')
    expect(pending.journalEntryId).toBeNull()
    expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(before + 3)
  })
}

import { test, expect } from '@playwright/test'
import { accountingCompany, cleanupAccountingCompany, api, DATE, db } from './accounting-helpers'

test.setTimeout(120_000)
test.afterEach(cleanupAccountingCompany)
test.afterAll(async () => { await db.$disconnect() })

for (const kind of ['ar', 'ap'] as const) {
  test(`${kind.toUpperCase()} applied notes and payments derive Paid; reversals reopen; refunds do not clear debt`, async ({ page }) => {
    const { orgId, vendor, customer, item } = await accountingCompany(page)
    const bill = await api(page, '/bills', { vendorId: vendor.id, vendorInvoiceNo: 'NOTE-STATUS', issueDate: DATE,
      status: 'OPEN', taxable: false, taxRate: 0, subtotal: 2000, totalAmount: 2000,
      lines: [{ itemId: item.id, description: item.name, quantity: 2, price: 1000, lineTotal: 2000 }] }, 'POST')
    let doc = bill
    if (kind === 'ar') {
      doc = await api(page, '/invoices', { customerId: customer.id, issueDate: DATE,
        tax: { enabled: false, inclusive: false, rate: 0 },
        lines: [{ itemId: item.id, description: item.name, quantity: 1, price: 2000 }] }, 'POST')
      await api(page, `/invoices/${doc.id}`, { status: 'SENT' }, 'PUT')
    }
    const party = kind === 'ar' ? { customerId: customer.id } : { vendorId: vendor.id }
    const notePath = kind === 'ar' ? '/credit-notes' : '/debit-notes'
    const docPath = kind === 'ar' ? '/invoices' : '/bills'
    const open = kind === 'ar' ? 'SENT' : 'OPEN'
    const status = async () => (await api(page, `${docPath}/${doc.id}`)).status
    const noteData = { ...party, date: DATE, amount: 600, applyTax: false,
      [kind === 'ar' ? 'sourceInvoiceId' : 'sourceBillId']: doc.id,
      settlementType: kind === 'ar' ? 'APPLY_TO_INVOICE' : 'APPLY_TO_BILL' }
    const note = await api(page, notePath, noteData, 'POST')
    const payment = await api(page, `/${kind}-payments`, { ...party, date: DATE, status: 'COMPLETED', totalAmount: 1360,
      allocations: [{ [kind === 'ar' ? 'invoiceId' : 'billId']: doc.id, amountApplied: 1350, discountAmount: 50, penaltyAmount: 10 }] }, 'POST')
    expect(await status()).toBe(open) // Draft notes and fees do not clear extra debt.
    if (kind === 'ar') await db.creditNote.update({ where: { id: note.id }, data: { status: 'PENDING_APPROVAL' } })
    else await db.debitNote.update({ where: { id: note.id }, data: { status: 'PENDING_APPROVAL' } })
    expect(await status()).toBe(open)
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@demo.com' } })
    const approval = await db.approvalRequest.create({ data: { organizationId: orgId,
      documentType: kind === 'ar' ? 'CREDIT_NOTE' : 'DEBIT_NOTE', documentId: note.id, requestedById: admin.id } })
    await api(page, `/approvals/${approval.id}/approve`, {}, 'POST')
    expect(await status()).toBe('PAID')
    await api(page, `${notePath}/${note.id}/void`, {}, 'POST')
    expect(await status()).toBe(open)
    const replacement = await api(page, notePath, noteData, 'POST')
    await api(page, `${notePath}/${replacement.id}`, { status: 'APPLIED' }, 'PUT')
    expect(await status()).toBe('PAID')
    await api(page, `/${kind}-payments/${payment.id}/void`, {}, 'POST')
    expect(await status()).toBe(open)
    const cash = await db.account.findFirstOrThrow({ where: { organizationId: orgId, code: '1-1000' } })
    const refund = await api(page, notePath, { ...noteData, amount: 1400,
      settlementType: kind === 'ar' ? 'REFUND' : 'REFUND_FROM_VENDOR', settlementAccountId: cash.id }, 'POST')
    await api(page, `${notePath}/${refund.id}`, { status: 'APPLIED' }, 'PUT')
    expect(await status()).toBe(open) // Monetary refunds are cash movements.
    const finalPayment = await api(page, `/${kind}-payments`, { ...party, date: DATE, status: 'COMPLETED', totalAmount: 1400,
      allocations: [{ [kind === 'ar' ? 'invoiceId' : 'billId']: doc.id, amountApplied: 1400 }] }, 'POST')
    expect(await status()).toBe('PAID')
    const before = await db.journalEntry.count({ where: { organizationId: orgId } })
    const voids = await Promise.all([
      page.request.post(`http://localhost:3100/api/v1/${kind}-payments/${finalPayment.id}/void`, { data: {} }),
      page.request.post(`http://localhost:3100/api/v1${notePath}/${replacement.id}/void`, { data: {} }),
    ])
    expect(voids.map(r => r.status())).toEqual([200, 200])
    expect(await status()).toBe(open)
    expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(before + 2)
  })
}

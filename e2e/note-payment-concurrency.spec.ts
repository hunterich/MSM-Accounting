import { test, expect } from '@playwright/test'
import { accountingCompany, cleanupAccountingCompany, api, DATE, db } from './accounting-helpers'

test.setTimeout(120_000)
test.afterEach(cleanupAccountingCompany)
test.afterAll(async () => { await db.$disconnect() })

for (const kind of ['ar', 'ap'] as const) {
  test(`${kind.toUpperCase()} notes and payments share live settlement locks and stale approvals roll back`, async ({ page }) => {
    const { orgId, vendor, customer, item } = await accountingCompany(page)
    const bill = await api(page, '/bills', { vendorId: vendor.id, vendorInvoiceNo: 'NOTE-RACE', issueDate: DATE,
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
    const makeNote = (amount: number) => api(page, notePath, { ...party, date: DATE, amount, applyTax: false,
      [kind === 'ar' ? 'sourceInvoiceId' : 'sourceBillId']: doc.id,
      settlementType: kind === 'ar' ? 'APPLY_TO_INVOICE' : 'APPLY_TO_BILL' }, 'POST')
    const apply = (id: string) => page.request.put(`http://localhost:3100/api/v1${notePath}/${id}`, { data: { status: 'APPLIED' } })
    const before = await db.journalEntry.count({ where: { organizationId: orgId } })
    const note = await makeNote(1500)
    const results = await Promise.all([
      apply(note.id),
      page.request.post(`http://localhost:3100/api/v1/${kind}-payments`, { data: { ...party, date: DATE,
        status: 'COMPLETED', totalAmount: 1500,
        allocations: [{ [kind === 'ar' ? 'invoiceId' : 'billId']: doc.id, amountApplied: 1500 }] } }),
    ])
    expect(results.filter(r => r.ok())).toHaveLength(1)
    expect(results.filter(r => !r.ok()).map(r => r.status())).toEqual([422])
    expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(before + 1)
    // Different notes also compete for the same debt; exclude each note itself
    // when its route has already stamped APPLIED inside the transaction.
    const notes = await Promise.all([makeNote(400), makeNote(400)])
    const noteResults = await Promise.all(notes.map(n => apply(n.id)))
    expect(noteResults.map(r => r.status()).sort()).toEqual([200, 422])
    expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(before + 2)
    const winner = notes[noteResults.findIndex(r => r.ok())]
    const replay = await apply(winner.id)
    expect(replay.status()).toBe(200)
    await api(page, `${notePath}/${winner.id}/void`, {}, 'POST')
    const resurrect = await apply(winner.id)
    expect(resurrect.status()).toBe(422)
    const held = await makeNote(600)
    const foreign = kind === 'ar' ? await db.customer.findFirstOrThrow({ where: { organizationId: { not: orgId } } })
      : await db.vendor.findFirstOrThrow({ where: { organizationId: { not: orgId } } })
    const foreignEdit = await page.request.put(`http://localhost:3100/api/v1${notePath}/${held.id}`, {
      data: { [kind === 'ar' ? 'customerId' : 'vendorId']: foreign.id } })
    expect(foreignEdit.status()).toBe(404)
    if (kind === 'ar') await db.creditNote.update({ where: { id: held.id }, data: { status: 'PENDING_APPROVAL' } })
    else await db.debitNote.update({ where: { id: held.id }, data: { status: 'PENDING_APPROVAL' } })
    const bypass = await apply(held.id)
    expect(bypass.status()).toBe(422)
    const edit = await page.request.put(`http://localhost:3100/api/v1${notePath}/${held.id}`, { data: { amount: 1 } })
    expect(edit.status()).toBe(422)
    const deletion = await page.request.delete(`http://localhost:3100/api/v1${notePath}/${held.id}`)
    expect(deletion.status()).toBe(422)
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@demo.com' } })
    const approval = await db.approvalRequest.create({ data: { organizationId: orgId,
      documentType: kind === 'ar' ? 'CREDIT_NOTE' : 'DEBIT_NOTE', documentId: held.id, requestedById: admin.id } })
    const approved = await page.request.post(`http://localhost:3100/api/v1/approvals/${approval.id}/approve`, { data: {} })
    expect(approved.status(), await approved.text()).toBe(422)
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe('PENDING')
    const pending = kind === 'ar' ? await db.creditNote.findUniqueOrThrow({ where: { id: held.id } })
      : await db.debitNote.findUniqueOrThrow({ where: { id: held.id } })
    expect(pending.status).toBe('PENDING_APPROVAL')
    expect(pending.journalEntryId).toBeNull()
    expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(before + 3)
  })
}

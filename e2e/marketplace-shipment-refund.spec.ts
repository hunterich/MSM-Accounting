import { test, expect } from '@playwright/test'
import * as XLSX from 'xlsx'
import { accountingCompany, cleanupAccountingCompany, api, choose, db } from './accounting-helpers'
import { addCostLayer } from '../lib/inventory-costing'
import { loadOrgAccountDefaults, resolveAccountDefaultId } from '../lib/account-defaults'

test.setTimeout(120_000)
test.afterEach(cleanupAccountingCompany)
test.afterAll(async () => { await db.$disconnect() })

// Synthetic headers and values exercise our accepted format; they are not
// evidence that current marketplace exports use these exact fields or dates.
function shipmentFile(platform: 'Shopee' | 'TikTok') {
  const row = platform === 'Shopee'
    ? { 'No. Pesanan': 'SHIP1001', 'SKU Induk': 'JOURNEY-1', 'Nama Produk': 'Journey Widget', 'Total Harga Produk': 2000, 'Jumlah': 1, 'Harga Setelah Diskon': 2000, 'Status Pesanan': 'Dikirim', 'Waktu Pengiriman': '2026-09-30' }
    : { 'Order ID': 'SHIP1001', 'Seller SKU': 'JOURNEY-1', 'Product Name': 'Journey Widget', 'SKU Subtotal After Discount': 2000, 'Quantity': 1, 'Order Status': 'Shipped', 'Shipped Time': '2026-09-30' }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([row]), platform === 'Shopee' ? 'Matched Orders' : 'Filtered Adjusted')
  return { name: `${platform}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer }
}

for (const platform of ['Shopee', 'TikTok'] as const) {
  test(`${platform} shipment import and later refund reconciliation`, async ({ page }) => {
    const { orgId, customer, item } = await accountingCompany(page)
    await db.organization.update({ where: { id: orgId }, data: { taxEnabled: false } })
    await db.$transaction(async tx => {
      const accounts = await tx.account.findMany({ where: { organizationId: orgId, isActive: true } })
      const inventory = resolveAccountDefaultId(accounts, await loadOrgAccountDefaults(tx, orgId), 'inventoryAsset')
      await addCostLayer(tx, orgId, item.id, null, 5, 1000, 'PURCHASE', 'marketplace-e2e', new Date('2026-01-01'), undefined, inventory)
    })
    const wallet = await db.bankAccount.create({ data: { organizationId: orgId, name: 'Cash and Bank', bankName: 'Cash and Bank' } })
    const conn = await db.ecommerceConnection.create({ data: {
      organizationId: orgId, platform: platform === 'Shopee' ? 'SHOPEE' : 'TIKTOK', shopName: `${platform} test shop`,
      customerId: customer.id, holdingAccountId: wallet.id, mappings: { fees: {}, shipping: {}, others: {} },
    } })
    await page.goto('/ar/invoices')
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await choose(page, 'Select shop...', `${platform} test shop`)
    await page.locator('input[type=file]').setInputFiles(shipmentFile(platform))
    await expect(page.getByText('SHIP1001', { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    const imported = page.waitForResponse(r => r.url().endsWith(`/integrations/${conn.id}/import`) && r.request().method() === 'POST', { timeout: 60_000 })
    await page.getByRole('button', { name: /Import 1 New/ }).click()
    const response = await imported
    expect(response.ok(), await response.text()).toBeTruthy()
    await expect(page.getByText('Import Complete', { exact: true })).toBeVisible({ timeout: 30_000 })
    const invoice = await db.salesInvoice.findFirstOrThrow({ where: { organizationId: orgId, poNumber: 'SHIP1001' }, include: { lines: true } })
    expect(invoice.issueDate.toISOString().slice(0, 10)).toBe('2026-09-30')
    expect(await db.inventoryLedgerEntry.count({ where: { organizationId: orgId, documentId: invoice.id, qtyOut: { gt: 0 } } })).toBe(1)
    const payout = await api(page, `/integrations/${conn.id}/settlement-import`, { orders: [{ orderId: 'SHIP1001', settlementDate: '2026-10-02', netReleased: Number(invoice.totalAmount), charges: {} }] }, 'POST')
    expect(payout.posted).toBe(1)
    const receipt = await db.aRPayment.findFirstOrThrow({ where: { organizationId: orgId, ecommerceConnectionId: conn.id } })
    const source = invoice.lines[0]
    const sr = await api(page, '/sales-returns', { customerId: customer.id, invoiceId: invoice.id, returnDate: '2026-10-03', status: 'APPROVED',
      lines: [{ sourceInvoiceLineId: source.id, itemId: source.itemId, qtyReturn: Number(source.quantity), price: Number(source.price), goodsReceived: false }] }, 'POST')
    const note = await api(page, '/credit-notes', { customerId: customer.id, sourceInvoiceId: invoice.id, salesReturnId: sr.id,
      date: '2026-10-03', amount: Number(invoice.totalAmount), taxAmount: 0, applyTax: false, settlementType: 'REFUND', settlementAccountId: receipt.depositAccountId }, 'POST')
    await api(page, `/credit-notes/${note.id}`, { status: 'APPLIED' }, 'PUT')
    const before = await db.journalEntry.count({ where: { organizationId: orgId } })
    await page.goto('/integrations')
    await page.getByRole('row').filter({ hasText: `${platform} test shop` }).getByTitle('Import settlement statement').click()
    await page.getByLabel('Marketplace order number').fill('SHIP1001')
    await page.getByLabel('Statement refund amount (positive IDR)').fill(String(Number(invoice.totalAmount)))
    await page.getByLabel('Applied refund credit note number(s), separated by commas').fill(note.number)
    await page.getByRole('button', { name: 'Reconcile refund' }).click()
    await expect(page.getByText('Settlement Import Complete')).toBeVisible()
    expect((await db.creditNote.findUniqueOrThrow({ where: { id: note.id } })).marketplaceRefundReceiptId).toBe(receipt.id)
    expect(await db.journalEntry.count({ where: { organizationId: orgId } })).toBe(before)
  })
}

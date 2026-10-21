import { afterAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { auditInventoryBooks } from '@/lib/inventory-book-audit'
import { postBillToLedger } from '@/lib/bill-posting'
import { postJournalEntry } from '@/lib/journal-posting'
import { postInvoiceSend } from '@/lib/invoice-send-posting'
import { postStockAdjustmentToLedger } from '@/lib/stock-adjustment-posting'
import { prisma, createTestOrg, createItem, createVendor, createCustomer, cleanupOrg, disconnect } from './harness'

afterAll(disconnect)
const date = new Date('2026-09-10')
async function audit(orgId: string, ids: string[]) {
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    return auditInventoryBooks(tx, orgId, ids)
  }, { isolationLevel: 'RepeatableRead' })
}

describe('independent read-only Inventory book audit', () => {
  it('compares real receipts to independently selected posted accounts and exposes an unexplained journal', async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' })
    try {
      const itemId = await createItem(org.orgId), vendorId = await createVendor(org.orgId)
      const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: 'AUDIT-RECEIPT', issueDate: date,
        status: 'OPEN', totalAmount: 5000,
        lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity: 5, price: 1000, lineTotal: 5000 } } }, include: { lines: true } })
      await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill))
      await prisma.item.update({ where: { id: itemId }, data: { isActive: false } })
      expect(await audit(org.orgId, [org.accounts.inventoryAsset])).toMatchObject({ ledgerValue: '5000.00', generalLedgerValue: '5000.00', difference: '0.00',
        pools: [{ itemId, warehouseId: null, ledgerQuantity: '5.0000', physicalQuantity: '5.0000', findings: [] }] })
      await prisma.$transaction(tx => postJournalEntry(tx, { organizationId: org.orgId, date, memo: 'Unexplained inventory adjustment',
        lines: [{ accountId: org.accounts.inventoryAsset, description: '', debit: 10, credit: 0 },
          { accountId: org.accounts.apControl, description: '', debit: 0, credit: 10 }] }))
      const before = await prisma.journalEntry.findMany({ where: { organizationId: org.orgId }, include: { lines: true }, orderBy: { id: 'asc' } })
      const result = await audit(org.orgId, [org.accounts.inventoryAsset])
      expect(result).toMatchObject({ ledgerValue: '5000.00', generalLedgerValue: '5010.00', difference: '10.00', accountScopeRequiresFinanceConfirmation: true })
      const cli = await promisify(execFile)(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/audit-inventory-books.ts',
        '--company', org.orgId, '--accounts', org.accounts.inventoryAsset], { env: { ...process.env }, timeout: 10000 })
      expect(JSON.parse(cli.stdout)).toEqual({ mode: 'READ_ONLY_DIAGNOSTIC', ...result })
      expect(await prisma.journalEntry.findMany({ where: { organizationId: org.orgId }, include: { lines: true }, orderBy: { id: 'asc' } })).toEqual(before)
    } finally { await cleanupOrg(org.orgId) }
  })

  it('includes historical inactive accounts, ignores draft journals and refuses foreign account IDs', async () => {
    const org = await createTestOrg(), other = await createTestOrg()
    try {
      const second = await prisma.account.create({ data: { organizationId: org.orgId, code: '1311', name: 'Former Inventory', type: 'ASSET', normalSide: 'DEBIT', isActive: false } })
      await prisma.$transaction(tx => postJournalEntry(tx, { organizationId: org.orgId, date, memo: 'Historical reclassification', lines: [
        { accountId: second.id, description: '', debit: 250, credit: 0 },
        { accountId: org.accounts.inventoryAsset, description: '', debit: 0, credit: 250 },
      ] }))
      await prisma.journalEntry.create({ data: { organizationId: org.orgId, entryNo: 'DRAFT-AUDIT', date, memo: 'Not posted', status: 'DRAFT',
        lines: { create: [{ lineNo: 1, accountId: second.id, debit: 999 }] } } })
      expect(await audit(org.orgId, [org.accounts.inventoryAsset])).toMatchObject({ difference: '-250.00' })
      const result = await audit(org.orgId, [second.id, org.accounts.inventoryAsset, second.id])
      expect(result.generalLedgerValue).toBe('0.00')
      expect(result.accounts.map(row => row.balance).sort()).toEqual(['-250.00', '250.00'])
      await expect(audit(org.orgId, [other.accounts.inventoryAsset])).rejects.toThrow('selected company')
      await expect(audit(org.orgId, [])).rejects.toThrow('historical Inventory')
    } finally { await cleanupOrg(org.orgId); await cleanupOrg(other.orgId) }
  })

  it('does not let offsetting warehouse quantities or negative physical lots hide a broken pool', async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' })
    try {
      const itemId = await createItem(org.orgId)
      await prisma.inventoryLedgerEntry.createMany({ data: [
        { organizationId: org.orgId, itemId, warehouseId: org.warehouseId, date, documentType: 'PURCHASE', documentId: 'A', qtyIn: 1, valueChange: 100 },
        { organizationId: org.orgId, itemId, date, documentType: 'SALES', documentId: 'B', qtyOut: 1, valueChange: -100 },
      ] })
      await prisma.inventoryLot.createMany({ data: [
        { organizationId: org.orgId, itemId, date, documentType: 'PURCHASE', documentId: 'POSITIVE', qtyIn: 1, qtyBalance: 1, unitCost: 100 },
        { organizationId: org.orgId, itemId, date, documentType: 'PURCHASE', documentId: 'NEGATIVE', qtyIn: 0, qtyBalance: -1, unitCost: 100 },
      ] })
      const result = await audit(org.orgId, [org.accounts.inventoryAsset])
      expect(result.difference).toBe('0.00')
      expect(result.pools).toEqual([
        { itemId, warehouseId: null, ledgerQuantity: '-1.0000', physicalQuantity: '0.0000', bookValue: '-100.00', carryingValue: '0.00', uninitializedLots: 1,
          findings: ['UNINITIALIZED_CARRYING_VALUE', 'QUANTITY_SCOPE_MISMATCH', 'NEGATIVE_STOCK_REVIEW', 'NEGATIVE_PHYSICAL_LOT', 'NEGATIVE_BOOK_VALUE'] },
        { itemId, warehouseId: org.warehouseId, ledgerQuantity: '1.0000', physicalQuantity: '0.0000', bookValue: '100.00', carryingValue: '0.00', uninitializedLots: 0, findings: ['CARRYING_VALUE_MISMATCH', 'QUANTITY_SCOPE_MISMATCH'] },
      ])
    } finally { await cleanupOrg(org.orgId) }
  })
})


describe('stored carrying values are independently diagnosed', () => {
  it('uses stored carrying cents rather than original unit prices, and exposes corruption even when GL equals ledger', async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' })
    try {
      const itemId = await createItem(org.orgId), vendorId = await createVendor(org.orgId), customerId = await createCustomer(org.orgId)
      for (const price of [1000, 1200]) {
        const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: 'CARRY-' + price, issueDate: date, status: 'OPEN', totalAmount: 5 * price,
          lines: { create: { lineNo: 1, itemId, description: 'Stock', quantity: 5, price, lineTotal: 5 * price } } }, include: { lines: true } })
        await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill))
      }
      const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'CARRY-SALE', issueDate: date, status: 'SENT', totalAmount: 12000, subtotal: 12000,
        lines: { create: { lineNo: 1, itemId, description: 'Stock', quantity: 4, price: 3000, lineSubtotal: 12000 } } } })
      await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id))
      const valid = await audit(org.orgId, [org.accounts.inventoryAsset])
      expect(valid.pools[0]).toMatchObject({ carryingValue: '6600.00', findings: [] })
      const lot = await prisma.inventoryLot.findFirstOrThrow({ where: { organizationId: org.orgId, qtyBalance: { gt: 0 } } })
      await prisma.inventoryLot.update({ where: { id: lot.id }, data: { carryingValue: { increment: 50 } } })
      const before = await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId }, orderBy: { id: 'asc' } })
      const result = await audit(org.orgId, [org.accounts.inventoryAsset])
      expect(result).toMatchObject({ ledgerValue: '6600.00', generalLedgerValue: '6600.00', difference: '0.00',
        pools: [{ bookValue: '6600.00', carryingValue: '6650.00', findings: ['CARRYING_VALUE_MISMATCH'] }] })
      expect(await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId }, orderBy: { id: 'asc' } })).toEqual(before)
    } finally { await cleanupOrg(org.orgId) }
  })
  it('names offsetting warehouse carrying errors and missing initialization without repairing either', async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' })
    try {
      const itemId = await createItem(org.orgId)
      for (const [warehouseId, price] of [[null, 100], [org.warehouseId, 200]] as const) {
        await prisma.$transaction(tx => postStockAdjustmentToLedger(tx, org.orgId, { id: 'AUDIT-' + price, number: 'AUDIT-' + price, date, warehouseId,
          lines: [{ itemId, oldQty: 0, newQty: 5, unitCost: price }] }))
      }
      const lots = await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId } })
      for (const lot of lots) await prisma.inventoryLot.update({ where: { id: lot.id }, data: { carryingValue: { increment: lot.warehouseId ? -10 : 10 } } })
      const result = await audit(org.orgId, [org.accounts.inventoryAsset])
      expect(result.difference).toBe('0.00')
      expect(result.pools.map(pool => [pool.bookValue, pool.carryingValue, pool.findings])).toEqual([
        ['500.00', '510.00', ['CARRYING_VALUE_MISMATCH']], ['1000.00', '990.00', ['CARRYING_VALUE_MISMATCH']],
      ])
      await prisma.inventoryLot.update({ where: { id: lots.find(lot => !lot.warehouseId)!.id }, data: { carryingValue: null } })
      const before = await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId }, orderBy: { id: 'asc' } })
      const uninitialized = await audit(org.orgId, [org.accounts.inventoryAsset])
      expect(uninitialized.pools[0]).toMatchObject({ carryingValue: '0.00', uninitializedLots: 1, findings: ['UNINITIALIZED_CARRYING_VALUE', 'CARRYING_VALUE_MISMATCH'] })
      const cli = await promisify(execFile)(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/audit-inventory-books.ts', '--company', org.orgId, '--accounts', org.accounts.inventoryAsset], { env: { ...process.env }, timeout: 10000 })
      expect(JSON.parse(cli.stdout)).toEqual({ mode: 'READ_ONLY_DIAGNOSTIC', ...uninitialized })
      expect(await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId }, orderBy: { id: 'asc' } })).toEqual(before)
    } finally { await cleanupOrg(org.orgId) }
  })
})

import { afterAll, describe, expect, it } from 'vitest'
import { postGoodsReceiptToLedger } from '@/lib/goods-receipt-posting'
import { postBillToLedger } from '@/lib/bill-posting'
import { postInvoiceSend } from '@/lib/invoice-send-posting'
import { voidInvoice } from '@/lib/invoice-void'
import { prisma, createTestOrg, createItem, createVendor, createCustomer, cleanupOrg, disconnect, accountBalance, inventoryLedgerValue, inventoryLotValue, assertTrialBalanced } from './harness'

afterAll(disconnect)
const date = new Date('2026-09-10')
describe('receipt line value remains exact through stock depletion and sale reversal', () => {
  for (const method of ['FIFO', 'WEIGHTED_AVERAGE'] as const) for (const goodsReceipt of [false, true]) for (const inclusive of [false, true]) {
    it(`${method}: ${goodsReceipt ? 'PO receipt then bill' : 'direct bill'}, ${inclusive ? 'VAT inclusive' : 'untaxed'} 3 units net 1,000`, async () => {
      const org = await createTestOrg({ costingMethod: method })
      try {
        const itemId = await createItem(org.orgId), vendorId = await createVendor(org.orgId), customerId = await createCustomer(org.orgId)
        const gross = inclusive ? 1110 : 1000
        const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number: 'EXACT-RECEIPT', issueDate: date, status: 'OPEN',
          taxable: inclusive, taxInclusive: inclusive, taxRate: inclusive ? 11 : 0, totalAmount: gross,
          lines: { create: { lineNo: 1, itemId, description: 'Three units', quantity: 3, price: gross / 3, lineTotal: gross } } }, include: { lines: true } })
        if (goodsReceipt) {
          await prisma.$transaction(tx => postGoodsReceiptToLedger(tx, org.orgId, { billId: bill.id, poNumber: 'PO-EXACT', date,
            taxInclusive: inclusive, taxRate: inclusive ? 11 : 0, lines: [{ itemId, quantity: 3, lineTotal: gross }] }))
          expect(await accountBalance(org.orgId, org.accounts.grIrClearing)).toBe(-1000)
          expect(await accountBalance(org.orgId, org.accounts.apControl)).toBe(0)
          expect(await inventoryLedgerValue(org.orgId)).toBe(1000)
        }
        await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill))
        expect(await inventoryLedgerValue(org.orgId)).toBe(1000)
        expect(await inventoryLotValue(org.orgId)).toBe(1000)
        expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(1000)
        expect(await accountBalance(org.orgId, org.accounts.grIrClearing)).toBe(0)
        expect(await accountBalance(org.orgId, org.accounts.apControl)).toBe(-gross)
        expect(await accountBalance(org.orgId, org.accounts.apTax)).toBe(inclusive ? 110 : 0)
        const lot = await prisma.inventoryLot.findFirstOrThrow({ where: { organizationId: org.orgId, itemId } })
        expect(lot.initialValue?.toFixed(2)).toBe('1000.00')
        expect(lot.unitCost.toFixed(6)).toBe('333.333333')
        const invoice = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number: 'SELL-ALL', issueDate: date,
          status: 'SENT', subtotal: 3000, totalAmount: 3000,
          lines: { create: { lineNo: 1, itemId, description: 'All stock', quantity: 3, price: 1000, lineSubtotal: 3000 } } } })
        await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, invoice.id))
        expect(await inventoryLedgerValue(org.orgId)).toBe(0)
        expect(await inventoryLotValue(org.orgId)).toBe(0)
        expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(0)
        expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(1000)
        await prisma.$transaction(tx => voidInvoice(tx, org.orgId, invoice.id, { date }))
        expect(await inventoryLedgerValue(org.orgId)).toBe(1000)
        expect(await inventoryLotValue(org.orgId)).toBe(1000)
        expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(1000)
        expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBe(0)
        const restored = await prisma.inventoryLot.findUniqueOrThrow({ where: { id: lot.id } })
        expect(restored.unitCost).toEqual(lot.unitCost)
        expect(restored.qtyBalance.toFixed(4)).toBe('3.0000')
        await assertTrialBalanced(org.orgId)
      } finally { await cleanupOrg(org.orgId) }
    })
  }
})

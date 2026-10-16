import { afterAll, describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import { postBillToLedger } from '@/lib/bill-posting'
import { postInvoiceSend } from '@/lib/invoice-send-posting'
import { postSalesReturnOnApproval } from '@/lib/sales-return-posting'
import { postStockAdjustmentToLedger } from '@/lib/stock-adjustment-posting'
import { voidBill } from '@/lib/bill-void'
import { voidSalesReturn } from '@/lib/return-void'
import { voidStockAdjustment } from '@/lib/stock-adjustment-void'
import { prisma, createTestOrg, createItem, createCustomer, createVendor, cleanupOrg, disconnect, accountBalance, inventoryLedgerValue, inventoryLotValue } from './harness'

afterAll(disconnect)
const date = new Date('2026-09-10')
async function snapshot(tx: Prisma.TransactionClient, organizationId: string) {
  const where = { organizationId }, orderBy = { id: 'asc' as const }
  return { lots: await tx.inventoryLot.findMany({ where, orderBy }),
    ledger: await tx.inventoryLedgerEntry.findMany({ where, orderBy, include: { lotDraws: { orderBy } } }),
    journals: await tx.journalEntry.findMany({ where, orderBy, include: { lines: { orderBy } } }),
    bills: await tx.bill.findMany({ where, orderBy }), returns: await tx.salesReturn.findMany({ where, orderBy }),
    adjustments: await tx.stockAdjustment.findMany({ where, orderBy }) }
}
describe('WA inbound void refuses a changed carrying value before any side effects', () => {
  for (const kind of ['bill', 'customer-return', 'adjustment'] as const) for (const sold of [4, 5]) {
    it(`${kind}, after selling ${sold}: refuses clearly and preserves all stock/documents/journals`, async () => {
      const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' })
      try {
        const itemId = await createItem(org.orgId), vendorId = await createVendor(org.orgId), customerId = await createCustomer(org.orgId)
        const buy = async (number: string, price: number) => {
          const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number, issueDate: date, status: 'OPEN', totalAmount: 5 * price,
            lines: { create: { lineNo: 1, itemId, description: 'Stock', quantity: 5, price, lineTotal: 5 * price } } }, include: { lines: true } })
          await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill)); return bill
        }
        const sell = async (number: string, quantity: number) => {
          const sale = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number, issueDate: date, status: 'SENT', subtotal: quantity * 3000, totalAmount: quantity * 3000,
            lines: { create: { lineNo: 1, itemId, description: 'Stock', quantity, price: 3000, lineSubtotal: quantity * 3000 } } }, include: { lines: true } })
          await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, sale.id)); return sale
        }
        let source: Awaited<ReturnType<typeof sell>> | undefined
        if (kind === 'customer-return') { await buy('RETURN-SOURCE', 1200); source = await sell('ORIGINAL-SALE', 5) }
        await buy('CHEAP', 1000)
        let targetId: string, documentType: 'PURCHASE' | 'SALES_RETURN' | 'ADJUSTMENT'
        if (kind === 'bill') { targetId = (await buy('EXPENSIVE', 1200)).id; documentType = 'PURCHASE' }
        else if (kind === 'customer-return') {
          const ret = await prisma.salesReturn.create({ data: { organizationId: org.orgId, customerId, invoiceId: source!.id, number: 'RETURN', returnDate: date, status: 'APPROVED',
            lines: { create: { lineNo: 1, itemId, itemName: 'Stock', sourceInvoiceLineId: source!.lines[0].id, qtyReturn: 5, goodsReceived: true } } } })
          await prisma.$transaction(tx => postSalesReturnOnApproval(tx, ret.id)); targetId = ret.id; documentType = 'SALES_RETURN'
        } else {
          const adj = await prisma.stockAdjustment.create({ data: { organizationId: org.orgId, number: 'INCREASE', date, reason: 'Stock received', status: 'APPROVED' } })
          await prisma.$transaction(tx => postStockAdjustmentToLedger(tx, org.orgId, { id: adj.id, number: adj.number, date, warehouseId: null,
            lines: [{ itemId, oldQty: 0, newQty: 5, unitCost: 1200 }] })); targetId = adj.id; documentType = 'ADJUSTMENT'
        }
        await sell('LATER-SALE', sold)
        const lot = await prisma.inventoryLot.findFirstOrThrow({ where: { organizationId: org.orgId, documentId: targetId, documentType } })
        expect(lot.qtyBalance.toFixed(4)).toBe('5.0000')
        expect(lot.initialValue?.toFixed(2)).toBe('6000.00')
        expect(lot.carryingValue?.toFixed(2)).toBe('5500.00')
        const before = await prisma.$transaction(tx => snapshot(tx, org.orgId))
        await expect(prisma.$transaction(tx => kind === 'bill' ? voidBill(tx, org.orgId, targetId, { date })
          : kind === 'customer-return' ? voidSalesReturn(tx, org.orgId, targetId, { date }) : voidStockAdjustment(tx, org.orgId, targetId, { date }))).rejects.toThrow(/Cannot (reverse|void): .*carrying value/)
        expect(await prisma.$transaction(tx => snapshot(tx, org.orgId))).toEqual(before)
        expect(await inventoryLedgerValue(org.orgId)).toBe((10 - sold) * 1100)
        expect(await inventoryLotValue(org.orgId)).toBe((10 - sold) * 1100)
        expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe((10 - sold) * 1100)
      } finally { await cleanupOrg(org.orgId) }
    })
  }
})

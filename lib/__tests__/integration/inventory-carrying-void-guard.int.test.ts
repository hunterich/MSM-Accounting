import { afterAll, describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import { postBillToLedger } from '@/lib/bill-posting'
import { postInvoiceSend } from '@/lib/invoice-send-posting'
import { postSalesReturnOnApproval } from '@/lib/sales-return-posting'
import { postStockAdjustmentToLedger } from '@/lib/stock-adjustment-posting'
import { postPurchaseReturnOnApproval } from '@/lib/purchase-return-posting'
import { voidBill } from '@/lib/bill-void'
import { voidInvoice } from '@/lib/invoice-void'
import { voidPurchaseReturn, voidSalesReturn } from '@/lib/return-void'
import { voidStockAdjustment } from '@/lib/stock-adjustment-void'
import { NextRequest } from 'next/server'
import { PUT as editBill } from '@/src/app/api/v1/bills/[id]/route'
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
describe('WA inbound void follows actual stock issue order', () => {
  for (const older of [true, false]) it(`immediate void of ${older ? 'older' : 'newer'} mixed-price bill succeeds`, async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' })
    try {
      const itemId = await createItem(org.orgId), vendorId = await createVendor(org.orgId)
      const bills: Array<{ id: string }> = []
      for (const [number, price] of [['CHEAP', 1000], ['EXPENSIVE', 1200]] as const) {
        const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number, vendorInvoiceNo: number, issueDate: date, status: 'OPEN', totalAmount: price * 5,
          lines: { create: { lineNo: 1, itemId, description: 'Stock', quantity: 5, price, lineTotal: price * 5 } } }, include: { lines: true } })
        await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill)); bills.push(bill)
      }
      await prisma.$transaction(tx => voidBill(tx, org.orgId, bills[older ? 0 : 1].id, { date }))
      const remaining = older ? 6000 : 5000
      expect(await inventoryLedgerValue(org.orgId)).toBe(remaining)
      expect(await inventoryLotValue(org.orgId)).toBe(remaining)
      expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(remaining)
      expect(await accountBalance(org.orgId, org.accounts.apControl)).toBe(-remaining)
    } finally { await cleanupOrg(org.orgId) }
  })
  it('actual posted-bill edit can be repeated across mixed-price stock', async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' })
    try {
      const itemId = await createItem(org.orgId), vendorId = await createVendor(org.orgId)
      let targetId = ''
      for (const [number, price] of [['CHEAP', 1000], ['EXPENSIVE', 1200]] as const) {
        const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number, vendorInvoiceNo: number, issueDate: date, status: 'OPEN', totalAmount: price * 5,
          lines: { create: { lineNo: 1, itemId, description: 'Stock', quantity: 5, price, lineTotal: price * 5 } } }, include: { lines: true } })
        await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill)); targetId = bill.id
      }
      for (const price of [1400, 1300]) {
        const response = await editBill(new NextRequest(`http://localhost/api/v1/bills/${targetId}`, { method: 'PUT',
          headers: { 'x-org-id': org.orgId, 'x-user-id': 'reviewer', 'x-role-type': 'ADMIN', 'content-type': 'application/json' },
          body: JSON.stringify({ totalAmount: price * 5, subtotal: price * 5,
            lines: [{ lineNo: 1, itemId, description: 'Corrected', quantity: 5, price, lineTotal: price * 5 }] }) }), { params: Promise.resolve({ id: targetId }) })
        expect(response.status, JSON.stringify(await response.json())).toBe(200)
        expect(await inventoryLedgerValue(org.orgId)).toBe(5000 + price * 5)
        expect(await inventoryLotValue(org.orgId)).toBe(5000 + price * 5)
        expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(5000 + price * 5)
        expect(await accountBalance(org.orgId, org.accounts.apControl)).toBe(-5000 - price * 5)
      }
    } finally { await cleanupOrg(org.orgId) }
  })
  for (const kind of ['bill', 'customer-return', 'adjustment'] as const) for (const sold of [0, 4, 5]) {
    it(`${kind}: ${sold ? `after selling ${sold}, refuses with exact rollback` : 'immediate mixed-price void succeeds'}`, async () => {
      const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' })
      try {
        const itemId = await createItem(org.orgId), vendorId = await createVendor(org.orgId), customerId = await createCustomer(org.orgId)
        const buy = async (number: string, price: number) => {
          const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number, issueDate: date, status: 'OPEN', totalAmount: 5 * price,
            lines: { create: { lineNo: 1, itemId, description: 'Stock', quantity: 5, price, lineTotal: 5 * price } } }, include: { lines: true } })
          await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill)); return bill
        }
        const sell = async (number: string, quantity: number) => {
          const sale = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number, issueDate: new Date('2026-09-09'), status: 'SENT', subtotal: quantity * 3000, totalAmount: quantity * 3000,
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
        if (sold) await sell('LATER-SALE', sold)
        // Business dates are backdated and all timestamps deliberately tied;
        // insertion sequence under the stock lock must still find the issue.
        await prisma.inventoryLedgerEntry.updateMany({ where: { organizationId: org.orgId }, data: { createdAt: new Date('2026-01-01') } })
        const lot = await prisma.inventoryLot.findFirstOrThrow({ where: { organizationId: org.orgId, documentId: targetId, documentType } })
        expect(lot.qtyBalance.toFixed(4)).toBe('5.0000')
        expect(lot.initialValue?.toFixed(2)).toBe('6000.00')
        expect(lot.carryingValue?.toFixed(2)).toBe('5500.00')
        const voidTarget = (tx: Prisma.TransactionClient) => kind === 'bill' ? voidBill(tx, org.orgId, targetId, { date })
          : kind === 'customer-return' ? voidSalesReturn(tx, org.orgId, targetId, { date }) : voidStockAdjustment(tx, org.orgId, targetId, { date })
        if (!sold) {
          await prisma.$transaction(voidTarget)
          expect(await inventoryLedgerValue(org.orgId)).toBe(5000)
          expect(await inventoryLotValue(org.orgId)).toBe(5000)
          expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(5000)
          return
        }
        const before = await prisma.$transaction(tx => snapshot(tx, org.orgId))
        await expect(prisma.$transaction(voidTarget)).rejects.toThrow('later SALES LATER-SALE')
        expect(await prisma.$transaction(tx => snapshot(tx, org.orgId))).toEqual(before)
        expect(await inventoryLedgerValue(org.orgId)).toBe((10 - sold) * 1100)
        expect(await inventoryLotValue(org.orgId)).toBe((10 - sold) * 1100)
        expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe((10 - sold) * 1100)
      } finally { await cleanupOrg(org.orgId) }
    })
  }
})

describe('WA inbound void ignores later stock movements that were themselves reversed', () => {
  const cases = ['voided sale', 'voided supplier return', 'voided adjustment decrease', 'voided later bill', 'voided sale then live sale', 'legacy unmarked void row'] as const
  const refuses = (kind: typeof cases[number]) => kind === 'voided sale then live sale' || kind === 'legacy unmarked void row'
  for (const kind of cases) it(`${kind}: ${refuses(kind) ? 'still refuses with exact rollback' : 'receipt void succeeds at exact value'}`, async () => {
    const org = await createTestOrg({ costingMethod: 'WEIGHTED_AVERAGE' })
    try {
      const itemId = await createItem(org.orgId), vendorId = await createVendor(org.orgId), customerId = await createCustomer(org.orgId)
      const buy = async (number: string, price: number) => {
        const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number, vendorInvoiceNo: number, issueDate: date, status: 'OPEN', totalAmount: 5 * price,
          lines: { create: { lineNo: 1, itemId, description: 'Stock', quantity: 5, price, lineTotal: 5 * price } } }, include: { lines: true } })
        await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill)); return bill
      }
      const sell = async (number: string, quantity: number) => {
        const sale = await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId, number, issueDate: date, status: 'SENT', subtotal: quantity * 3000, totalAmount: quantity * 3000,
          lines: { create: { lineNo: 1, itemId, description: 'Stock', quantity, price: 3000, lineSubtotal: quantity * 3000 } } } })
        await prisma.$transaction(tx => postInvoiceSend(tx, org.orgId, sale.id)); return sale
      }
      const cheap = await buy('CHEAP', 1000)
      const target = await buy('EXPENSIVE', 1200)
      if (kind === 'voided sale' || kind === 'voided sale then live sale') {
        const sale = await sell('VOIDED-SALE', 4)
        await prisma.$transaction(tx => voidInvoice(tx, org.orgId, sale.id, { date }))
        if (kind === 'voided sale then live sale') await sell('LIVE-SALE', 4)
      } else if (kind === 'voided supplier return') {
        const ret = await prisma.purchaseReturn.create({ data: { organizationId: org.orgId, vendorId, billId: cheap.id, number: 'PR-VOIDED', returnDate: date, status: 'APPROVED',
          returnAccountId: org.accounts.apControl, lines: { create: { itemId, lineNo: 1, description: 'Return', qtyReturn: 4 } } } })
        await prisma.$transaction(tx => postPurchaseReturnOnApproval(tx, ret.id))
        await prisma.$transaction(tx => voidPurchaseReturn(tx, org.orgId, ret.id, { date }))
      } else if (kind === 'voided adjustment decrease') {
        const adj = await prisma.stockAdjustment.create({ data: { organizationId: org.orgId, number: 'DECREASE', date, reason: 'Count', status: 'APPROVED' } })
        await prisma.$transaction(tx => postStockAdjustmentToLedger(tx, org.orgId, { id: adj.id, number: adj.number, date, warehouseId: null,
          lines: [{ itemId, oldQty: 10, newQty: 6, unitCost: 0 }] }))
        // While active, the decrease blocks and is named by its document number.
        await expect(prisma.$transaction(tx => voidBill(tx, org.orgId, target.id, { date }))).rejects.toThrow('later ADJUSTMENT DECREASE')
        await prisma.$transaction(tx => voidStockAdjustment(tx, org.orgId, adj.id, { date }))
      } else {
        const later = await buy('LATER', 1500)
        await prisma.$transaction(tx => voidBill(tx, org.orgId, later.id, { date }))
        // A void row written before reversedAt marking carries the voided bill's
        // ID under ADJUSTMENT; it must still block and must not show that raw ID.
        if (kind === 'legacy unmarked void row') await prisma.inventoryLedgerEntry.updateMany({
          where: { organizationId: org.orgId, documentType: 'ADJUSTMENT', documentId: later.id }, data: { reversedAt: null } })
      }
      if (refuses(kind)) {
        const value = kind === 'legacy unmarked void row' ? 11000 : 6600
        const before = await prisma.$transaction(tx => snapshot(tx, org.orgId))
        await expect(prisma.$transaction(tx => voidBill(tx, org.orgId, target.id, { date }))).rejects.toThrow(
          kind === 'legacy unmarked void row' ? 'later stock movement dated 2026-09-10' : 'later SALES LIVE-SALE')
        expect(await prisma.$transaction(tx => snapshot(tx, org.orgId))).toEqual(before)
        expect(await inventoryLedgerValue(org.orgId)).toBe(value)
        expect(await inventoryLotValue(org.orgId)).toBe(value)
        expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(value)
        return
      }
      expect(await inventoryLedgerValue(org.orgId)).toBe(11000)
      await prisma.$transaction(tx => voidBill(tx, org.orgId, target.id, { date }))
      expect(await inventoryLedgerValue(org.orgId)).toBe(5000)
      expect(await inventoryLotValue(org.orgId)).toBe(5000)
      expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(5000)
      const lots = await prisma.inventoryLot.findMany({ where: { organizationId: org.orgId } })
      expect(lots.reduce((sum, lot) => sum + Number(lot.qtyBalance), 0)).toBe(5)
    } finally { await cleanupOrg(org.orgId) }
  })
})

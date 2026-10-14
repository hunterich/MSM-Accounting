import { afterAll, describe, expect, it } from 'vitest'
import { changeInventoryCostingMethod } from '@/lib/inventory-costing-switch'
import { closeAccountingPeriod } from '@/lib/period-close'
import { postBillToLedger } from '@/lib/bill-posting'
import { prisma, createTestOrg, createVendor, createItem, cleanupOrg, disconnect, accountBalance, inventoryLedgerValue, inventoryLotValue, assertTrialBalanced } from './harness'

afterAll(disconnect)
const date = new Date('2026-09-10')
function signal<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function verifyWait(pid: number) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT cardinality(pg_blocking_pids(${pid}::int)) > 0 AS blocked`
    if (row.blocked) return
    await new Promise(done => setTimeout(done, 10))
  }
  throw new Error('Expected a verified PostgreSQL period-row lock wait')
}

describe('INV-02 costing change versus monthly close', () => {
  for (const closeFirst of [true, false]) it(`${closeFirst ? 'close' : 'method change'} wins; receipt identities and GL remain exact`, async () => {
    const org = await createTestOrg({ costingMethod: 'FIFO' })
    const ready = signal<void>(), release = signal<void>(), identified = signal<number>()
    let firstResult: Promise<unknown> | undefined, secondResult: Promise<unknown> | undefined, userId: string | undefined
    try {
      const itemId = await createItem(org.orgId), vendorId = await createVendor(org.orgId)
      for (const [number, quantity, price] of [['A', 3, 1000.5], ['B', 4, 1200.25]] as const) {
        const bill = await prisma.bill.create({ data: { organizationId: org.orgId, vendorId, number, issueDate: date,
          status: 'OPEN', totalAmount: quantity * price,
          lines: { create: { itemId, lineNo: 1, description: 'Stock', quantity, price, lineTotal: quantity * price } } }, include: { lines: true } })
        await prisma.$transaction(tx => postBillToLedger(tx, org.orgId, bill))
      }
      const user = await prisma.user.create({ data: { email: `${org.orgId}-close@test.local`, fullName: 'Closer', passwordHash: 'x', status: 'ACTIVE' } })
      userId = user.id
      const period = await prisma.accountingPeriod.create({ data: { organizationId: org.orgId, name: 'September', startDate: new Date('2026-09-01'), endDate: new Date('2026-09-30T23:59:59.999Z'), status: 'OPEN' } })
      const where = { organizationId: org.orgId }
      const beforeLots = await prisma.inventoryLot.findMany({ where, orderBy: { id: 'asc' } })
      const beforeLedger = await prisma.inventoryLedgerEntry.findMany({ where, orderBy: { id: 'asc' } })
      const beforeJournals = await prisma.journalEntry.findMany({ where, include: { lines: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } })
      const first = prisma.$transaction(async tx => {
        if (closeFirst) await closeAccountingPeriod(tx, org.orgId, user.id, period.id)
        else await changeInventoryCostingMethod(tx, org.orgId, 'WEIGHTED_AVERAGE', date)
        ready.resolve(); await release.promise
      }, { timeout: 15000 })
      firstResult = first.then(() => null, error => error)
      await Promise.race([ready.promise, first.then(() => { throw new Error('First transaction did not hold its locks') })])
      secondResult = prisma.$transaction(async tx => {
        const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
        identified.resolve(row.pid)
        if (closeFirst) await changeInventoryCostingMethod(tx, org.orgId, 'WEIGHTED_AVERAGE', date)
        else await closeAccountingPeriod(tx, org.orgId, user.id, period.id)
      }, { timeout: 15000 }).then(() => null, error => error)
      await verifyWait(await identified.promise)
      release.resolve()
      expect(await firstResult).toBeNull()
      if (closeFirst) expect(await secondResult).toMatchObject({ status: 422 })
      else expect(await secondResult).toBeNull()
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } })).costingMethod).toBe(closeFirst ? 'FIFO' : 'WEIGHTED_AVERAGE')
      expect((await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: period.id } })).status).toBe('CLOSED')
      const afterLots = await prisma.inventoryLot.findMany({ where, orderBy: { id: 'asc' } })
      const trace = (lots: typeof beforeLots) => lots.map(({ carryingValue, initialValue, ...lot }) => lot)
      expect(trace(afterLots)).toEqual(trace(beforeLots))
      if (closeFirst) expect(afterLots).toEqual(beforeLots)
      expect(await prisma.inventoryLedgerEntry.findMany({ where, orderBy: { id: 'asc' } })).toEqual(beforeLedger)
      expect(await prisma.journalEntry.findMany({ where, include: { lines: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } })).toEqual(beforeJournals)
      expect(await inventoryLedgerValue(org.orgId)).toBe(7802.5)
      expect(await inventoryLotValue(org.orgId)).toBe(7802.5)
      expect(await accountBalance(org.orgId, org.accounts.inventoryAsset)).toBe(7802.5)
      await assertTrialBalanced(org.orgId)
    } finally {
      release.resolve(); await firstResult; await secondResult
      await cleanupOrg(org.orgId)
      if (userId) await prisma.user.delete({ where: { id: userId } })
    }
  })
})

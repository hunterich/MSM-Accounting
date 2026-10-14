import { Prisma } from '@prisma/client'
import { ApiError } from './errors'

/** Current balances only. The reviewer supplies the complete historical Inventory
 * account set; neither today's default nor journal descriptions prove that set.
 * Run in a repeatable-read, read-only transaction. No repairs or initialization.
 */
export async function auditInventoryBooks(tx: Prisma.TransactionClient, organizationId: string, accountIds: string[]) {
  const ids = [...new Set(accountIds)].sort()
  if (!ids.length || ids.some(id => !id)) throw new ApiError('Select the historical Inventory accounts to review.', 422)
  const accounts = await tx.account.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, code: true, name: true } })
  if (accounts.length !== ids.length) throw new ApiError('Every reviewed account must belong to the selected company.', 422)
  const pools = await tx.$queryRaw<Array<{ itemId: string; warehouseId: string | null; ledgerQuantity: Prisma.Decimal; physicalQuantity: Prisma.Decimal; bookValue: Prisma.Decimal; negativeLots: bigint }>>`
    WITH movements AS (
      SELECT "itemId", "warehouseId", sum("qtyIn" - "qtyOut") quantity, sum("valueChange") value
      FROM "InventoryLedgerEntry" WHERE "organizationId" = ${organizationId}
      GROUP BY "itemId", "warehouseId"
    ), lots AS (
      SELECT "itemId", "warehouseId", sum("qtyBalance") quantity,
        count(*) FILTER (WHERE "qtyBalance" < 0) negative
      FROM "InventoryLot" WHERE "organizationId" = ${organizationId}
      GROUP BY "itemId", "warehouseId"
    )
    SELECT coalesce(m."itemId", l."itemId") "itemId", coalesce(m."warehouseId", l."warehouseId") "warehouseId",
      coalesce(m.quantity, 0) "ledgerQuantity", coalesce(l.quantity, 0) "physicalQuantity",
      coalesce(m.value, 0) "bookValue", coalesce(l.negative, 0) "negativeLots"
    FROM movements m FULL JOIN lots l ON m."itemId" = l."itemId" AND m."warehouseId" IS NOT DISTINCT FROM l."warehouseId"
    ORDER BY 1, 2 NULLS FIRST
  `
  // All posted history, including compensating reversals, inactive items and
  // inactive accounts. Excluding the original reversed movement loses history.
  const balances = await tx.journalLine.groupBy({ by: ['accountId'], where: {
    accountId: { in: ids }, entry: { organizationId, status: 'POSTED' },
  }, _sum: { debit: true, credit: true } })
  const gl = ids.map(id => {
    const row = balances.find(balance => balance.accountId === id)
    return { ...accounts.find(account => account.id === id)!, balance: new Prisma.Decimal(row?._sum.debit ?? 0).minus(row?._sum.credit ?? 0).toFixed(2) }
  })
  const ledgerValue = pools.reduce((sum, pool) => sum.plus(pool.bookValue), new Prisma.Decimal(0))
  const glValue = gl.reduce((sum, account) => sum.plus(account.balance), new Prisma.Decimal(0))
  return {
    organizationId, scope: 'CURRENT_COMPANY_TOTAL_REVIEWED_ACCOUNTS',
    accountScopeRequiresFinanceConfirmation: true,
    ledgerValue: ledgerValue.toFixed(2), generalLedgerValue: glValue.toFixed(2),
    difference: glValue.minus(ledgerValue).toFixed(2), accounts: gl,
    pools: pools.map(pool => ({ itemId: pool.itemId, warehouseId: pool.warehouseId,
      ledgerQuantity: pool.ledgerQuantity.toFixed(4), physicalQuantity: pool.physicalQuantity.toFixed(4),
      bookValue: pool.bookValue.toFixed(2), findings: [
        ...(!pool.ledgerQuantity.equals(pool.physicalQuantity) ? ['QUANTITY_SCOPE_MISMATCH'] : []),
        ...(pool.ledgerQuantity.isNegative() ? ['NEGATIVE_STOCK_REVIEW'] : []),
        ...(pool.negativeLots > 0n ? ['NEGATIVE_PHYSICAL_LOT'] : []),
        ...(pool.ledgerQuantity.isZero() && !pool.bookValue.isZero() ? ['VALUE_WITHOUT_QUANTITY'] : []),
        ...(pool.bookValue.isNegative() ? ['NEGATIVE_BOOK_VALUE'] : []),
      ],
    })),
  }
}

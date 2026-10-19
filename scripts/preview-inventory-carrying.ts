/** Explicit, read-only finance preview. No schema or data changes. */
import { PrismaClient } from '@prisma/client'
import { previewInventoryCarryingValues } from '../lib/inventory-carrying-preview'

const args = process.argv.slice(2)
function argument(name: string): string | undefined {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}
async function main() {
  const organizationId = argument('--company'), itemId = argument('--item')
  const warehouseId = argument('--warehouse') ?? null
  if (!organizationId || !itemId || args.some((arg, index) => index % 2 === 0 && !['--company', '--item', '--warehouse'].includes(arg)) || args.length % 2 !== 0) {
    throw new Error('Usage: preview-inventory-carrying.ts --company ID --item ID [--warehouse ID]')
  }
  if (!process.env.DATABASE_URL) throw new Error('Provide DATABASE_URL explicitly for the reviewed database')
  const prisma = new PrismaClient()
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } })
      if (org?.costingMethod !== 'WEIGHTED_AVERAGE') throw new Error('Select a Weighted Average company')
      const item = await tx.item.findFirst({ where: { id: itemId, organizationId }, select: { id: true } })
      if (!item) throw new Error('Item does not belong to the selected company')
      if (warehouseId && !await tx.warehouse.findFirst({ where: { id: warehouseId, organizationId }, select: { id: true } })) {
        throw new Error('Warehouse does not belong to the selected company')
      }
      return previewInventoryCarryingValues(tx, organizationId, itemId, warehouseId)
    }, { isolationLevel: 'RepeatableRead', timeout: 30000 })
    process.stdout.write(`${JSON.stringify({ mode: 'READ_ONLY_PROPOSAL', ...result }, null, 2)}\n`)
  } finally { await prisma.$disconnect() }
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })

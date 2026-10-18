import { PrismaClient } from '@prisma/client'
import { auditInventoryBooks } from '../lib/inventory-book-audit'

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 4 || args[0] !== '--company' || args[2] !== '--accounts' || !args[1] || !args[3]) {
    throw new Error('Usage: audit-inventory-books.ts --company ID --accounts ID[,ID...]')
  }
  if (!process.env.DATABASE_URL) throw new Error('Provide DATABASE_URL explicitly for the reviewed database')
  const prisma = new PrismaClient()
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'")
      return auditInventoryBooks(tx, args[1], args[3].split(','))
    }, { isolationLevel: 'RepeatableRead', timeout: 30000 })
    process.stdout.write(`${JSON.stringify({ mode: 'READ_ONLY_DIAGNOSTIC', ...result }, null, 2)}\n`)
  } finally { await prisma.$disconnect() }
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })

import { PrismaClient } from '@prisma/client';
import { auditItemAccountMappings } from '../lib/item-account-audit';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--company' || !args[1]) throw new Error('Usage: audit-item-account-mappings.ts --company ID');
  if (!process.env.DATABASE_URL) throw new Error('Provide DATABASE_URL explicitly for the reviewed database');
  const prisma = new PrismaClient();
  try {
    const report = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
      if (!await tx.organization.findUnique({ where: { id: args[1] }, select: { id: true } })) throw new Error('Company not found');
      return auditItemAccountMappings(tx, args[1]);
    }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
    process.stdout.write(`${JSON.stringify({ mode: 'READ_ONLY_AUDIT', ...report }, null, 2)}\n`);
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

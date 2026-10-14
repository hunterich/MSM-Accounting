/** Read-only pre-release diagnostic; historical journals are never repaired here. */
import { PrismaClient } from '@prisma/client';
import { listPartyControlAccountIds } from '../lib/control-account-guard';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--company' || !args[1]) throw new Error('Usage: audit-note-refund-accounts.ts --company ID');
  if (!process.env.DATABASE_URL) throw new Error('Provide DATABASE_URL explicitly for the reviewed database');
  const orgId = args[1], prisma = new PrismaClient();
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      if (!await tx.organization.findUnique({ where: { id: orgId }, select: { id: true } })) throw new Error('Company not found');
      const controls = await listPartyControlAccountIds(tx, orgId);
      const accounts = await tx.account.findMany({ where: { organizationId: orgId },
        select: { id: true, isActive: true, isPostable: true, type: true } });
      const byId = new Map(accounts.map(account => [account.id, account]));
      const credit = await tx.creditNote.findMany({ where: { organizationId: orgId, settlementType: 'REFUND' },
        select: { id: true, number: true, date: true, status: true, settlementAccountId: true, journalEntryId: true } });
      const debit = await tx.debitNote.findMany({ where: { organizationId: orgId, settlementType: 'REFUND_FROM_VENDOR' },
        select: { id: true, number: true, date: true, status: true, settlementAccountId: true, journalEntryId: true } });
      const notes = [...credit.map(note => ({ kind: 'CREDIT_NOTE', ...note })), ...debit.map(note => ({ kind: 'DEBIT_NOTE', ...note }))];
      const findings = notes.flatMap(note => {
        const account = note.settlementAccountId ? byId.get(note.settlementAccountId) : undefined;
        const reasons = !account ? ['missing or foreign account'] : [
          ...(!account.isActive ? ['inactive account'] : []), ...(!account.isPostable ? ['nonpostable account'] : []),
          ...(account.type !== 'ASSET' ? ['not an asset account'] : []),
          ...(controls.has(account.id) ? ['designated AR/AP control'] : []),
        ];
        return reasons.length ? [{ ...note, reasons }] : [];
      });
      return { companyId: orgId, refundNotesReviewed: notes.length, findings };
    }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
    process.stdout.write(`${JSON.stringify({ mode: 'READ_ONLY_AUDIT', capturedAt: new Date().toISOString(), ...result }, null, 2)}\n`);
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

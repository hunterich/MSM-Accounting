import { PrismaClient } from '@prisma/client';
import { backfillNoteSettlementStatus } from '../lib/backfill-note-settlement-status';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply' && !arg.startsWith('--organization='))) {
    throw new Error('Usage: npm run db:backfill-note-status -- [--apply] [--organization=<id>]');
  }
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL explicitly before running this backfill.');
  const organizationArg = args.find(arg => arg.startsWith('--organization='));
  const organizationId = organizationArg?.slice('--organization='.length);
  if (organizationArg && !organizationId) throw new Error('--organization requires an organization ID.');
  const apply = args.includes('--apply');
  const db = new PrismaClient();
  try {
    console.log(`${apply ? 'APPLY' : 'DRY RUN'}: note settlement status (${organizationId ?? 'all organizations'})`);
    const result = await backfillNoteSettlementStatus(db, { apply, organizationId });
    console.log(JSON.stringify(result, null, 2));
    console.log(apply ? 'Status reconciliation complete.' : 'No records changed. Re-run with --apply to persist the reported Paid transitions.');
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

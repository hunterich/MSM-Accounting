import type { Prisma } from '@prisma/client';

/** Return one row per account, regardless of the number of journal lines.
 * Keep organization, posting status and date filters at the query boundary.
 * The existing report builders accept these totals as JournalLineRecords.
 */
export async function readJournalTotals(
  db: Pick<Prisma.TransactionClient, 'journalLine'>,
  where: Prisma.JournalLineWhereInput,
) {
  const groups = await db.journalLine.groupBy({
    by: ['accountId'],
    where,
    _sum: { debit: true, credit: true },
  });
  return groups.map((row) => ({
    accountId: row.accountId,
    debit: row._sum.debit,
    credit: row._sum.credit,
  }));
}

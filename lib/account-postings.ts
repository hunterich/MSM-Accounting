import type { Prisma } from '@prisma/client';

export async function syncAccountPostingFlags(
  tx: Prisma.TransactionClient,
  organizationId: string,
  accountIds: string[],
) {
  const uniqueAccountIds = Array.from(new Set(accountIds.filter(Boolean)));
  if (uniqueAccountIds.length === 0) return;

  const postedLines = await tx.journalLine.findMany({
    where: {
      accountId: { in: uniqueAccountIds },
      entry: {
        organizationId,
        status: 'POSTED',
      },
    },
    select: { accountId: true },
    distinct: ['accountId'],
  });

  const postedAccountIds = postedLines.map((line) => line.accountId);
  const postedSet = new Set(postedAccountIds);
  const nonPostedAccountIds = uniqueAccountIds.filter((accountId) => !postedSet.has(accountId));

  if (nonPostedAccountIds.length > 0) {
    await tx.account.updateMany({
      where: {
        organizationId,
        id: { in: nonPostedAccountIds },
      },
      data: { hasPostings: false },
    });
  }

  if (postedAccountIds.length > 0) {
    await tx.account.updateMany({
      where: {
        organizationId,
        id: { in: postedAccountIds },
      },
      data: { hasPostings: true },
    });
  }
}

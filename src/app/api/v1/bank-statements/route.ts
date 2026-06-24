import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, ok, err, ApiError } from '@/lib/api-utils';
import { parseStatement } from '@/lib/bank-statement-parser';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);
  const { searchParams } = new URL(req.url);
  const bankAccountId = searchParams.get('bankAccountId');
  const statementId = searchParams.get('statementId');

  // Single-statement mode: return the statement with its lines
  if (statementId) {
    const statement = await prisma.bankStatement.findFirst({
      where: { id: statementId, organizationId: orgId },
      include: { lines: { orderBy: { date: 'asc' } } },
    });
    if (!statement) {
      return err('Statement not found', 404);
    }
    return ok({
      id: statement.id,
      bankAccountId: statement.bankAccountId,
      filename: statement.filename,
      importedAt: statement.importedAt,
      fromDate: statement.fromDate,
      toDate: statement.toDate,
      lines: statement.lines.map((line) => ({
        id: line.id,
        date: line.date,
        description: line.description,
        amount: Number(line.amount),
        balance: line.balance !== null ? Number(line.balance) : null,
        matchStatus: line.matchStatus,
        matchedTxId: line.matchedTxId,
      })),
    });
  }

  if (bankAccountId) {
    // Validate bankAccount belongs to org
    const bankAccount = await prisma.bankAccount.findFirst({
      where: { id: bankAccountId, organizationId: orgId },
      select: { id: true },
    });
    if (!bankAccount) {
      return err('Bank account not found in organization', 404);
    }
  }

  const statements = await prisma.bankStatement.findMany({
    where: { organizationId: orgId, ...(bankAccountId ? { bankAccountId } : {}) },
    orderBy: { importedAt: 'desc' },
    include: {
      _count: {
        select: { lines: true },
      },
    },
  });

  // Get matched counts per statement
  const statementIds = statements.map((s) => s.id);
  const matchedCounts = statementIds.length > 0
    ? await prisma.bankStatementLine.groupBy({
        by: ['statementId'],
        where: {
          statementId: { in: statementIds },
          matchStatus: 'MATCHED',
        },
        _count: { id: true },
      })
    : [];

  const matchedByStatement = new Map(
    matchedCounts.map((row) => [row.statementId, row._count.id]),
  );

  const data = statements.map((s) => ({
    id: s.id,
    bankAccountId: s.bankAccountId,
    filename: s.filename,
    importedAt: s.importedAt,
    fromDate: s.fromDate,
    toDate: s.toDate,
    totalLines: s._count.lines,
    matchedCount: matchedByStatement.get(s.id) ?? 0,
  }));

  return ok({ data });
});

export const POST = withHandler(async function POST(req: NextRequest) {
  const orgId = requireOrg(req);

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const bankAccountId = formData.get('bankAccountId') as string | null;

  if (!file) {
    return err('file is required', 400);
  }
  if (!bankAccountId) {
    return err('bankAccountId is required', 400);
  }

  // Validate bankAccount belongs to org
  const bankAccount = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, organizationId: orgId },
    select: { id: true },
  });
  if (!bankAccount) {
    return err('Bank account not found in organization', 404);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file.name;

  const parsedLines = parseStatement(buffer, filename);
  if (parsedLines.length === 0) {
    return err('No valid lines parsed from file', 422);
  }

  const fromDate = parsedLines.reduce<Date | null>((min, l) => (min === null || l.date < min ? l.date : min), null);
  const toDate = parsedLines.reduce<Date | null>((max, l) => (max === null || l.date > max ? l.date : max), null);

  const statement = await prisma.bankStatement.create({
    data: {
      organizationId: orgId,
      bankAccountId,
      filename,
      fromDate: fromDate ?? undefined,
      toDate: toDate ?? undefined,
      lines: {
        create: parsedLines.map((line) => ({
          date: line.date,
          description: line.description,
          amount: line.amount,
          balance: line.balance ?? null,
          matchStatus: 'UNMATCHED',
        })),
      },
    },
    include: {
      _count: { select: { lines: true } },
    },
  });

  return ok(
    {
      id: statement.id,
      bankAccountId: statement.bankAccountId,
      filename: statement.filename,
      importedAt: statement.importedAt,
      fromDate: statement.fromDate,
      toDate: statement.toDate,
      totalLines: statement._count.lines,
      matchedCount: 0,
    },
    201,
  );
});

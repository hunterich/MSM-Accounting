import { NextRequest } from 'next/server';
import { Prisma, type AccountType, type NormalSide } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit } from '@/lib/api-utils';
import { createAccountInputSchema } from '@/types/api';
import {
  validateAccountState,
  fromPrismaAccountType,
  fromPrismaNormalSide,
  toPrismaAccountType,
  toPrismaNormalSide,
  getNormalSideByType,
  getAccountLevel,
} from '@/lib/account-rules';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const search = searchParams.get('search');
  const where: Prisma.AccountWhereInput = { organizationId: orgId ?? undefined };
  if (type) where.type = type as AccountType;
  if (search) where.OR = [
    { name: { contains: search, mode: 'insensitive' } },
    { code: { contains: search, mode: 'insensitive' } },
  ];
  const data = await prisma.account.findMany({
    where,
    orderBy: { code: 'asc' },
    include: { _count: { select: { children: true } } },
  });
  return ok(data);
}

export async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  try {
    const body = await req.json();
    const parsed = createAccountInputSchema.safeParse({ ...body, organizationId: orgId });
    if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid account payload', 400);

    const rawAccounts = await prisma.account.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        parentId: true,
        level: true,
        isPostable: true,
        isActive: true,
        reportGroup: true,
        reportSubGroup: true,
        normalSide: true,
        hasPostings: true,
      },
    });
    const ruleAccounts = rawAccounts.map((a) => ({
      ...a,
      type: fromPrismaAccountType(a.type),
      normalSide: fromPrismaNormalSide(a.normalSide),
    }));

    const p = parsed.data;
    const nextType = p.type;
    const normalSide = getNormalSideByType(nextType);
    const nextAccount = {
      code: p.code,
      name: p.name,
      type: nextType,
      parentId: p.parentId ?? null,
      isPostable: p.isPostable ?? true,
      isActive: p.isActive ?? true,
      reportGroup: p.reportGroup,
      reportSubGroup: p.reportSubGroup ?? null,
      normalSide,
    };

    const errors = validateAccountState(nextAccount, ruleAccounts);
    if (Object.keys(errors).length > 0) {
      const firstError = Object.values(errors)[0];
      return err(firstError ?? 'Invalid account payload', 400);
    }

    const account = await prisma.account.create({
      data: {
        ...nextAccount,
        organizationId: orgId,
        type: toPrismaAccountType(nextType) as AccountType,
        normalSide: toPrismaNormalSide(normalSide) as NormalSide,
        level: getAccountLevel(nextAccount.parentId, ruleAccounts),
      },
    });
    logAudit({
      orgId,
      actorId: req.headers.get('x-user-id'),
      entityType: 'Account',
      entityId: account.id,
      action: 'CREATE',
      payload: body,
    });
    return ok(account, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return err('Account code must be unique.', 409);
    }
    const message = error instanceof Error ? error.message : 'Failed to create account';
    return err(message, 500);
  }
}

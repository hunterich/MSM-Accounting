// @ts-nocheck
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit } from '@/lib/api-utils';
import { createAccountInputSchema } from '@/types/api';
import {
  fromPrismaAccountType,
  fromPrismaNormalSide,
  getAccountLevel,
  getNormalSideByType,
  toPrismaAccountType,
  toPrismaNormalSide,
  validateAccountState,
} from '@/lib/account-rules';

export const runtime = 'nodejs';

const accountRuleSelect = {
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
};

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const search = searchParams.get('search');
  const where: any = { organizationId: orgId };
  if (type) where.type = toPrismaAccountType(type);
  if (search) where.OR = [
    { name: { contains: search, mode: 'insensitive' } },
    { code: { contains: search, mode: 'insensitive' } },
  ];
  const data = await prisma.account.findMany({
    where,
    orderBy: { code: 'asc' },
    include: {
      _count: { select: { children: true } },
      journalLines: {
        where: { entry: { status: 'POSTED' } },
        select: { id: true },
        take: 1,
      },
    },
  });
  return ok(data);
}

export async function POST(req: NextRequest) {
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  try {
    const body = await req.json();
    if (body?.organizationId && body.organizationId !== orgId) {
      return err('organizationId does not match current session', 403);
    }

    const parsed = createAccountInputSchema.safeParse({
      ...body,
      organizationId: orgId,
    });

    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message || 'Invalid account payload', 400);
    }

    const accounts = await prisma.account.findMany({
      where: { organizationId: orgId },
      select: accountRuleSelect,
    });
    const validationAccounts = accounts.map((account) => ({
      ...account,
      type: fromPrismaAccountType(account.type),
      normalSide: fromPrismaNormalSide(account.normalSide),
    }));

    const payload = parsed.data;
    const normalSide = getNormalSideByType(payload.type);
    const nextAccount = {
      code: payload.code,
      name: payload.name,
      type: payload.type,
      parentId: payload.parentId ?? null,
      isPostable: payload.isPostable,
      isActive: payload.isActive,
      reportGroup: payload.reportGroup,
      reportSubGroup: payload.reportSubGroup || null,
      normalSide,
    };

    const errors = validateAccountState(nextAccount, validationAccounts);
    if (Object.keys(errors).length > 0) {
      return err(Object.values(errors)[0], 400);
    }

    const account = await prisma.account.create({
      data: {
        ...nextAccount,
        organizationId: orgId,
        type: toPrismaAccountType(nextAccount.type),
        normalSide: toPrismaNormalSide(nextAccount.normalSide),
        level: getAccountLevel(nextAccount.parentId, validationAccounts),
      },
    });

    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Account', entityId: account.id, action: 'CREATE', payload: body });
    return ok(account, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return err('Account code must be unique.', 409);
    }

    const message = error instanceof Error ? error.message : 'Failed to create account';
    return err(message, 500);
  }
}

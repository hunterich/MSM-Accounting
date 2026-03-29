import { NextRequest } from 'next/server';
import { Prisma, type AccountType, type NormalSide } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, err, logAudit } from '@/lib/api-utils';
import { updateAccountInputSchema } from '@/types/api';
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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  const account = await prisma.account.findFirst({
    where: { id, organizationId: orgId },
    include: {
      children: true,
      parent: true,
      journalLines: {
        where: { entry: { status: 'POSTED' } },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!account) return err('Not found', 404);
  return ok(account);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);

  try {
    const body = await req.json();
    if (body?.organizationId && body.organizationId !== orgId) {
      return err('organizationId does not match current session', 403);
    }

    const parsed = updateAccountInputSchema.safeParse({
      ...body,
      organizationId: orgId,
    });

    if (!parsed.success) {
      return err(parsed.error.issues[0]?.message || 'Invalid account payload', 400);
    }

    const [currentRaw, accounts] = await Promise.all([
      prisma.account.findFirst({
        where: { id, organizationId: orgId },
        select: {
          ...accountRuleSelect,
          journalLines: {
            where: { entry: { status: 'POSTED' } },
            select: { id: true },
            take: 1,
          },
        },
      }),
      prisma.account.findMany({
        where: { organizationId: orgId },
        select: accountRuleSelect,
      }),
    ]);

    if (!currentRaw) return err('Not found', 404);

    const current = {
      ...currentRaw,
      type: fromPrismaAccountType(currentRaw.type),
      normalSide: fromPrismaNormalSide(currentRaw.normalSide),
      hasPostings: currentRaw.hasPostings || currentRaw.journalLines.length > 0,
    };
    const validationAccounts = accounts.map((account) => ({
      ...account,
      type: fromPrismaAccountType(account.type),
      normalSide: fromPrismaNormalSide(account.normalSide),
    }));

    const payload = parsed.data;
    const nextType = payload.type ?? current.type;
    const nextParentId = payload.parentId === undefined ? current.parentId : (payload.parentId ?? null);
    const normalSide = getNormalSideByType(nextType);

    const nextAccount = {
      id: current.id,
      code: payload.code ?? current.code,
      name: payload.name ?? current.name,
      type: nextType,
      parentId: nextParentId,
      isPostable: payload.isPostable ?? current.isPostable,
      isActive: payload.isActive ?? current.isActive,
      reportGroup: payload.reportGroup ?? current.reportGroup,
      reportSubGroup: payload.reportSubGroup === undefined ? current.reportSubGroup : (payload.reportSubGroup || null),
      normalSide,
    };

    const errors = validateAccountState(nextAccount, validationAccounts, current);
    if (Object.keys(errors).length > 0) {
      return err(Object.values(errors)[0], 400);
    }

    const account = await prisma.account.update({
      where: { id, organizationId: orgId },
      data: {
        ...nextAccount,
        type: toPrismaAccountType(nextAccount.type) as AccountType,
        normalSide: toPrismaNormalSide(nextAccount.normalSide) as NormalSide,
        level: getAccountLevel(nextAccount.parentId, validationAccounts),
        updatedAt: new Date(),
      },
    });

    logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Account', entityId: id, action: 'UPDATE', payload: body });
    return ok(account);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return err('Account code must be unique.', 409);
    }

    const message = error instanceof Error ? error.message : 'Failed to update account';
    return err(message, 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return err('Unauthenticated', 401);
  // Verify ownership before checking for children
  const account = await prisma.account.findFirst({ where: { id, organizationId: orgId } });
  if (!account) return err('Not found', 404);
  const [childCount, journalLineCount] = await Promise.all([
    prisma.account.count({ where: { parentId: id, organizationId: orgId } }),
    prisma.journalLine.count({ where: { accountId: id } }),
  ]);
  if (childCount > 0) return err('Cannot delete account with sub-accounts', 400);
  if (journalLineCount > 0) return err('Cannot delete account that is referenced by journal entries', 400);
  await prisma.account.delete({ where: { id, organizationId: orgId } });
  logAudit({ orgId, actorId: req.headers.get('x-user-id'), entityType: 'Account', entityId: id, action: 'DELETE', payload: null });
  return ok({ deleted: true });
}

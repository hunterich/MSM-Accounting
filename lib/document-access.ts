import { prisma as defaultPrisma } from '@/lib/prisma';

export class AccessError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function getInvoiceAccessContext(
  orgId: string,
  userId: string,
  prisma = defaultPrisma,
) {
  const membership = await prisma.userOrganization.findFirst({
    where: {
      organizationId: orgId,
      userId,
      isActive: true,
    },
    select: {
      role: {
        select: {
          roleType: true,
          invoiceAccessScope: true,
        },
      },
    },
  });

  if (!membership) {
    throw new AccessError('Membership not found', 403);
  }

  return {
    userId,
    orgId,
    roleType: membership.role.roleType,
    invoiceAccessScope: membership.role.roleType === 'ADMIN'
      ? 'ALL'
      : membership.role.invoiceAccessScope ?? 'ALL',
  };
}

export function applyInvoiceAccessScope<T extends Record<string, unknown>>(
  where: T,
  access: { invoiceAccessScope: string; userId: string },
) {
  if (access.invoiceAccessScope !== 'OWN') {
    return where;
  }

  return {
    ...where,
    createdById: access.userId,
  };
}

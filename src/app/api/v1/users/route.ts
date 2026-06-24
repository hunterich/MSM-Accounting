import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, err, withHandler, requireOrg } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';

export const runtime = 'nodejs';

export function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  if (req.headers.get('x-role-type') !== 'ADMIN') return err('Forbidden: ADMIN role required', 403);
  const orgId = requireOrg(req);

  const memberships = await prisma.userOrganization.findMany({
    where: { organizationId: orgId, isActive: true },
    include: {
      user: { select: { id: true, fullName: true, email: true, status: true } },
      role: { select: { name: true } },
    },
    orderBy: { joinedAt: 'asc' },
  });

  const data = memberships.map((m) => ({
    id: m.user.id,
    fullName: m.user.fullName,
    email: m.user.email,
    status: m.user.status,
    roleName: m.role.name,
  }));

  return ok({ data });
});

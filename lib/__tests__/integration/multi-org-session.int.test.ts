/**
 * Phase-1 multi-company session tests: ONE user with ACTIVE memberships in TWO
 * orgs, driven against a real Postgres `<db>_test` database.
 *
 * Integration tests bypass the Next middleware, so the middleware contract is
 * covered through the pure `resolveActiveOrg` helper directly, and the routes
 * are driven the way tenant-isolation-cross-org.int.test.ts drives them — with
 * the trusted headers the middleware would have stamped:
 *
 *   - resolveActiveOrg picks the requested org's roleType from the signed list
 *     and 403s (ORG_MEMBERSHIP) for an org outside it.
 *   - The customers GET handler scoped to org A returns only org A's rows, and
 *     scoped to org B only org B's — same user id header both times.
 *   - POST /auth/refresh re-reads ACTIVE memberships from the DB off the signed
 *     cookie and returns both orgs (plus a fresh msm_token cookie).
 *
 * Run with:  npm run test:int -- multi-org-session
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import {
  prisma,
  createTestOrg,
  createCustomer,
  cleanupOrg,
  disconnect,
} from './harness';
import { resolveActiveOrg, signToken, verifyToken, COOKIE_NAME, type TokenPayload } from '../../auth';
import { GET as listCustomers } from '../../../src/app/api/v1/customers/route';
import { POST as refreshSession } from '../../../src/app/api/v1/auth/refresh/route';

// signToken/verifyToken read JWT_SECRET from the environment; .env normally
// provides it (loaded by Prisma's dotenv), but keep the test deterministic.
process.env.JWT_SECRET ??= 'integration-test-secret-at-least-32-chars!!';

afterAll(async () => {
  await disconnect();
});

/** Seed one user with ACTIVE memberships in both orgs: ADMIN in A, VIEWER in B. */
async function seedTwoOrgUser(orgAId: string, orgBId: string) {
  const roleA = await prisma.role.create({
    data: { organizationId: orgAId, name: `ADMIN-${randomUUID()}`, roleType: 'ADMIN' },
    select: { id: true },
  });
  const roleB = await prisma.role.create({
    data: { organizationId: orgBId, name: `VIEWER-${randomUUID()}`, roleType: 'VIEWER' },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: {
      email: `multi-${randomUUID()}@test.local`,
      fullName: 'Multi Org User',
      passwordHash: 'x',
      status: 'ACTIVE',
    },
    select: { id: true, email: true },
  });
  await prisma.userOrganization.create({
    data: { userId: user.id, organizationId: orgAId, roleId: roleA.id, isActive: true },
  });
  await prisma.userOrganization.create({
    data: { userId: user.id, organizationId: orgBId, roleId: roleB.id, isActive: true },
  });
  return user;
}

function tokenPayloadFor(user: { id: string; email: string }, orgAId: string, orgBId: string): TokenPayload {
  return {
    userId: user.id,
    email: user.email,
    memberships: [
      { orgId: orgAId, roleType: 'ADMIN' },
      { orgId: orgBId, roleType: 'VIEWER' },
    ],
  };
}

function customersRequest(orgId: string, userId: string, roleType: string): NextRequest {
  return new NextRequest('http://localhost/api/v1/customers', {
    method: 'GET',
    // The headers the middleware would have stamped after resolveActiveOrg.
    headers: { 'x-org-id': orgId, 'x-user-id': userId, 'x-role-type': roleType },
  });
}

describe('multi-org session (two orgs, one cookie)', () => {
  it('resolveActiveOrg honours the membership list and rejects outsiders', async () => {
    const orgA = await createTestOrg();
    const orgB = await createTestOrg();
    try {
      const user = await seedTwoOrgUser(orgA.orgId, orgB.orgId);
      const payload = tokenPayloadFor(user, orgA.orgId, orgB.orgId);

      expect(resolveActiveOrg(payload, orgB.orgId)).toEqual({
        ok: true,
        orgId: orgB.orgId,
        roleType: 'VIEWER',
      });

      expect(resolveActiveOrg(payload, 'org-c')).toEqual({
        ok: false,
        status: 403,
        error: 'Not a member of this organization',
        code: 'ORG_MEMBERSHIP',
      });
    } finally {
      await cleanupOrg(orgA.orgId);
      await cleanupOrg(orgB.orgId);
    }
  });

  it('the same user sees only the active org\'s customers per request', async () => {
    const orgA = await createTestOrg();
    const orgB = await createTestOrg();
    try {
      const user = await seedTwoOrgUser(orgA.orgId, orgB.orgId);
      const customerA = await createCustomer(orgA.orgId);
      const customerB = await createCustomer(orgB.orgId);

      const resA = await listCustomers(customersRequest(orgA.orgId, user.id, 'ADMIN'));
      expect(resA.status).toBe(200);
      const bodyA = (await resA.json()) as { data: Array<{ id: string }> };
      const idsA = bodyA.data.map((c) => c.id);
      expect(idsA).toContain(customerA);
      expect(idsA).not.toContain(customerB);

      const resB = await listCustomers(customersRequest(orgB.orgId, user.id, 'VIEWER'));
      expect(resB.status).toBe(200);
      const bodyB = (await resB.json()) as { data: Array<{ id: string }> };
      const idsB = bodyB.data.map((c) => c.id);
      expect(idsB).toContain(customerB);
      expect(idsB).not.toContain(customerA);
    } finally {
      await cleanupOrg(orgA.orgId);
      await cleanupOrg(orgB.orgId);
    }
  });

  it('POST /auth/refresh returns both memberships off the signed cookie', async () => {
    const orgA = await createTestOrg();
    const orgB = await createTestOrg();
    try {
      const user = await seedTwoOrgUser(orgA.orgId, orgB.orgId);
      const token = await signToken(tokenPayloadFor(user, orgA.orgId, orgB.orgId));

      const res = await refreshSession(
        new NextRequest('http://localhost/api/v1/auth/refresh', {
          method: 'POST',
          headers: { cookie: `${COOKIE_NAME}=${token}` },
        }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        memberships: Array<{ orgId: string; name: string; roleType: string }>;
      };
      const byOrg = new Map(body.memberships.map((m) => [m.orgId, m]));
      expect(byOrg.get(orgA.orgId)?.roleType).toBe('ADMIN');
      expect(byOrg.get(orgB.orgId)?.roleType).toBe('VIEWER');

      // A fresh cookie is re-issued.
      expect(res.headers.get('set-cookie')).toContain(`${COOKIE_NAME}=`);
    } finally {
      await cleanupOrg(orgA.orgId);
      await cleanupOrg(orgB.orgId);
    }
  });

  it('POST /auth/refresh rejects a missing or garbage cookie with 401', async () => {
    const noCookie = await refreshSession(
      new NextRequest('http://localhost/api/v1/auth/refresh', { method: 'POST' }),
    );
    expect(noCookie.status).toBe(401);

    const garbage = await refreshSession(
      new NextRequest('http://localhost/api/v1/auth/refresh', {
        method: 'POST',
        headers: { cookie: `${COOKIE_NAME}=not.a.valid.jwt` },
      }),
    );
    expect(garbage.status).toBe(401);
  });

  it('POST /auth/refresh drops a deactivated membership from the response AND the re-signed token', async () => {
    const orgA = await createTestOrg();
    const orgB = await createTestOrg();
    try {
      const user = await seedTwoOrgUser(orgA.orgId, orgB.orgId);
      const token = await signToken(tokenPayloadFor(user, orgA.orgId, orgB.orgId));

      // Revoke access to org B after the token was signed.
      await prisma.userOrganization.updateMany({
        where: { userId: user.id, organizationId: orgB.orgId },
        data: { isActive: false },
      });

      const res = await refreshSession(
        new NextRequest('http://localhost/api/v1/auth/refresh', {
          method: 'POST',
          headers: { cookie: `${COOKIE_NAME}=${token}` },
        }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        memberships: Array<{ orgId: string; name: string; roleType: string }>;
      };
      expect(body.memberships.map((m) => m.orgId)).toEqual([orgA.orgId]);

      // The re-signed cookie no longer carries the revoked org either.
      const setCookie = res.headers.get('set-cookie') ?? '';
      const freshToken = setCookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))?.[1];
      expect(freshToken).toBeTruthy();
      const freshPayload = await verifyToken(freshToken!);
      expect(freshPayload).not.toBeNull();
      expect(freshPayload!.memberships.map((m) => m.orgId)).toEqual([orgA.orgId]);
    } finally {
      await cleanupOrg(orgA.orgId);
      await cleanupOrg(orgB.orgId);
    }
  });
});

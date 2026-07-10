/**
 * Phase-4 per-company access tests: the membership endpoints that let an admin
 * grant/revoke a user's access to the ACTIVE company, driven against a real
 * Postgres `<db>_test` database.
 *
 * Integration tests bypass the Next middleware, so the routes are driven the way
 * the rest of the suite drives them — with the trusted `x-org-id`/`x-user-id`/
 * `x-role-type` headers the middleware would have stamped after resolveActiveOrg.
 * `x-role-type: ADMIN` bypasses withPermission's per-module RBAC lookup.
 *
 * Coverage (two-org seed):
 *   (a) POST in org-A referencing org-B's roleId → 404, nothing created.
 *   (b) happy-path invite → membership active AND /auth/refresh now returns both
 *       orgs for the invitee.
 *   (c) re-invite an already-active member → 409.
 *   (d) invite a nonexistent email → 404.
 *   (e) DELETE → membership isActive:false (soft delete).
 *   (f) DELETE the only ADMIN → 422 and the membership is untouched.
 *   (g) DELETE a membership id belonging to ANOTHER org → 404, untouched.
 *
 * Run with:  npm run test:int -- memberships-admin
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import { signToken, COOKIE_NAME, type TokenPayload } from '../../auth';
import { POST as addMembership } from '../../../src/app/api/v1/users/memberships/route';
import { DELETE as removeMembership } from '../../../src/app/api/v1/users/memberships/[id]/route';
import { POST as refreshSession } from '../../../src/app/api/v1/auth/refresh/route';

// signToken/verifyToken read JWT_SECRET from the environment; .env normally
// provides it (loaded by Prisma's dotenv), but keep the test deterministic.
process.env.JWT_SECRET ??= 'integration-test-secret-at-least-32-chars!!';

afterAll(async () => {
  await disconnect();
});

/** An ADMIN role + an admin user + their active membership in the given org. */
async function seedAdmin(orgId: string) {
  const role = await prisma.role.create({
    data: { organizationId: orgId, name: `ADMIN-${randomUUID()}`, roleType: 'ADMIN' },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: { email: `admin-${randomUUID()}@test.local`, fullName: 'Org Admin', passwordHash: 'x', status: 'ACTIVE' },
    select: { id: true, email: true },
  });
  const membership = await prisma.userOrganization.create({
    data: { userId: user.id, organizationId: orgId, roleId: role.id, isActive: true },
    select: { id: true },
  });
  return { roleId: role.id, userId: user.id, email: user.email, membershipId: membership.id };
}

/** A non-admin role in the given org (used as the invite target role). */
async function seedRole(orgId: string, roleType: 'ACCOUNTANT' | 'VIEWER' = 'ACCOUNTANT') {
  const role = await prisma.role.create({
    data: { organizationId: orgId, name: `${roleType}-${randomUUID()}`, roleType },
    select: { id: true },
  });
  return role.id;
}

/** A standalone user with no memberships (an invitee). */
async function seedUser() {
  const user = await prisma.user.create({
    data: { email: `invitee-${randomUUID()}@test.local`, fullName: 'Invitee', passwordHash: 'x', status: 'ACTIVE' },
    select: { id: true, email: true },
  });
  return user;
}

/**
 * A NON-admin actor whose CUSTOM role holds SETTINGS.canEdit — enough to pass
 * withPermission(SETTINGS.edit) but NOT enough to grant an admin-capable role.
 */
async function seedSettingsEditor(orgId: string) {
  const role = await prisma.role.create({
    data: {
      organizationId: orgId,
      name: `SETTINGS-EDITOR-${randomUUID()}`,
      roleType: 'CUSTOM',
      permissions: {
        create: [
          { moduleKey: 'SETTINGS', canView: true, canCreate: false, canEdit: true, canDelete: false, canApprove: false },
        ],
      },
    },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: { email: `editor-${randomUUID()}@test.local`, fullName: 'Settings Editor', passwordHash: 'x', status: 'ACTIVE' },
    select: { id: true },
  });
  await prisma.userOrganization.create({
    data: { userId: user.id, organizationId: orgId, roleId: role.id, isActive: true },
  });
  return { userId: user.id, roleId: role.id };
}

function addRequest(orgId: string, actorId: string, body: unknown, roleType = 'ADMIN'): NextRequest {
  return new NextRequest('http://localhost/api/v1/users/memberships', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': orgId,
      'x-user-id': actorId,
      'x-role-type': roleType,
    },
    body: JSON.stringify(body),
  });
}

function deleteRequest(orgId: string, actorId: string): NextRequest {
  return new NextRequest('http://localhost/api/v1/users/memberships/x', {
    method: 'DELETE',
    headers: { 'x-org-id': orgId, 'x-user-id': actorId, 'x-role-type': 'ADMIN' },
  });
}

describe('POST /api/v1/users/memberships', () => {
  it('(a) rejects a roleId from another org (404) and creates nothing', async () => {
    const orgA = await createTestOrg();
    const orgB = await createTestOrg();
    try {
      const adminA = await seedAdmin(orgA.orgId);
      const roleB = await seedRole(orgB.orgId); // org B's role
      const invitee = await seedUser();

      const res = await addMembership(addRequest(orgA.orgId, adminA.userId, { email: invitee.email, roleId: roleB }));
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Role not found');

      // No membership was created for the invitee anywhere.
      expect(await prisma.userOrganization.count({ where: { userId: invitee.id } })).toBe(0);
    } finally {
      await cleanupOrg(orgA.orgId);
      await cleanupOrg(orgB.orgId);
    }
  });

  it('(b) happy-path invite makes the membership active and refresh returns both orgs', async () => {
    const orgA = await createTestOrg();
    const orgB = await createTestOrg();
    try {
      const adminA = await seedAdmin(orgA.orgId);
      // The invitee is already an admin of org B, and gets added to org A.
      const adminB = await seedAdmin(orgB.orgId);
      const roleA = await seedRole(orgA.orgId);

      const res = await addMembership(addRequest(orgA.orgId, adminA.userId, { email: adminB.email, roleId: roleA }));
      expect(res.status).toBe(201);

      const membership = await prisma.userOrganization.findUnique({
        where: { userId_organizationId: { userId: adminB.userId, organizationId: orgA.orgId } },
        select: { isActive: true, roleId: true },
      });
      expect(membership).toMatchObject({ isActive: true, roleId: roleA });

      // The invitee's refresh handler now re-reads BOTH orgs off the signed cookie.
      const token = await signToken({
        userId: adminB.userId,
        email: adminB.email,
        // Cookie still predates the org-A grant — refresh re-reads from the DB.
        memberships: [{ orgId: orgB.orgId, roleType: 'ADMIN' }],
      } as TokenPayload);
      const refresh = await refreshSession(
        new NextRequest('http://localhost/api/v1/auth/refresh', {
          method: 'POST',
          headers: { cookie: `${COOKIE_NAME}=${token}` },
        }),
      );
      expect(refresh.status).toBe(200);
      const refreshBody = (await refresh.json()) as { memberships: Array<{ orgId: string }> };
      expect(refreshBody.memberships.map((m) => m.orgId).sort()).toEqual([orgA.orgId, orgB.orgId].sort());
    } finally {
      await cleanupOrg(orgA.orgId);
      await cleanupOrg(orgB.orgId);
    }
  });

  it('(b2) reactivates a previously-removed membership with the new role', async () => {
    const orgA = await createTestOrg();
    try {
      const adminA = await seedAdmin(orgA.orgId);
      const invitee = await seedUser();
      const oldRole = await seedRole(orgA.orgId, 'VIEWER');
      const newRole = await seedRole(orgA.orgId, 'ACCOUNTANT');

      // A pre-existing INACTIVE membership (previously removed).
      const stale = await prisma.userOrganization.create({
        data: { userId: invitee.id, organizationId: orgA.orgId, roleId: oldRole, isActive: false },
        select: { id: true },
      });

      const res = await addMembership(addRequest(orgA.orgId, adminA.userId, { email: invitee.email, roleId: newRole }));
      expect(res.status).toBe(201);

      const rows = await prisma.userOrganization.findMany({ where: { userId: invitee.id, organizationId: orgA.orgId } });
      expect(rows).toHaveLength(1); // reactivated in place, not a duplicate row
      expect(rows[0]).toMatchObject({ id: stale.id, isActive: true, roleId: newRole });
    } finally {
      await cleanupOrg(orgA.orgId);
    }
  });

  it('(c) re-inviting an active member returns 409', async () => {
    const orgA = await createTestOrg();
    try {
      const adminA = await seedAdmin(orgA.orgId);
      const invitee = await seedUser();
      const role = await seedRole(orgA.orgId);
      await prisma.userOrganization.create({
        data: { userId: invitee.id, organizationId: orgA.orgId, roleId: role, isActive: true },
      });

      const res = await addMembership(addRequest(orgA.orgId, adminA.userId, { email: invitee.email, roleId: role }));
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('User is already a member');
    } finally {
      await cleanupOrg(orgA.orgId);
    }
  });

  it('(d) inviting a nonexistent email returns 404', async () => {
    const orgA = await createTestOrg();
    try {
      const adminA = await seedAdmin(orgA.orgId);
      const role = await seedRole(orgA.orgId);

      const res = await addMembership(
        addRequest(orgA.orgId, adminA.userId, { email: `ghost-${randomUUID()}@nowhere.test`, roleId: role }),
      );
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('User not found');
    } finally {
      await cleanupOrg(orgA.orgId);
    }
  });

  it('(h) a non-admin SETTINGS-editor cannot grant the ADMIN role (403), but can grant a non-admin role (201)', async () => {
    const orgA = await createTestOrg();
    try {
      const editor = await seedSettingsEditor(orgA.orgId); // CUSTOM actor with SETTINGS.edit
      const adminRoleId = (await seedAdmin(orgA.orgId)).roleId; // an ADMIN role in this org
      const invitee = await seedUser();

      // Escalation attempt: grant the org's ADMIN role → blocked before any write.
      const blocked = await addMembership(
        addRequest(orgA.orgId, editor.userId, { email: invitee.email, roleId: adminRoleId }, 'CUSTOM'),
      );
      expect(blocked.status).toBe(403);
      const blockedBody = (await blocked.json()) as { error: string };
      expect(blockedBody.error).toBe('Only an administrator can assign an admin-level role');
      expect(await prisma.userOrganization.count({ where: { userId: invitee.id } })).toBe(0);

      // The guard is targeted, not a blanket block: the same actor may grant a
      // plain non-admin role.
      const nonAdminRoleId = await seedRole(orgA.orgId);
      const allowed = await addMembership(
        addRequest(orgA.orgId, editor.userId, { email: invitee.email, roleId: nonAdminRoleId }, 'CUSTOM'),
      );
      expect(allowed.status).toBe(201);
      const membership = await prisma.userOrganization.findUnique({
        where: { userId_organizationId: { userId: invitee.id, organizationId: orgA.orgId } },
        select: { isActive: true, roleId: true },
      });
      expect(membership).toMatchObject({ isActive: true, roleId: nonAdminRoleId });
    } finally {
      await cleanupOrg(orgA.orgId);
    }
  });

  it('(i) the escalation guard also fires when REACTIVATING an inactive membership with the ADMIN role (403)', async () => {
    const orgA = await createTestOrg();
    try {
      const editor = await seedSettingsEditor(orgA.orgId);
      const adminRoleId = (await seedAdmin(orgA.orgId)).roleId;
      const invitee = await seedUser();
      const oldRole = await seedRole(orgA.orgId, 'VIEWER');
      // A previously-removed membership the escalation could try to reactivate-as-admin.
      const stale = await prisma.userOrganization.create({
        data: { userId: invitee.id, organizationId: orgA.orgId, roleId: oldRole, isActive: false },
        select: { id: true },
      });

      const res = await addMembership(
        addRequest(orgA.orgId, editor.userId, { email: invitee.email, roleId: adminRoleId }, 'CUSTOM'),
      );
      expect(res.status).toBe(403);

      // Blocked before the reactivation update — the stale membership is untouched.
      const after = await prisma.userOrganization.findUnique({
        where: { id: stale.id },
        select: { isActive: true, roleId: true },
      });
      expect(after).toMatchObject({ isActive: false, roleId: oldRole });
    } finally {
      await cleanupOrg(orgA.orgId);
    }
  });
});

describe('DELETE /api/v1/users/memberships/[id]', () => {
  it('(e) soft-deletes a non-admin membership (isActive:false)', async () => {
    const orgA = await createTestOrg();
    try {
      const adminA = await seedAdmin(orgA.orgId);
      const invitee = await seedUser();
      const role = await seedRole(orgA.orgId);
      const membership = await prisma.userOrganization.create({
        data: { userId: invitee.id, organizationId: orgA.orgId, roleId: role, isActive: true },
        select: { id: true },
      });

      const res = await removeMembership(deleteRequest(orgA.orgId, adminA.userId), {
        params: Promise.resolve({ id: membership.id }),
      });
      expect(res.status).toBe(200);

      const after = await prisma.userOrganization.findUnique({ where: { id: membership.id }, select: { isActive: true } });
      expect(after?.isActive).toBe(false);
    } finally {
      await cleanupOrg(orgA.orgId);
    }
  });

  it('(f) refuses to remove the only ADMIN (422) and leaves it untouched', async () => {
    const orgA = await createTestOrg();
    try {
      const adminA = await seedAdmin(orgA.orgId);

      const res = await removeMembership(deleteRequest(orgA.orgId, adminA.userId), {
        params: Promise.resolve({ id: adminA.membershipId }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Cannot remove the last administrator');

      const after = await prisma.userOrganization.findUnique({
        where: { id: adminA.membershipId },
        select: { isActive: true },
      });
      expect(after?.isActive).toBe(true);
    } finally {
      await cleanupOrg(orgA.orgId);
    }
  });

  it('(f2) removes an ADMIN when another active ADMIN remains', async () => {
    const orgA = await createTestOrg();
    try {
      const adminOne = await seedAdmin(orgA.orgId);
      const adminTwo = await seedAdmin(orgA.orgId);

      const res = await removeMembership(deleteRequest(orgA.orgId, adminOne.userId), {
        params: Promise.resolve({ id: adminTwo.membershipId }),
      });
      expect(res.status).toBe(200);
      const after = await prisma.userOrganization.findUnique({
        where: { id: adminTwo.membershipId },
        select: { isActive: true },
      });
      expect(after?.isActive).toBe(false);
    } finally {
      await cleanupOrg(orgA.orgId);
    }
  });

  it('(g) rejects a membership id owned by another org (404) and leaves it untouched', async () => {
    const orgA = await createTestOrg();
    const orgB = await createTestOrg();
    try {
      const adminA = await seedAdmin(orgA.orgId);
      const invitee = await seedUser();
      const roleB = await seedRole(orgB.orgId);
      // A membership that belongs to org B.
      const membershipB = await prisma.userOrganization.create({
        data: { userId: invitee.id, organizationId: orgB.orgId, roleId: roleB, isActive: true },
        select: { id: true },
      });

      // Caller scoped to org A tries to delete org B's membership.
      const res = await removeMembership(deleteRequest(orgA.orgId, adminA.userId), {
        params: Promise.resolve({ id: membershipB.id }),
      });
      expect(res.status).toBe(404);

      const after = await prisma.userOrganization.findUnique({ where: { id: membershipB.id }, select: { isActive: true } });
      expect(after?.isActive).toBe(true);
    } finally {
      await cleanupOrg(orgA.orgId);
      await cleanupOrg(orgB.orgId);
    }
  });

  it('(j) two concurrent removals of the two remaining admins → exactly one wins, an admin survives', async () => {
    const orgA = await createTestOrg();
    try {
      const adminOne = await seedAdmin(orgA.orgId);
      const adminTwo = await seedAdmin(orgA.orgId);

      // Fire both removals at once. Without the per-org advisory lock both would
      // see the OTHER admin still active and both pass, zeroing out admins.
      const [res1, res2] = await Promise.all([
        removeMembership(deleteRequest(orgA.orgId, adminOne.userId), {
          params: Promise.resolve({ id: adminOne.membershipId }),
        }),
        removeMembership(deleteRequest(orgA.orgId, adminTwo.userId), {
          params: Promise.resolve({ id: adminTwo.membershipId }),
        }),
      ]);

      // Exactly one 200 and one 422 — the guard serialized them.
      expect([res1.status, res2.status].sort()).toEqual([200, 422]);

      // At least one active ADMIN membership remains (in fact exactly one).
      const activeAdmins = await prisma.userOrganization.count({
        where: { organizationId: orgA.orgId, isActive: true, role: { roleType: 'ADMIN' } },
      });
      expect(activeAdmins).toBe(1);
    } finally {
      await cleanupOrg(orgA.orgId);
    }
  });
});

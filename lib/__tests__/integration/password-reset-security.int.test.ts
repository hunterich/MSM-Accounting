import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import { hashPassword, comparePassword } from '../../password';
import { COOKIE_NAME, credentialStamp, signToken, verifyToken } from '../../auth';
import { middleware } from '../../../src/middleware';
import { POST as reset } from '../../../src/app/api/v1/users/[id]/reset-password/route';
import { POST as change } from '../../../src/app/api/v1/users/me/password/route';
import { GET as me } from '../../../src/app/api/v1/auth/me/route';
import { POST as refresh } from '../../../src/app/api/v1/auth/refresh/route';

process.env.JWT_SECRET = 'integration-password-security-secret';
let orgA: Awaited<ReturnType<typeof createTestOrg>>;
let orgB: Awaited<ReturnType<typeof createTestOrg>>;
let adminId: string;
let editorId: string;
let roleA: string;
let roleB: string;
const users: string[] = [];

async function makeUser(orgId: string, roleId: string) {
  const user = await prisma.user.create({ data: {
    email: `password-${randomUUID()}@test.local`, fullName: 'Password test',
    passwordHash: await hashPassword('original123'),
  } });
  users.push(user.id);
  await prisma.userOrganization.create({ data: { userId: user.id, organizationId: orgId, roleId } });
  return user;
}

beforeAll(async () => {
  orgA = await createTestOrg();
  orgB = await createTestOrg();
  const adminRole = await prisma.role.create({ data: { organizationId: orgA.orgId, name: 'Administrator', roleType: 'ADMIN' } });
  const editorRole = await prisma.role.create({ data: {
    organizationId: orgA.orgId, name: 'Settings editor', roleType: 'CUSTOM',
    permissions: { create: [{ moduleKey: 'SETTINGS', canEdit: true }] },
  } });
  roleA = (await prisma.role.create({ data: { organizationId: orgA.orgId, name: 'Staff', roleType: 'VIEWER' } })).id;
  roleB = (await prisma.role.create({ data: { organizationId: orgB.orgId, name: 'Staff', roleType: 'VIEWER' } })).id;
  adminId = (await makeUser(orgA.orgId, adminRole.id)).id;
  editorId = (await makeUser(orgA.orgId, editorRole.id)).id;
});

afterAll(async () => {
  if (orgA) await cleanupOrg(orgA.orgId);
  if (orgB) await cleanupOrg(orgB.orgId);
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await disconnect();
});

function resetRequest(target: string, actor = adminId, role = 'ADMIN') {
  return new NextRequest(`http://localhost/api/v1/users/${target}/reset-password`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-org-id': orgA.orgId, 'x-user-id': actor, 'x-role-type': role },
    body: JSON.stringify({ newPassword: 'temporary123' }),
  });
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const cookieRequest = (path: string, token: string, method = 'GET') => new NextRequest(`http://localhost/api/v1/${path}`, {
  method, headers: { cookie: `${COOKIE_NAME}=${token}`, 'x-active-org': orgA.orgId },
});
async function tokenFor(user: { id: string; email: string; passwordHash: string | null }) {
  return signToken({ userId: user.id, email: user.email, credentialStamp: credentialStamp(user.passwordHash),
    memberships: [{ orgId: orgA.orgId, roleType: 'VIEWER' }] });
}

describe('password reset security with PostgreSQL', () => {
  it('rejects a settings editor and active or inactive cross-company memberships', async () => {
    const user = await makeUser(orgA.orgId, roleA);
    expect((await reset(resetRequest(user.id, editorId, 'CUSTOM'), context(user.id))).status).toBe(403);
    const membership = await prisma.userOrganization.create({ data: { userId: user.id, organizationId: orgB.orgId, roleId: roleB } });
    expect((await reset(resetRequest(user.id), context(user.id))).status).toBe(403);
    await prisma.userOrganization.update({ where: { id: membership.id }, data: { isActive: false } });
    expect((await reset(resetRequest(user.id), context(user.id))).status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(user.passwordHash);
  });

  it('commits the audit and password together and revokes old sessions at every entry point', async () => {
    const user = await makeUser(orgA.orgId, roleA);
    const oldToken = await tokenFor(user);
    expect((await reset(resetRequest(user.id), context(user.id))).status).toBe(200);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.mustChangePassword).toBe(true);
    expect(await comparePassword('temporary123', updated.passwordHash!)).toBe(true);
    expect(await prisma.auditLog.count({ where: { organizationId: orgA.orgId, entityId: user.id, action: 'RESET_PASSWORD' } })).toBe(1);
    expect((await middleware(cookieRequest('customers', oldToken))).status).toBe(401);
    expect((await me(cookieRequest('auth/me', oldToken))).status).toBe(401);
    expect((await refresh(cookieRequest('auth/refresh', oldToken, 'POST'))).status).toBe(401);
  });

  it('rolls back the password if the audit insert fails', async () => {
    const user = await makeUser(orgA.orgId, roleA);
    const response = await reset(resetRequest(user.id, 'missing-actor'), context(user.id));
    expect(response.status).toBe(500);
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(unchanged.passwordHash).toBe(user.passwordHash);
    expect(unchanged.mustChangePassword).toBe(false);
    expect(await prisma.auditLog.count({ where: { entityId: user.id, action: 'RESET_PASSWORD' } })).toBe(0);
  });

  it('waits for a concurrent membership insert and refuses the reset', async () => {
    const user = await makeUser(orgA.orgId, roleA);
    let inserted!: () => void;
    let release!: () => void;
    const ready = new Promise<void>(resolve => { inserted = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const adding = prisma.$transaction(async tx => {
      await tx.userOrganization.create({ data: { userId: user.id, organizationId: orgB.orgId, roleId: roleB } });
      inserted();
      await gate;
    });
    await ready;
    const resetting = reset(resetRequest(user.id), context(user.id));
    let observedWait = false;
    try {
      for (let i = 0; i < 100; i++) {
        const waiting = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE '%SELECT id FROM "User"%FOR UPDATE%'`;
        if (Number(waiting[0].count) > 0) { observedWait = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    } finally {
      release();
      await adding;
    }
    expect(observedWait).toBe(true);
    expect((await resetting).status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(user.passwordHash);
  });

  it('reissues only the changing user’s session after a self-service change', async () => {
    const user = await makeUser(orgA.orgId, roleA);
    const oldToken = await tokenFor(user);
    const req = new NextRequest('http://localhost/api/v1/users/me/password', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: `${COOKIE_NAME}=${oldToken}`,
        'x-org-id': orgA.orgId, 'x-user-id': user.id, 'x-role-type': 'VIEWER' },
      body: JSON.stringify({ currentPassword: 'original123', newPassword: 'new-password123' }),
    });
    const response = await change(req);
    expect(response.status).toBe(200);
    const fresh = response.cookies.get(COOKIE_NAME)?.value;
    expect(fresh).toBeTruthy();
    const userAfter = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect((await verifyToken(fresh!))?.credentialStamp).toBe(credentialStamp(userAfter.passwordHash));
    expect((await refresh(cookieRequest('auth/refresh', oldToken, 'POST'))).status).toBe(401);
    expect((await refresh(cookieRequest('auth/refresh', fresh!, 'POST'))).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { entityId: user.id, action: 'CHANGE_PASSWORD' } })).toBe(1);
  });

  it('allows only one concurrent change using the same current password', async () => {
    const user = await makeUser(orgA.orgId, roleA);
    const oldToken = await tokenFor(user);
    const makeChange = (newPassword: string) => change(new NextRequest('http://localhost/api/v1/users/me/password', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: `${COOKIE_NAME}=${oldToken}`,
        'x-org-id': orgA.orgId, 'x-user-id': user.id, 'x-role-type': 'VIEWER' },
      body: JSON.stringify({ currentPassword: 'original123', newPassword }),
    }));
    const results = await Promise.all([makeChange('first-password123'), makeChange('second-password123')]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.auditLog.count({ where: { entityId: user.id, action: 'CHANGE_PASSWORD' } })).toBe(1);
  });
});

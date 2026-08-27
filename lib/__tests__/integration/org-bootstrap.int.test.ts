/**
 * Organization-bootstrap integration tests (real Postgres `<db>_test`).
 *
 * Covers the Phase-3 company-creation core:
 *   - `bootstrapOrganization` creates a complete, ready-to-post company:
 *     the standard COA (resolvable control accounts — ties into the C-3
 *     default-GL regression), warehouse WH-MAIN, the three template roles,
 *     twelve OPEN periods, and the creator's Admin membership.
 *   - The whole bootstrap rolls back atomically when the transaction fails.
 *   - `POST /api/v1/organizations` bootstraps for ADMIN callers and refuses
 *     everyone else without leaving a partial org behind.
 *
 * Run with:  npm run test:int -- org-bootstrap
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { prisma, cleanupOrg, disconnect } from './harness';
import {
  ALL_MODULE_KEYS,
  ROLE_TEMPLATES,
  STANDARD_CHILD_ACCOUNTS,
  STANDARD_ROOT_ACCOUNTS,
  bootstrapOrganization,
} from '../../organization/bootstrap';
import { resolveAccountDefaultId } from '../../account-defaults';
import { POST as createOrganization } from '../../../src/app/api/v1/organizations/route';

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

afterAll(async () => {
  for (const orgId of createdOrgIds) await cleanupOrg(orgId);
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
  await disconnect();
});

async function createCreatorUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({
    data: {
      email: `bootstrap-${randomUUID()}@test.local`,
      fullName: 'Bootstrap Creator',
      passwordHash: 'x',
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user;
}

/** Full completeness assertions shared by the library test and the route test. */
async function assertBootstrapComplete(orgId: string, creatorUserId: string): Promise<void> {
  // COA: exactly the standard template, roots summary-only, children postable.
  const accounts = await prisma.account.findMany({
    where: { organizationId: orgId },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true, parentId: true },
  });
  expect(accounts).toHaveLength(STANDARD_ROOT_ACCOUNTS.length + STANDARD_CHILD_ACCOUNTS.length);
  for (const root of STANDARD_ROOT_ACCOUNTS) {
    const acc = accounts.find((a) => a.code === root.code);
    expect(acc, `root account ${root.code}`).toBeTruthy();
    expect(acc!.isPostable).toBe(false);
    expect(acc!.parentId).toBeNull();
  }
  for (const child of STANDARD_CHILD_ACCOUNTS) {
    const acc = accounts.find((a) => a.code === child.code);
    expect(acc, `child account ${child.code}`).toBeTruthy();
    expect(acc!.isPostable).toBe(true);
    const parent = accounts.find((a) => a.code === child.parentCode);
    expect(acc!.parentId).toBe(parent!.id);
  }

  // Control accounts resolve with NO org overrides (C-3 regression tie-in):
  // AR control → 1-1200, output tax → 2-1100.
  const resolvable = accounts.map((a) => ({ ...a, type: String(a.type) }));
  const ar = accounts.find((a) => a.code === '1-1200')!;
  const tax = accounts.find((a) => a.code === '2-1100')!;
  expect(resolveAccountDefaultId(resolvable, undefined, 'arControl')).toBe(ar.id);
  expect(resolveAccountDefaultId(resolvable, undefined, 'arTax')).toBe(tax.id);

  // Default warehouse.
  const warehouses = await prisma.warehouse.findMany({ where: { organizationId: orgId } });
  expect(warehouses).toHaveLength(1);
  expect(warehouses[0]).toMatchObject({ code: 'WH-MAIN', name: 'Gudang Utama' });

  // Twelve OPEN periods named YYYY-MM.
  const periods = await prisma.accountingPeriod.findMany({
    where: { organizationId: orgId },
    orderBy: { startDate: 'asc' },
  });
  expect(periods).toHaveLength(12);
  for (const period of periods) {
    expect(period.status).toBe('OPEN');
    expect(period.name).toMatch(/^\d{4}-\d{2}$/);
  }

  // Three template roles; Admin has full rights incl. SYSTEM_BACKUP + SETTINGS.
  const roles = await prisma.role.findMany({
    where: { organizationId: orgId },
    include: { permissions: true },
  });
  expect(roles.map((r) => r.name).sort()).toEqual(
    [...ROLE_TEMPLATES.map((t) => t.name)].sort(),
  );
  const admin = roles.find((r) => r.roleType === 'ADMIN')!;
  expect(admin.name).toBe('Administrator');
  expect(admin.permissions).toHaveLength(ALL_MODULE_KEYS.length);
  for (const moduleKey of ['SYSTEM_BACKUP', 'SETTINGS'] as const) {
    const perm = admin.permissions.find((p) => p.moduleKey === moduleKey);
    expect(perm, `admin permission for ${moduleKey}`).toBeTruthy();
    expect(perm).toMatchObject({
      canView: true, canCreate: true, canEdit: true, canDelete: true, canApprove: true,
    });
  }

  // Exactly one ACTIVE membership for the creator, holding the Admin role.
  const memberships = await prisma.userOrganization.findMany({
    where: { organizationId: orgId },
    include: { role: { select: { roleType: true } } },
  });
  expect(memberships).toHaveLength(1);
  expect(memberships[0]).toMatchObject({ userId: creatorUserId, isActive: true });
  expect(memberships[0].role.roleType).toBe('ADMIN');
}

describe('bootstrapOrganization (shared seed template)', () => {
  it('creates a complete, ready-to-post company in one transaction', async () => {
    const user = await createCreatorUser();
    const { orgId } = await prisma.$transaction((tx) =>
      bootstrapOrganization(
        tx,
        { legalName: 'PT Bootstrap Integrasi', displayName: 'Bootstrap Integrasi' },
        user.id,
      ),
    );
    createdOrgIds.push(orgId);

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(org).toMatchObject({
      legalName: 'PT Bootstrap Integrasi',
      displayName: 'Bootstrap Integrasi',
      baseCurrency: 'IDR',
      timezone: 'Asia/Jakarta',
      isPkp: false,
    });

    await assertBootstrapComplete(orgId, user.id);

    // Default fiscal year: Jan..Dec of the current year.
    const periods = await prisma.accountingPeriod.findMany({
      where: { organizationId: orgId },
      orderBy: { startDate: 'asc' },
    });
    const year = new Date().getUTCFullYear();
    expect(periods.map((p) => p.name)).toEqual(
      Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`),
    );
  });

  it('honours a custom fiscalYearStart for the 12 periods', async () => {
    const user = await createCreatorUser();
    const { orgId } = await prisma.$transaction((tx) =>
      bootstrapOrganization(
        tx,
        {
          legalName: 'PT Fiskal Juli',
          displayName: 'Fiskal Juli',
          fiscalYearStart: new Date('2026-07-15T00:00:00.000Z'),
        },
        user.id,
      ),
    );
    createdOrgIds.push(orgId);

    const periods = await prisma.accountingPeriod.findMany({
      where: { organizationId: orgId },
      orderBy: { startDate: 'asc' },
    });
    expect(periods.map((p) => p.name)).toEqual([
      '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
      '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06',
    ]);
    expect(periods[0].startDate.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(periods[11].endDate.toISOString()).toBe('2027-06-30T23:59:59.999Z');
  });

  it('rolls back everything when the transaction fails mid-way', async () => {
    const user = await createCreatorUser();
    let orgId: string | null = null;

    await expect(
      prisma.$transaction(async (tx) => {
        const result = await bootstrapOrganization(
          tx,
          { legalName: 'PT Gagal Total', displayName: 'Gagal Total' },
          user.id,
        );
        orgId = result.orgId;
        throw new Error('forced mid-transaction failure');
      }),
    ).rejects.toThrow('forced mid-transaction failure');

    expect(orgId).toBeTruthy();
    expect(await prisma.organization.findUnique({ where: { id: orgId! } })).toBeNull();
    expect(await prisma.account.count({ where: { organizationId: orgId! } })).toBe(0);
    expect(await prisma.accountingPeriod.count({ where: { organizationId: orgId! } })).toBe(0);
    expect(await prisma.userOrganization.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('POST /api/v1/organizations', () => {
  function orgCreateRequest(
    body: unknown,
    headers: { orgId: string; userId: string; roleType: string },
  ): NextRequest {
    return new NextRequest('http://localhost/api/v1/organizations', {
      method: 'POST',
      // The trusted headers the middleware stamps after resolveActiveOrg.
      headers: {
        'content-type': 'application/json',
        'x-org-id': headers.orgId,
        'x-user-id': headers.userId,
        'x-role-type': headers.roleType,
      },
      body: JSON.stringify(body),
    });
  }

  /** The creator's existing org — company creation happens FROM an active org. */
  async function seedCallerOrg(userId: string): Promise<string> {
    const { orgId } = await prisma.$transaction((tx) =>
      bootstrapOrganization(
        tx,
        { legalName: `PT Caller ${randomUUID().slice(0, 6)}`, displayName: 'Caller Org' },
        userId,
      ),
    );
    createdOrgIds.push(orgId);
    return orgId;
  }

  it('ADMIN caller → 201 with a bootstrap-complete company', async () => {
    const user = await createCreatorUser();
    const callerOrgId = await seedCallerOrg(user.id);

    const res = await createOrganization(
      orgCreateRequest(
        { legalName: 'PT Uji Coba Route', displayName: 'Uji Coba Route', isPkp: true, npwp: '01.234.567.8-901.000' },
        { orgId: callerOrgId, userId: user.id, roleType: 'ADMIN' },
      ),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { orgId: string };
    expect(body.orgId).toBeTruthy();
    createdOrgIds.push(body.orgId);

    const org = await prisma.organization.findUnique({ where: { id: body.orgId } });
    expect(org).toMatchObject({
      legalName: 'PT Uji Coba Route',
      displayName: 'Uji Coba Route',
      isPkp: true,
      npwp: '01.234.567.8-901.000',
    });
    await assertBootstrapComplete(body.orgId, user.id);
  });

  it('duplicate legalName for the same caller → 409 and exactly one org row', async () => {
    const user = await createCreatorUser();
    const callerOrgId = await seedCallerOrg(user.id);
    const uniqueName = `PT Duplikat ${randomUUID()}`;

    const first = await createOrganization(
      orgCreateRequest(
        { legalName: uniqueName, displayName: uniqueName },
        { orgId: callerOrgId, userId: user.id, roleType: 'ADMIN' },
      ),
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { orgId: string };
    createdOrgIds.push(firstBody.orgId);

    const second = await createOrganization(
      orgCreateRequest(
        { legalName: uniqueName, displayName: uniqueName },
        { orgId: callerOrgId, userId: user.id, roleType: 'ADMIN' },
      ),
    );
    expect(second.status).toBe(409);
    const secondBody = (await second.json()) as { error: string };
    expect(secondBody.error).toBe('A company with this name already exists');

    // Organization has no unique name constraint and no delete endpoint —
    // exactly one row must exist.
    expect(await prisma.organization.count({ where: { legalName: uniqueName } })).toBe(1);
  });

  it('non-ADMIN member → 403 and no organization row is created', async () => {
    // The caller must be a genuine non-admin IN THE DATABASE. This test used to
    // seed an org via bootstrapOrganization — which makes the creator its Admin —
    // and then claim FINANCE through the `x-role-type` header. The route no
    // longer trusts that header (it reads memberships, so a revoked role takes
    // effect immediately), so the fixture was asserting nothing: the user really
    // was an admin. Give them a membership on someone else's company under a
    // non-ADMIN role instead, which is what the assertion has always meant.
    const owner = await createCreatorUser();
    const callerOrgId = await seedCallerOrg(owner.id);
    const user = await createCreatorUser();
    const nonAdminRole = await prisma.role.findFirstOrThrow({
      where: { organizationId: callerOrgId, roleType: { not: 'ADMIN' } },
      select: { id: true },
    });
    await prisma.userOrganization.create({
      data: { userId: user.id, organizationId: callerOrgId, roleId: nonAdminRole.id, isActive: true },
    });
    const uniqueName = `PT Ditolak ${randomUUID()}`;

    const res = await createOrganization(
      orgCreateRequest(
        { legalName: uniqueName, displayName: uniqueName },
        { orgId: callerOrgId, userId: user.id, roleType: 'FINANCE' },
      ),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Only administrators can create companies');
    expect(await prisma.organization.count({ where: { legalName: uniqueName } })).toBe(0);
  });

  it('invalid body (short displayName) → 400 and nothing created', async () => {
    const user = await createCreatorUser();
    const callerOrgId = await seedCallerOrg(user.id);
    const uniqueName = `PT Invalid ${randomUUID()}`;

    const res = await createOrganization(
      orgCreateRequest(
        { legalName: uniqueName, displayName: 'X' },
        { orgId: callerOrgId, userId: user.id, roleType: 'ADMIN' },
      ),
    );
    expect(res.status).toBe(400);
    expect(await prisma.organization.count({ where: { legalName: uniqueName } })).toBe(0);
  });
});

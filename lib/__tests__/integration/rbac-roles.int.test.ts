import { describe, it, expect, afterAll } from 'vitest';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import { roleGrantsSettingsEdit } from '../../rbac/role-permissions';

afterAll(async () => {
  await disconnect();
});

describe('RBAC role persistence + guard conditions', () => {
  // ------------------------------------------------------------------
  // 1. Role + permission matrix persists
  // ------------------------------------------------------------------
  it('persists a role with nested RolePermission rows and reads them back', async () => {
    const { orgId } = await createTestOrg();

    const role = await prisma.role.create({
      data: {
        organizationId: orgId,
        name: 'AR Operator',
        roleType: 'CUSTOM',
        permissions: {
          create: [
            { moduleKey: 'AR_INVOICES', canView: true, canCreate: true, canEdit: false, canDelete: false, canApprove: false },
            { moduleKey: 'AR_CUSTOMERS', canView: true, canCreate: false, canEdit: false, canDelete: false, canApprove: false },
          ],
        },
      },
      include: { permissions: true },
    });

    expect(role.organizationId).toBe(orgId);
    expect(role.roleType).toBe('CUSTOM');
    expect(role.isActive).toBe(true);
    expect(role.permissions).toHaveLength(2);

    const arInv = role.permissions.find((p) => p.moduleKey === 'AR_INVOICES');
    expect(arInv).toBeDefined();
    expect(arInv!.canView).toBe(true);
    expect(arInv!.canCreate).toBe(true);
    expect(arInv!.canEdit).toBe(false);
    expect(arInv!.canDelete).toBe(false);
    expect(arInv!.canApprove).toBe(false);

    const arCust = role.permissions.find((p) => p.moduleKey === 'AR_CUSTOMERS');
    expect(arCust).toBeDefined();
    expect(arCust!.canView).toBe(true);

    // Round-trip: read back from DB independently
    const fetched = await prisma.role.findUnique({
      where: { id: role.id },
      include: { permissions: true },
    });
    expect(fetched).not.toBeNull();
    expect(fetched!.permissions).toHaveLength(2);

    await cleanupOrg(orgId);
  });

  // ------------------------------------------------------------------
  // 2. roleGrantsSettingsEdit reflects DB state
  // ------------------------------------------------------------------
  it('roleGrantsSettingsEdit returns true for ADMIN roleType regardless of permissions', async () => {
    const { orgId } = await createTestOrg();

    const adminRole = await prisma.role.create({
      data: {
        organizationId: orgId,
        name: 'Sys Admin',
        roleType: 'ADMIN',
        // No SETTINGS permission row — ADMIN type bypasses the check
      },
      include: { permissions: true },
    });

    const result = roleGrantsSettingsEdit(adminRole.roleType, adminRole.permissions);
    expect(result).toBe(true);

    await cleanupOrg(orgId);
  });

  it('roleGrantsSettingsEdit returns true for CUSTOM role with SETTINGS canEdit:true in DB', async () => {
    const { orgId } = await createTestOrg();

    const customRole = await prisma.role.create({
      data: {
        organizationId: orgId,
        name: 'Settings Manager',
        roleType: 'CUSTOM',
        permissions: {
          create: [
            { moduleKey: 'SETTINGS', canView: true, canCreate: false, canEdit: true, canDelete: false, canApprove: false },
          ],
        },
      },
      include: { permissions: true },
    });

    const result = roleGrantsSettingsEdit(customRole.roleType, customRole.permissions);
    expect(result).toBe(true);

    await cleanupOrg(orgId);
  });

  it('roleGrantsSettingsEdit returns false for CUSTOM role without SETTINGS canEdit', async () => {
    const { orgId } = await createTestOrg();

    const limitedRole = await prisma.role.create({
      data: {
        organizationId: orgId,
        name: 'View Only',
        roleType: 'CUSTOM',
        permissions: {
          create: [
            // SETTINGS canView only — canEdit is false
            { moduleKey: 'SETTINGS', canView: true, canCreate: false, canEdit: false, canDelete: false, canApprove: false },
            { moduleKey: 'AR_INVOICES', canView: true, canCreate: false, canEdit: false, canDelete: false, canApprove: false },
          ],
        },
      },
      include: { permissions: true },
    });

    const result = roleGrantsSettingsEdit(limitedRole.roleType, limitedRole.permissions);
    expect(result).toBe(false);

    await cleanupOrg(orgId);
  });

  it('roleGrantsSettingsEdit returns false for CUSTOM role with no SETTINGS row at all', async () => {
    const { orgId } = await createTestOrg();

    const noSettingsRole = await prisma.role.create({
      data: {
        organizationId: orgId,
        name: 'AR Only',
        roleType: 'CUSTOM',
        permissions: {
          create: [
            { moduleKey: 'AR_INVOICES', canView: true, canCreate: true, canEdit: true, canDelete: false, canApprove: false },
          ],
        },
      },
      include: { permissions: true },
    });

    const result = roleGrantsSettingsEdit(noSettingsRole.roleType, noSettingsRole.permissions);
    expect(result).toBe(false);

    await cleanupOrg(orgId);
  });

  // ------------------------------------------------------------------
  // 3. Delete-in-use is detectable via the _count query the DELETE route uses
  // ------------------------------------------------------------------
  it('detects that a role is in use (active member holds it) and allows deletion after deactivation', async () => {
    const { orgId } = await createTestOrg();

    const role = await prisma.role.create({
      data: { organizationId: orgId, name: 'In-Use Role', roleType: 'CUSTOM' },
    });

    const user = await prisma.user.create({
      data: {
        email: `test-inuse-${Date.now()}@example.com`,
        fullName: 'Test User',
        passwordHash: 'x',
      },
    });

    await prisma.userOrganization.create({
      data: {
        userId: user.id,
        organizationId: orgId,
        roleId: role.id,
        isActive: true,
      },
    });

    // Simulate the DELETE route's "is role in use?" query
    const inUseCount = await prisma.userOrganization.count({
      where: { roleId: role.id, isActive: true },
    });
    // Role IS in use — DELETE route would 409
    expect(inUseCount).toBeGreaterThan(0);

    // Deactivate the membership (simulating role reassignment before deletion)
    await prisma.userOrganization.updateMany({
      where: { userId: user.id, organizationId: orgId },
      data: { isActive: false },
    });

    const afterCount = await prisma.userOrganization.count({
      where: { roleId: role.id, isActive: true },
    });
    // Role is now free — DELETE route would proceed
    expect(afterCount).toBe(0);

    // Cleanup: remove user before org cleanup (org cascade removes role/membership)
    await cleanupOrg(orgId);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  // ------------------------------------------------------------------
  // 4. Lockout guard: "other admins" count query blocks last-admin removal
  // ------------------------------------------------------------------
  it('lockout guard query returns 0 when the only org admin is the target user', async () => {
    const { orgId } = await createTestOrg();

    const adminRole = await prisma.role.create({
      data: { organizationId: orgId, name: 'Admin Role', roleType: 'ADMIN' },
    });

    const adminUser = await prisma.user.create({
      data: {
        email: `test-admin-${Date.now()}@example.com`,
        fullName: 'Sole Admin',
        passwordHash: 'x',
      },
    });

    await prisma.userOrganization.create({
      data: {
        userId: adminUser.id,
        organizationId: orgId,
        roleId: adminRole.id,
        isActive: true,
      },
    });

    // This is the exact query the reassign/delete route uses to detect lockout:
    // "are there OTHER active members in this org who hold an admin-capable role?"
    const otherAdminsCount = await prisma.userOrganization.count({
      where: {
        organizationId: orgId,
        isActive: true,
        userId: { not: adminUser.id },
        role: {
          OR: [
            { roleType: 'ADMIN' },
            { permissions: { some: { moduleKey: 'SETTINGS', canEdit: true } } },
          ],
        },
      },
    });

    // 0 → only this user is admin → route would block the operation (lockout)
    expect(otherAdminsCount).toBe(0);

    await cleanupOrg(orgId);
    await prisma.user.delete({ where: { id: adminUser.id } }).catch(() => {});
  });

  it('lockout guard query returns > 0 when another admin exists (operation is safe)', async () => {
    const { orgId } = await createTestOrg();

    const adminRole = await prisma.role.create({
      data: { organizationId: orgId, name: 'Admin Role', roleType: 'ADMIN' },
    });

    const settingsRole = await prisma.role.create({
      data: {
        organizationId: orgId,
        name: 'Settings Editor',
        roleType: 'CUSTOM',
        permissions: {
          create: [
            { moduleKey: 'SETTINGS', canView: true, canCreate: false, canEdit: true, canDelete: false, canApprove: false },
          ],
        },
      },
    });

    const targetUser = await prisma.user.create({
      data: {
        email: `test-target-${Date.now()}@example.com`,
        fullName: 'Target User',
        passwordHash: 'x',
      },
    });

    const otherAdminUser = await prisma.user.create({
      data: {
        email: `test-other-${Date.now()}@example.com`,
        fullName: 'Other Admin',
        passwordHash: 'x',
      },
    });

    await prisma.userOrganization.create({
      data: { userId: targetUser.id, organizationId: orgId, roleId: adminRole.id, isActive: true },
    });

    await prisma.userOrganization.create({
      data: { userId: otherAdminUser.id, organizationId: orgId, roleId: settingsRole.id, isActive: true },
    });

    // Other admin (via SETTINGS.canEdit) exists → count > 0 → operation is safe
    const otherAdminsCount = await prisma.userOrganization.count({
      where: {
        organizationId: orgId,
        isActive: true,
        userId: { not: targetUser.id },
        role: {
          OR: [
            { roleType: 'ADMIN' },
            { permissions: { some: { moduleKey: 'SETTINGS', canEdit: true } } },
          ],
        },
      },
    });

    expect(otherAdminsCount).toBeGreaterThan(0);

    await cleanupOrg(orgId);
    await prisma.user.delete({ where: { id: targetUser.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: otherAdminUser.id } }).catch(() => {});
  });
});

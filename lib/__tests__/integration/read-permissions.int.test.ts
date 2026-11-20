/**
 * Issue #234: read endpoints enforce the role's `view` permission.
 *
 * Before the fix, most GET handlers only checked `x-org-id`, so any member of
 * a company could read payroll compensation (`GET /employees/{id}`), the
 * ledger, invoices and bank data by calling the API directly. These tests
 * drive the real route handlers and the real permission lookup against the
 * test database, with the identity headers the middleware would set.
 *
 * Run with: npm run test:int -- read-permissions
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import type { ModuleKey } from '@prisma/client';
import { GET as getEmployee } from '@/src/app/api/v1/employees/[id]/route';
import { GET as listJournalEntries } from '@/src/app/api/v1/journal-entries/route';
import { GET as listInvoices } from '@/src/app/api/v1/invoices/route';
import { GET as listAccounts } from '@/src/app/api/v1/accounts/route';
import { GET as listApprovals } from '@/src/app/api/v1/approvals/route';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';

let orgId: string;
let employeeId: string;
const userIds: string[] = [];

/** A member whose CUSTOM role grants exactly the given view/approve rights. */
async function memberWith(grants: Array<{ moduleKey: ModuleKey; canApprove?: boolean }>): Promise<string> {
  const role = await prisma.role.create({
    data: {
      organizationId: orgId,
      name: `Read test ${randomUUID().slice(0, 8)}`,
      roleType: 'CUSTOM',
      permissions: {
        create: grants.map((g) => ({ moduleKey: g.moduleKey, canView: true, canApprove: g.canApprove ?? false })),
      },
    },
  });
  const user = await prisma.user.create({
    data: { email: `read-${randomUUID()}@example.test`, fullName: 'Read test' },
  });
  userIds.push(user.id);
  await prisma.userOrganization.create({ data: { userId: user.id, organizationId: orgId, roleId: role.id } });
  return user.id;
}

function get(path: string, userId: string): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost'), {
    headers: new Headers({ 'x-org-id': orgId, 'x-user-id': userId, 'x-role-type': 'CUSTOM' }),
  });
}

beforeAll(async () => {
  ({ orgId } = await createTestOrg());
  const employee = await prisma.employee.create({
    data: { organizationId: orgId, employeeNo: 'EMP-READ-1', name: 'Payroll Person', joinDate: new Date('2026-01-05') },
  });
  employeeId = employee.id;
});

afterAll(async () => {
  await prisma.approvalRequest.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
  await prisma.userOrganization.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
  await prisma.role.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
  await cleanupOrg(orgId);
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  await disconnect();
});

describe('GET /employees/{id} (compensation)', () => {
  const params = () => ({ params: Promise.resolve({ id: employeeId }) });

  it('is refused for a role without HR_EMPLOYEES view', async () => {
    const userId = await memberWith([{ moduleKey: 'AR_INVOICES' }, { moduleKey: 'HR_ATTENDANCE' }]);
    const res = await getEmployee(get(`/api/v1/employees/${employeeId}`, userId), params());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('Payroll Person');
  });

  it('is served for a role with HR_EMPLOYEES view', async () => {
    const userId = await memberWith([{ moduleKey: 'HR_EMPLOYEES' }]);
    const res = await getEmployee(get(`/api/v1/employees/${employeeId}`, userId), params());
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('Payroll Person');
  });
});

describe('accounting reads', () => {
  it('journal entries need GL_JOURNAL view', async () => {
    const arClerk = await memberWith([{ moduleKey: 'AR_INVOICES' }]);
    expect((await listJournalEntries(get('/api/v1/journal-entries', arClerk))).status).toBe(403);

    const bookkeeper = await memberWith([{ moduleKey: 'GL_JOURNAL' }]);
    expect((await listJournalEntries(get('/api/v1/journal-entries', bookkeeper))).status).toBe(200);
  });

  it('invoices need a sales-side view right', async () => {
    const hrOnly = await memberWith([{ moduleKey: 'HR_EMPLOYEES' }]);
    expect((await listInvoices(get('/api/v1/invoices', hrOnly))).status).toBe(403);

    // Receive-payment lists open invoices, so AR_PAYMENTS alone may read them.
    const cashier = await memberWith([{ moduleKey: 'AR_PAYMENTS' }]);
    expect((await listInvoices(get('/api/v1/invoices', cashier))).status).toBe(200);
  });

  it('the account picker is open to posting screens but not to HR attendance', async () => {
    const attendanceOnly = await memberWith([{ moduleKey: 'HR_ATTENDANCE' }]);
    expect((await listAccounts(get('/api/v1/accounts', attendanceOnly))).status).toBe(403);

    const arClerk = await memberWith([{ moduleKey: 'AR_INVOICES' }]);
    const res = await listAccounts(get('/api/v1/accounts', arClerk));
    expect(res.status).toBe(200);
    expect((await res.json()).data.length).toBeGreaterThan(0);
  });
});

describe('GET /approvals', () => {
  it('lists only requests the caller can approve or submitted', async () => {
    const submitter = await memberWith([{ moduleKey: 'AR_INVOICES' }]);
    const payrollApprover = await memberWith([{ moduleKey: 'HR_PAYROLL', canApprove: true }]);
    const bystander = await memberWith([{ moduleKey: 'AR_INVOICES' }]);

    const invoiceRequest = await prisma.approvalRequest.create({
      data: { organizationId: orgId, documentType: 'INVOICE', documentId: randomUUID(), requestedById: submitter },
    });
    const payrollRequest = await prisma.approvalRequest.create({
      data: { organizationId: orgId, documentType: 'PAYROLL_RUN', documentId: randomUUID(), requestedById: payrollApprover },
    });

    const idsFor = async (userId: string) => {
      const res = await listApprovals(get('/api/v1/approvals', userId));
      expect(res.status).toBe(200);
      return ((await res.json()).data as Array<{ id: string }>).map((r) => r.id).sort();
    };

    expect(await idsFor(bystander)).toEqual([]);
    expect(await idsFor(submitter)).toEqual([invoiceRequest.id]);
    expect(await idsFor(payrollApprover)).toEqual([payrollRequest.id]);
  });
});

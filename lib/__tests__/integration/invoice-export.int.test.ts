import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { GET as exportInvoices } from '@/src/app/api/v1/invoices/export/route';
import { GET as listInvoices } from '@/src/app/api/v1/invoices/route';
import { prisma, createTestOrg, createCustomer, cleanupOrg, disconnect } from './harness';

afterAll(disconnect);
const request = (org: string, user: string, role: string, query = '') => new NextRequest(
  `http://localhost/api/v1/invoices/export?${query}`, { headers: {
    'x-org-id': org, 'x-user-id': user, 'x-role-type': role,
  } },
);
describe('full invoice export access and filters', () => {
  it('returns every matching page in stable order and enforces company, own-invoice and view permission', async () => {
    const org = await createTestOrg(), other = await createTestOrg();
    try {
      const customer = await createCustomer(org.orgId), foreignCustomer = await createCustomer(other.orgId);
      const adminRole = await prisma.role.create({ data: { organizationId: org.orgId, name: 'Admin', roleType: 'ADMIN' } });
      const ownRole = await prisma.role.create({ data: { organizationId: org.orgId, name: 'Own', roleType: 'CUSTOM',
        invoiceAccessScope: 'OWN', permissions: { create: { moduleKey: 'AR_INVOICES', canView: true } } } });
      const deniedRole = await prisma.role.create({ data: { organizationId: org.orgId, name: 'Denied', roleType: 'CUSTOM' } });
      const mkUser = async (roleId: string) => {
        const u = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, fullName: 'QA', passwordHash: 'x', status: 'ACTIVE' } });
        await prisma.userOrganization.create({ data: { organizationId: org.orgId, userId: u.id, roleId } });
        return u.id;
      };
      const admin = await mkUser(adminRole.id), own = await mkUser(ownRole.id), denied = await mkUser(deniedRole.id);
      await prisma.salesInvoice.createMany({ data: Array.from({ length: 125 }, (_, i) => ({
        organizationId: org.orgId, customerId: customer, createdById: i < 65 ? own : admin,
        number: `MATCH-${String(i).padStart(3, '0')}`, issueDate: new Date('2026-01-15T00:00:00Z'),
        status: 'SENT' as const, totalAmount: 100,
      })) });
      await prisma.salesInvoice.create({ data: { organizationId: org.orgId, customerId: customer, createdById: own,
        number: 'OTHER', issueDate: new Date('2026-02-15'), status: 'DRAFT', totalAmount: 50 } });
      await prisma.salesInvoice.create({ data: { organizationId: other.orgId, customerId: foreignCustomer,
        number: 'MATCH-FOREIGN', issueDate: new Date('2026-01-15'), status: 'SENT', totalAmount: 999 } });
      const query = 'search=MATCH&status=SENT&dateFrom=2026-01-01&dateTo=2026-01-31&limit=20&page=2';
      const result = await exportInvoices(request(org.orgId, admin, 'ADMIN', query));
      expect(result.status).toBe(200);
      expect(result.headers.get('content-type')).toContain('text/csv');
      expect(result.headers.get('cache-control')).toBe('no-store');
      const csv = await result.text();
      const rows = csv.split('\r\n').slice(1).map(line => line.split(','));
      expect(rows).toHaveLength(125);
      expect(new Set(rows.map(row => row[0])).size).toBe(125);
      expect(rows.reduce((sum, row) => sum + Number(row[7]), 0)).toBe(12_500);
      expect(csv).not.toContain('MATCH-FOREIGN');
      expect(csv).not.toContain('OTHER');
      const again = await (await exportInvoices(request(org.orgId, admin, 'ADMIN', query))).text();
      expect(again).toBe(csv);
      const list = await (await listInvoices(request(org.orgId, admin, 'ADMIN', query))).json();
      expect(list.total).toBe(125);
      expect(list.data).toHaveLength(20);
      const mine = await exportInvoices(request(org.orgId, own, 'CUSTOM', query));
      expect(mine.status).toBe(200);
      const ownCsv = await mine.text();
      expect(ownCsv.split('\r\n').slice(1)).toHaveLength(65);
      expect(ownCsv).toContain('MATCH-064');
      expect(ownCsv).not.toContain('MATCH-065');
      expect((await exportInvoices(request(org.orgId, denied, 'CUSTOM', query))).status).toBe(403);
      expect((await exportInvoices(request(other.orgId, own, 'CUSTOM', query))).status).toBe(403);
    } finally { await cleanupOrg(org.orgId); await cleanupOrg(other.orgId); }
  });
});

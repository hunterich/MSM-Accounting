/**
 * Integration test for the `top-products` sales-report type that powers the
 * Best Selling Products dashboard widget. Verifies it ranks by units sold,
 * rolls up by the master item (not free-text description), and excludes lines
 * with no master item (master-only).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { prisma, createTestOrg, createCustomer, cleanupOrg, disconnect } from './harness';
import { GET as getSalesReport } from '@/src/app/api/v1/reports/sales/route';

afterAll(async () => {
  await disconnect();
});

function makeGet(url: string, orgId: string): NextRequest {
  const h = new Headers({
    'x-org-id': orgId,
    'x-user-id': `reports-reader-${randomUUID()}`,
    'x-role-type': 'ADMIN',
  });
  return new NextRequest(new URL(url, 'http://localhost'), { method: 'GET', headers: h });
}

async function createItem(orgId: string, sku: string, name: string): Promise<string> {
  const item = await prisma.item.create({
    data: { organizationId: orgId, sku, name },
    select: { id: true },
  });
  return item.id;
}

interface SeedLine { itemId: string | null; description: string; quantity: number; price: number; }

async function makeInvoice(orgId: string, customerId: string, issueDate: Date, lines: SeedLine[]): Promise<void> {
  await prisma.salesInvoice.create({
    data: {
      organizationId: orgId,
      number: `INV-${randomUUID().slice(0, 8)}`,
      customerId,
      issueDate,
      status: 'SENT',
      taxEnabled: false,
      taxAmount: 0,
      subtotal: 0,
      totalAmount: 0,
      lines: {
        create: lines.map((l, i) => ({
          lineNo: i + 1,
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity,
          unit: 'PCS',
          price: l.price,
          lineSubtotal: l.quantity * l.price,
        })),
      },
    },
  });
}

describe('reports/sales top-products', () => {
  it('ranks by units sold, rolls up by master item, and excludes lines with no itemId', async () => {
    const org = await createTestOrg();
    try {
      const customerId = await createCustomer(org.orgId);
      const creambath = await createItem(org.orgId, 'CB-1000', 'Creambath Cocoa 1000ml');
      const serum = await createItem(org.orgId, 'SR-50', 'Hair Serum 50ml');
      const q1 = new Date('2026-02-15T00:00:00.000Z');

      // Invoice 1: 5 creambath + 3 serum. Invoice 2: 10 more creambath (must roll up to 15).
      await makeInvoice(org.orgId, customerId, q1, [
        { itemId: creambath, description: 'Creambath Cocoa 1000ml', quantity: 5, price: 49500 },
        { itemId: serum, description: 'Hair Serum 50ml', quantity: 3, price: 30000 },
      ]);
      await makeInvoice(org.orgId, customerId, q1, [
        { itemId: creambath, description: 'creambath cocoa (typo variant)', quantity: 10, price: 49500 },
      ]);
      // A line with no master item — must be excluded entirely.
      await makeInvoice(org.orgId, customerId, q1, [
        { itemId: null, description: 'Unmapped marketplace product', quantity: 100, price: 1000 },
      ]);

      const res = await getSalesReport(
        makeGet('/api/v1/reports/sales?type=top-products&topN=20&sortBy=qty&dateFrom=2026-01-01&dateTo=2026-03-31', org.orgId),
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.rows).toHaveLength(2);                       // null-item line excluded
      expect(body.rows[0].name).toBe('Creambath Cocoa 1000ml'); // master name, not the typo'd line
      expect(body.rows[0].qty).toBe(15);                        // 5 + 10 rolled up by itemId
      expect(body.rows[1].name).toBe('Hair Serum 50ml');
      expect(body.rows[1].qty).toBe(3);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('honours the quarter date range (a sale outside the quarter is excluded)', async () => {
    const org = await createTestOrg();
    try {
      const customerId = await createCustomer(org.orgId);
      const item = await createItem(org.orgId, 'X-1', 'In-quarter Product');
      await makeInvoice(org.orgId, customerId, new Date('2026-02-15T00:00:00.000Z'), [
        { itemId: item, description: 'In-quarter Product', quantity: 7, price: 1000 },
      ]);
      // Q2 sale — must NOT appear in a Q1 query.
      await makeInvoice(org.orgId, customerId, new Date('2026-05-01T00:00:00.000Z'), [
        { itemId: item, description: 'In-quarter Product', quantity: 99, price: 1000 },
      ]);

      const res = await getSalesReport(
        makeGet('/api/v1/reports/sales?type=top-products&topN=20&sortBy=qty&dateFrom=2026-01-01&dateTo=2026-03-31', org.orgId),
      );
      const body = await res.json();
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].qty).toBe(7); // only the Q1 sale
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});

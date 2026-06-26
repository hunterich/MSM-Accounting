import { describe, it, expect, afterAll } from 'vitest';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';
import {
  normalizeFeatures,
  normalizeDocumentNumbering,
  normalizeSalesPolicy,
} from '../../organization/settings-config';

afterAll(async () => {
  await disconnect();
});

describe('org settings new columns persist', () => {
  it('writes and reads back features/documentNumbering/salesPolicy/defaultPaymentTerms', async () => {
    const org = await createTestOrg();
    const orgId = org.orgId;

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        defaultPaymentTerms: 30,
        features: { salesOrders: false },
        salesPolicy: { blockSellBelowCost: true, requireSalesOrder: false },
        documentNumbering: { ar_invoice: { prefix: 'FAK', resetPeriod: 'yearly', seqLength: 8 } },
      } as never,
    });

    const row = await prisma.organization.findUnique({ where: { id: orgId } }) as unknown as {
      defaultPaymentTerms: number; features: unknown; salesPolicy: unknown; documentNumbering: unknown;
    };

    expect(row.defaultPaymentTerms).toBe(30);
    expect(normalizeFeatures(row.features).salesOrders).toBe(false);
    expect(normalizeFeatures(row.features).hrPayroll).toBe(true); // default preserved
    expect(normalizeSalesPolicy(row.salesPolicy)).toEqual({ blockSellBelowCost: true, requireSalesOrder: false });
    expect(normalizeDocumentNumbering(row.documentNumbering).ar_invoice).toEqual({ prefix: 'FAK', resetPeriod: 'yearly', seqLength: 8 });

    await cleanupOrg(orgId);
  });
});

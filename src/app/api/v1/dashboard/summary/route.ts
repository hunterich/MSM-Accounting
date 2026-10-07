import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  dashboardSummaryQuerySchema,
  dashboardSummaryResponseSchema,
} from '@/types/api';
import { withHandler, requireOrg, ok, err, ApiError } from '@/lib/api-utils';
import { ledgerCashOnHand } from '@/lib/cash-accounts';
import { dashboardAging } from '@/lib/dashboard-aging';

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asMoney = (value: number): number => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

export const GET = withHandler(async function GET(request: NextRequest) {
  const orgId = requireOrg(request);

  const parsedQuery = dashboardSummaryQuerySchema.safeParse({ organizationId: orgId });

  if (!parsedQuery.success) {
    return err('organizationId is required', 400);
  }

  const organizationId = parsedQuery.data.organizationId;
    const now = new Date();

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });

    if (!organization) {
      throw new ApiError('Organization not found', 404);
    }

    const [
      cashOnHand,
      invoiceTotalsByCustomer,
      paymentTotalsByCustomer,
      agingSummary,
      customers,
    ] = await Promise.all([
      // From the ledger, not the Banking register's cached balance: receipts
      // and payments post to the bank GL account and never touch the cache.
      ledgerCashOnHand(prisma, organizationId),
      prisma.salesInvoice.groupBy({
        by: ['customerId'],
        where: {
          organizationId,
          status: {
            in: ['SENT', 'OVERDUE', 'PAID'],
          },
        },
        _sum: {
          totalAmount: true,
        },
      }),
      prisma.aRPayment.groupBy({
        by: ['customerId'],
        where: {
          organizationId,
          status: 'COMPLETED',
        },
        _sum: {
          totalAmount: true,
        },
      }),
      dashboardAging(prisma, organizationId, now),
      prisma.customer.findMany({
        where: {
          organizationId,
        },
        select: {
          id: true,
          code: true,
          name: true,
        },
      }),
    ]);

    const customerById = new Map(customers.map((customer) => [customer.id, customer]));

    const invoiceTotalsMap = new Map(
      invoiceTotalsByCustomer.map((row) => [row.customerId, toNumber(row._sum.totalAmount)]),
    );

    const paymentTotalsMap = new Map(
      paymentTotalsByCustomer.map((row) => [row.customerId, toNumber(row._sum.totalAmount)]),
    );

    const customerIds = new Set<string>([
      ...invoiceTotalsMap.keys(),
      ...paymentTotalsMap.keys(),
    ]);

    const customerBalances = Array.from(customerIds)
      .map((customerId) => {
        const invoicedAmount = asMoney(invoiceTotalsMap.get(customerId) ?? 0);
        const paidAmount = asMoney(paymentTotalsMap.get(customerId) ?? 0);
        const outstandingAmount = asMoney(invoicedAmount - paidAmount);
        const customer = customerById.get(customerId);

        return {
          customerId,
          customerCode: customer?.code ?? null,
          customerName: customer?.name ?? `Unknown (${customerId})`,
          invoicedAmount,
          paidAmount,
          outstandingAmount,
        };
      })
      .sort((a, b) => b.outstandingAmount - a.outstandingAmount);

    const { aging, overdueInvoiceCount, overdueAmount } = agingSummary;

    const invoiceReceivable = asMoney(
      customerBalances.reduce((sum, row) => sum + Math.max(row.outstandingAmount, 0), 0),
    );

    const responsePayload = dashboardSummaryResponseSchema.parse({
      organizationId,
      cashOnHand,
      invoiceReceivable,
      overdueInvoiceCount,
      overdueAmount,
      aging,
      customerBalances,
      generatedAt: now.toISOString(),
    });

  return ok(responsePayload);
});

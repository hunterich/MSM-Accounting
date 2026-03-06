// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  dashboardSummaryQuerySchema,
  dashboardSummaryResponseSchema,
} from '@/types/api';

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asMoney = (value: number): number => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

const daysOverdue = (dueDate: Date | null, now: Date): number => {
  if (!dueDate) return 0;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((now.getTime() - dueDate.getTime()) / msPerDay);
};

export async function GET(request: NextRequest) {
  try {
    const orgId = request.headers.get('x-org-id');
    if (!orgId) {
      return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });
    }

    const parsedQuery = dashboardSummaryQuerySchema.safeParse({ organizationId: orgId });

    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          message: 'organizationId is required',
          issues: parsedQuery.error.issues,
        },
        { status: 400 },
      );
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
      cashAggregate,
      invoiceTotalsByCustomer,
      paymentTotalsByCustomer,
      paidByInvoice,
      invoicesForAging,
      customers,
    ] = await Promise.all([
      prisma.bankAccount.aggregate({
        where: {
          organizationId,
          isActive: true,
        },
        _sum: {
          currentBalance: true,
        },
      }),
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
      prisma.aRPaymentAllocation.groupBy({
        by: ['invoiceId'],
        where: {
          payment: {
            organizationId,
            status: 'COMPLETED',
          },
        },
        _sum: {
          amountApplied: true,
          discountAmount: true,
        },
      }),
      prisma.salesInvoice.findMany({
        where: {
          organizationId,
          status: {
            in: ['SENT', 'OVERDUE', 'PAID'],
          },
        },
        select: {
          id: true,
          customerId: true,
          dueDate: true,
          totalAmount: true,
        },
      }),
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

    const paidByInvoiceMap = new Map(
      paidByInvoice.map((row) => {
        const clearedAmount = toNumber(row._sum.amountApplied) + toNumber(row._sum.discountAmount);
        return [row.invoiceId, asMoney(clearedAmount)];
      }),
    );

    const aging = {
      current: 0,
      d1To30: 0,
      d31To60: 0,
      d61To90: 0,
      d90Plus: 0,
      totalOutstanding: 0,
    };

    let overdueInvoiceCount = 0;
    let overdueAmount = 0;

    for (const invoice of invoicesForAging) {
      const invoiceTotal = toNumber(invoice.totalAmount);
      const cleared = paidByInvoiceMap.get(invoice.id) ?? 0;
      const outstanding = asMoney(invoiceTotal - cleared);

      if (outstanding <= 0) {
        continue;
      }

      aging.totalOutstanding = asMoney(aging.totalOutstanding + outstanding);
      const overdueDays = daysOverdue(invoice.dueDate, now);

      if (overdueDays <= 0) {
        aging.current = asMoney(aging.current + outstanding);
      } else if (overdueDays <= 30) {
        aging.d1To30 = asMoney(aging.d1To30 + outstanding);
      } else if (overdueDays <= 60) {
        aging.d31To60 = asMoney(aging.d31To60 + outstanding);
      } else if (overdueDays <= 90) {
        aging.d61To90 = asMoney(aging.d61To90 + outstanding);
      } else {
        aging.d90Plus = asMoney(aging.d90Plus + outstanding);
      }

      if (overdueDays > 0) {
        overdueInvoiceCount += 1;
        overdueAmount = asMoney(overdueAmount + outstanding);
      }
    }

    const invoiceReceivable = asMoney(
      customerBalances.reduce((sum, row) => sum + Math.max(row.outstandingAmount, 0), 0),
    );

    const responsePayload = dashboardSummaryResponseSchema.parse({
      organizationId,
      cashOnHand: asMoney(toNumber(cashAggregate._sum.currentBalance)),
      invoiceReceivable,
      overdueInvoiceCount,
      overdueAmount,
      aging,
      customerBalances,
      generatedAt: now.toISOString(),
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : 'Failed to compute dashboard summary';
    return NextResponse.json({ message }, { status: 500 });
  }
}

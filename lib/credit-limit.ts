import { Prisma, type InvoiceStatus } from '@prisma/client';
import { toNumber, asMoney } from '@/lib/money';

const OPEN_INVOICE_STATUSES: InvoiceStatus[] = ['SENT', 'OVERDUE', 'PAID'];

export class CreditLimitError extends Error {
  status: number;

  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}

export async function getCustomerOutstandingBalance(
  tx: Prisma.TransactionClient,
  organizationId: string,
  customerId: string,
) {
  const invoices = await tx.salesInvoice.findMany({
    where: {
      organizationId,
      customerId,
      status: { in: OPEN_INVOICE_STATUSES },
    },
    select: {
      id: true,
      totalAmount: true,
    },
  });

  if (invoices.length === 0) {
    return 0;
  }

  const allocations = await tx.aRPaymentAllocation.groupBy({
    by: ['invoiceId'],
    where: {
      invoiceId: { in: invoices.map((invoice) => invoice.id) },
      payment: {
        organizationId,
        status: 'COMPLETED',
      },
    },
    _sum: {
      amountApplied: true,
      discountAmount: true,
    },
  });

  const clearedByInvoice = new Map(
    allocations.map((row) => {
      const cleared = toNumber(row._sum.amountApplied) + toNumber(row._sum.discountAmount);
      return [row.invoiceId, asMoney(cleared)];
    }),
  );

  return asMoney(invoices.reduce((sum, invoice) => {
    const originalAmount = asMoney(toNumber(invoice.totalAmount));
    const clearedAmount = Math.min(originalAmount, clearedByInvoice.get(invoice.id) ?? 0);
    return sum + Math.max(originalAmount - clearedAmount, 0);
  }, 0));
}

export async function enforceCustomerCreditLimit(
  tx: Prisma.TransactionClient,
  opts: {
    organizationId: string;
    customerId: string;
    documentAmount: number;
    customerName?: string | null;
  },
) {
  const customer = await tx.customer.findFirst({
    where: {
      id: opts.customerId,
      organizationId: opts.organizationId,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      name: true,
      creditLimit: true,
    },
  });

  if (!customer) {
    throw new CreditLimitError('Customer not found in organization', 404);
  }

  const organization = await tx.organization.findUnique({
    where: { id: opts.organizationId },
    select: {
      enforceCreditLimit: true,
      defaultCreditLimit: true,
    },
  });

  if (!organization) {
    throw new CreditLimitError('Organization not found', 404);
  }

  if (!organization.enforceCreditLimit) {
    return { customer, outstandingBalance: 0, projectedBalance: 0, effectiveCreditLimit: 0 };
  }

  const effectiveCreditLimit = Math.max(
    toNumber(customer.creditLimit),
    toNumber(organization.defaultCreditLimit),
  );

  if (effectiveCreditLimit <= 0) {
    return { customer, outstandingBalance: 0, projectedBalance: 0, effectiveCreditLimit };
  }

  const outstandingBalance = await getCustomerOutstandingBalance(
    tx,
    opts.organizationId,
    opts.customerId,
  );
  const projectedBalance = asMoney(outstandingBalance + asMoney(opts.documentAmount));

  if (projectedBalance > effectiveCreditLimit + 0.0001) {
    throw new CreditLimitError(
      `Credit limit exceeded for ${opts.customerName || customer.name}. Limit ${effectiveCreditLimit}, projected balance ${projectedBalance}.`,
    );
  }

  return {
    customer,
    outstandingBalance,
    projectedBalance,
    effectiveCreditLimit,
  };
}

export function calculateSalesOrderTotal(items: Array<{
  quantity?: number;
  qty?: number;
  price?: number;
  discount?: number;
  discountPct?: number;
}>) {
  return asMoney(items.reduce((sum, item) => {
    const quantity = toNumber(item.quantity ?? item.qty);
    const price = toNumber(item.price);
    const discountPct = toNumber(item.discount ?? item.discountPct);
    const gross = quantity * price;
    return sum + (gross - gross * (discountPct / 100));
  }, 0));
}

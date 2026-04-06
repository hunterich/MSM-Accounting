import { describe, expect, it } from 'vitest';
import {
  calculateSalesOrderTotal,
  CreditLimitError,
  enforceCustomerCreditLimit,
  getCustomerOutstandingBalance,
} from '@/lib/credit-limit';

describe('credit-limit helpers', () => {
  it('calculates outstanding balance from invoices minus completed allocations', async () => {
    const tx: any = {
      salesInvoice: {
        findMany: async () => [
          { id: 'inv-1', totalAmount: 1000 },
          { id: 'inv-2', totalAmount: 500 },
        ],
      },
      aRPaymentAllocation: {
        groupBy: async () => [
          { invoiceId: 'inv-1', _sum: { amountApplied: 300, discountAmount: 0 } },
          { invoiceId: 'inv-2', _sum: { amountApplied: 100, discountAmount: 50 } },
        ],
      },
    };

    await expect(getCustomerOutstandingBalance(tx, 'org-1', 'cust-1')).resolves.toBe(1050);
  });

  it('blocks a transaction when projected receivable exceeds the effective credit limit', async () => {
    const tx: any = {
      customer: {
        findFirst: async () => ({ id: 'cust-1', name: 'Acme', creditLimit: 1000 }),
      },
      organization: {
        findUnique: async () => ({ enforceCreditLimit: true, defaultCreditLimit: 0 }),
      },
      salesInvoice: {
        findMany: async () => [{ id: 'inv-1', totalAmount: 900 }],
      },
      aRPaymentAllocation: {
        groupBy: async () => [],
      },
    };

    await expect(enforceCustomerCreditLimit(tx, {
      organizationId: 'org-1',
      customerId: 'cust-1',
      customerName: 'Acme',
      documentAmount: 200,
    })).rejects.toBeInstanceOf(CreditLimitError);
  });

  it('allows a transaction when credit-limit enforcement is disabled', async () => {
    const tx: any = {
      customer: {
        findFirst: async () => ({ id: 'cust-1', name: 'Acme', creditLimit: 500 }),
      },
      organization: {
        findUnique: async () => ({ enforceCreditLimit: false, defaultCreditLimit: 0 }),
      },
    };

    await expect(enforceCustomerCreditLimit(tx, {
      organizationId: 'org-1',
      customerId: 'cust-1',
      documentAmount: 10000,
    })).resolves.toMatchObject({
      effectiveCreditLimit: 0,
    });
  });

  it('calculates sales order totals using percentage discounts', () => {
    expect(calculateSalesOrderTotal([
      { quantity: 2, price: 100, discount: 10 },
      { qty: 1, price: 50, discountPct: 0 },
    ])).toBe(230);
  });
});

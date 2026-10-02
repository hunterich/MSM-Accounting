import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { readJournalTotals } from '../journal-totals';
import { computeLedgerValuation } from '../inventory-valuation';
import { buildTrialBalanceReport, buildProfitLossReport } from '../gl-reporting';
import { readCustomerSales, readSalesCalendar } from '../sales-summary';

describe('database report aggregation', () => {
  it('preserves balanced GL totals and P&L using account totals for 350,000 orders', async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { accountId: 'ar', _sum: { debit: new Prisma.Decimal(700000000), credit: null } },
      { accountId: 'sales', _sum: { debit: null, credit: new Prisma.Decimal(700000000) } },
    ]);
    const db = { journalLine: { groupBy } } as unknown as Pick<Prisma.TransactionClient, 'journalLine'>;
    const where = { entry: { organizationId: 'org-a', status: 'POSTED' as const,
      date: { lte: new Date('2025-12-31T16:59:59.999Z') } } };
    const totals = await readJournalTotals(db, where);
    const accounts = [
      { id: 'ar', code: '1200', name: 'Receivables', type: 'ASSET', normalSide: 'DEBIT', isPostable: true },
      { id: 'sales', code: '4000', name: 'Sales', type: 'REVENUE', normalSide: 'CREDIT', isPostable: true },
    ];
    const report = buildTrialBalanceReport(accounts, totals);
    expect(report.summary.totalDebit).toBe(700000000);
    expect(report.summary.totalCredit).toBe(700000000);
    expect(buildProfitLossReport(accounts, totals).summary.netIncome).toBe(700000000);
    expect(groupBy).toHaveBeenCalledWith({ by: ['accountId'], where, _sum: { debit: true, credit: true } });
  });

  it('retains inventory precision and signed quantities with organization/item/warehouse filters', async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { itemId: 'a', _sum: { qtyIn: new Prisma.Decimal('1000000.1234'), qtyOut: new Prisma.Decimal('1000000.0001'), valueChange: new Prisma.Decimal('123.45') } },
      { itemId: 'b', _sum: { qtyIn: null, qtyOut: new Prisma.Decimal('2.5'), valueChange: new Prisma.Decimal('-100.01') } },
    ]);
    const db = { inventoryLedgerEntry: { groupBy } } as unknown as Pick<Prisma.TransactionClient, 'inventoryLedgerEntry'>;
    const values = await computeLedgerValuation(db, 'org-a', { itemIds: ['a', 'b'], warehouseId: 'wh-a' });
    expect(values.get('a')).toEqual({ itemId: 'a', totalQty: 0.1233, totalValue: 123.45 });
    expect(values.get('b')).toEqual({ itemId: 'b', totalQty: -2.5, totalValue: -100.01 });
    expect(groupBy.mock.calls[0][0].where).toEqual({ organizationId: 'org-a', itemId: { in: ['a', 'b'] }, warehouseId: 'wh-a' });
  });

  it('keeps search text and tenant values parameterized while summing sales in SQL', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      { customerId: 'shopee', customerName: 'Shopee', invoiceCount: 350000, total: new Prisma.Decimal('700000000.25') },
    ]);
    const db = { $queryRaw: queryRaw } as unknown as Pick<Prisma.TransactionClient, '$queryRaw'>;
    const search = "Shopee' OR 1=1 --";
    const rows = await readCustomerSales(db, { organizationId: 'org-a', customerSearch: search });
    expect(rows[0].total).toBe(700000000.25);
    const query = queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.values).toContain(search);
    expect(query.values).toContain('org-a');
    expect(query.text).not.toContain(search);
    expect(query.text).toContain("IN ('SENT', 'OVERDUE', 'PAID')");
    expect(query.text).toContain('SUM(i."totalAmount")');
  });

  it('uses explicit Jakarta calendar buckets and a parameterized customer scope', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ bucket: '2025-12', invoiceCount: 1, total: new Prisma.Decimal(100) }]);
    const db = { $queryRaw: queryRaw } as unknown as Pick<Prisma.TransactionClient, '$queryRaw'>;
    expect(await readSalesCalendar(db, { organizationId: 'org-a' }, 'month', 'customer-a'))
      .toEqual([{ bucket: '2025-12', invoiceCount: 1, total: 100 }]);
    const query = queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.text).toContain("AT TIME ZONE 'Asia/Jakarta'");
    expect(query.values).toContain('YYYY-MM');
    expect(query.values).toContain('customer-a');
  });
});

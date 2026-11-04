import { describe, expect, it } from 'vitest';
import { invoiceExportCsv } from '../invoice-export-csv';
import { invoiceListWhere } from '../invoice-list-filter';

describe('invoice export', () => {
  it('quotes free text and neutralizes spreadsheet formulas but keeps negative numbers numeric', () => {
    const csv = invoiceExportCsv([{ number: '=1+1', issueDate: new Date('2026-01-02T00:00:00Z'),
      dueDate: null, status: 'DRAFT', currency: 'IDR', totalAmount: { toString: () => '-123.45' },
      customer: { code: '+100', name: ' A, "Customer"\n@Name' } }]);
    expect(csv).toContain(`'=1+1,2026-01-02,,'+100," A, ""Customer""\n@Name",DRAFT,IDR,-123.45`);
  });
  it('keeps tenant, own-invoice scope and all list filters together', () => {
    const query = new URLSearchParams({ search: 'Acme', status: 'SENT', dateFrom: '2026-01-01',
      dateTo: '2026-01-31', customerId: 'customer' });
    const where = invoiceListWhere(query, 'company', { userId: 'owner', invoiceAccessScope: 'OWN' });
    expect(where).toMatchObject({ organizationId: 'company', createdById: 'owner', deletedAt: null,
      status: 'SENT', customerId: 'customer', issueDate: {
        gte: new Date('2026-01-01'), lt: new Date('2026-02-01'),
      } });
    expect(where.OR).toHaveLength(5);
  });
});

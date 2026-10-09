import { describe, expect, it } from 'vitest';
import { validateListFilters } from '../list-filters';

describe('catalog enum validation', () => {
  for (const path of ['invoices', 'bills', 'credit-notes', 'debit-notes', 'recurring-invoices', 'recurring-bills', 'subscriptions', 'customers', 'vendors', 'stock-counts']) {
    it(`${path}: rejects unknown statuses`, () => {
      expect(() => validateListFilters(new URL(`https://example.test/api/v1/${path}?status=NOT_A_STATUS`))).toThrow('Invalid status filter');
    });
  }
  it('keeps empty/all filters and account UI labels compatible, without applying list rules to reports', () => {
    for (const query of ['customers?status=ALL', 'invoices?status=', 'accounts?type=Asset', 'stock-adjustments?type=VALUE', 'credit-notes?settlementType=REFUND']) {
      expect(() => validateListFilters(new URL(`https://example.test/api/v1/${query}`))).not.toThrow();
    }
    expect(() => validateListFilters(new URL('https://example.test/api/v1/reports/gl?type=trial-balance'))).not.toThrow();
    expect(() => validateListFilters(new URL('https://example.test/api/v1/items?type=NOPE'))).toThrow('Invalid type filter');
  });
});

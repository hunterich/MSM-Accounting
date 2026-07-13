import { describe, it, expect } from 'vitest';
import { ENTITY_FIELDS, requiredFields, type MigrationEntity } from '../migrationFields';

describe('ENTITY_FIELDS', () => {
  it('covers all 7 migration entities', () => {
    const keys = Object.keys(ENTITY_FIELDS) as MigrationEntity[];
    expect(keys.sort()).toEqual([
      'accounts', 'customers', 'items', 'opening-bills', 'opening-invoices', 'opening-journal', 'vendors',
    ]);
  });
  it('marks account code/name/type as required and parentCode optional', () => {
    const req = requiredFields('accounts');
    expect(req).toContain('code'); expect(req).toContain('name'); expect(req).toContain('type');
    expect(req).not.toContain('parentCode');
  });
  it('gives each field at least one alias', () => {
    for (const spec of ENTITY_FIELDS.customers) {
      expect(spec.aliases.length).toBeGreaterThan(0);
    }
  });
  it('requiredFields for opening-invoices includes customerName, issueDate, amount', () => {
    const req = requiredFields('opening-invoices');
    expect(req.sort()).toEqual(['amount', 'customerName', 'issueDate']);
  });
});

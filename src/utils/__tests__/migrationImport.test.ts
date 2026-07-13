import { describe, it, expect } from 'vitest';
import { autoMapColumns, applyMapping, parseSpreadsheet } from '../migrationImport';

describe('autoMapColumns', () => {
  it('matches headers to fields by alias, case/space-insensitive', () => {
    const map = autoMapColumns(['Kode Akun', 'Nama', 'Tipe', 'Induk'], 'accounts');
    expect(map.code).toBe('Kode Akun');
    expect(map.name).toBe('Nama');
    expect(map.type).toBe('Tipe');
    expect(map.parentCode).toBe('Induk');
  });
  it('leaves unmatched target fields null', () => {
    const map = autoMapColumns(['Foo', 'Bar'], 'customers');
    expect(map.name).toBeNull();
  });
});

describe('applyMapping', () => {
  it('builds object rows, coercing Indonesian numbers', () => {
    const out = applyMapping(
      [['1-1200', '10.000.000', '0']],
      ['Account Code', 'Debit', 'Credit'],
      { accountCode: 'Account Code', debit: 'Debit', credit: 'Credit' },
      'opening-journal',
    );
    expect(out[0]).toMatchObject({ accountCode: '1-1200', debit: 10000000, credit: 0 });
  });
  it('formats date fields to YYYY-MM-DD and coerces amount', () => {
    const out = applyMapping(
      [['PT Andi', '2025-12-01', '5.000.000']],
      ['Customer', 'Date', 'Amount'],
      { customerName: 'Customer', issueDate: 'Date', amount: 'Amount' },
      'opening-invoices',
    );
    expect(out[0].issueDate).toBe('2025-12-01');
    expect(out[0].amount).toBe(5000000);
  });
  it('skips fully-empty rows', () => {
    const out = applyMapping(
      [['', '', ''], ['PT B', '2025-01-01', '100']],
      ['Customer', 'Date', 'Amount'],
      { customerName: 'Customer', issueDate: 'Date', amount: 'Amount' },
      'opening-invoices',
    );
    expect(out).toHaveLength(1);
  });
});

describe('parseSpreadsheet', () => {
  it('parses a CSV File into headers + rows', async () => {
    const csv = 'Name,Email\nPT Andi,a@x.com\nPT Budi,b@y.com\n';
    const file = new File([csv], 'customers.csv', { type: 'text/csv' });
    const { headers, rows } = await parseSpreadsheet(file);
    expect(headers).toEqual(['Name', 'Email']);
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe('PT Andi');
  });
});

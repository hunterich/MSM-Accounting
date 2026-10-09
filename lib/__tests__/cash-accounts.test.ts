import { describe, expect, it } from 'vitest';
import { selectCashAccounts, selectReceiptDepositAccounts } from '@/lib/cash-accounts';

const acc = (
  id: string,
  code: string,
  name: string,
  extra: Partial<{ type: string; parentId: string | null; isPostable: boolean; reportGroup: string | null }> = {},
) => ({ id, code, name, type: 'ASSET', parentId: null, isPostable: true, reportGroup: null, ...extra });

describe('selectCashAccounts', () => {
  it('picks postable asset accounts that name cash or a bank, in any language', () => {
    const accounts = [
      acc('bca', '1-1100', 'Bank BCA IDR'),
      acc('kas', '1-1010', 'Kas Kecil'),
      acc('petty', '1-1020', 'Petty Cash'),
      acc('giro', '1-1030', 'Giro Mandiri'),
      acc('ar', '1-1200', 'Accounts Receivable'),
      acc('inv', '1-1300', 'Inventory'),
      acc('prepaid', '1-1400', 'Prepaid Tax (PPN Masukan)'),
    ];
    expect(selectCashAccounts(accounts).map((a) => a.id)).toEqual(['bca', 'kas', 'petty', 'giro']);
  });

  it('follows the parent chain so "BCA IDR" under "Cash and Bank" counts', () => {
    const accounts = [
      acc('hdr', '1-1000', 'Cash and Bank', { isPostable: false }),
      acc('bca', '1-1101', 'BCA IDR', { parentId: 'hdr' }),
      acc('mandiri', '1-1102', 'Mandiri', { parentId: 'hdr' }),
      acc('other', '1-1500', 'Purchase Returns Clearing', { parentId: 'root' }),
      acc('root', '1-0000', 'Current Assets', { isPostable: false }),
    ];
    expect(selectCashAccounts(accounts).map((a) => a.id)).toEqual(['bca', 'mandiri']);
  });

  it('honours the report group the cash-flow statement uses', () => {
    const accounts = [acc('x', '1-1900', 'Rekening Utama', { reportGroup: 'Cash & Equivalents' })];
    expect(selectCashAccounts(accounts).map((a) => a.id)).toEqual(['x']);
  });

  it('never counts headers, non-assets, or a bank loan', () => {
    const accounts = [
      acc('hdr', '1-1000', 'Cash and Bank', { isPostable: false }),
      acc('loan', '2-2000', 'Bank Loan', { type: 'LIABILITY' }),
      acc('fee', '5-8000', 'Bank Charges', { type: 'EXPENSE' }),
    ];
    expect(selectCashAccounts(accounts)).toEqual([]);
  });

  it('survives a parent cycle in bad data', () => {
    const accounts = [acc('a', '1-1', 'A', { parentId: 'b' }), acc('b', '1-2', 'B', { parentId: 'a' })];
    expect(selectCashAccounts(accounts)).toEqual([]);
  });
});

describe('selectReceiptDepositAccounts', () => {
  const active = (id: string, name: string, extra: Record<string, unknown> = {}) =>
    ({ ...acc(id, '1-1900', name), isActive: true, ...extra });

  it('includes a configured top-level bank asset without cash keywords, alongside classified cash', () => {
    const accounts = [active('bca', 'BCA 0123-456'), active('cash', 'Kas Kecil'), active('ar', 'Piutang Usaha')];
    expect(selectReceiptDepositAccounts(accounts, 'bca').map(a => a.id)).toEqual(['bca', 'cash']);
    expect(selectReceiptDepositAccounts(accounts).map(a => a.id)).toEqual(['cash']);
  });

  it('does not let a configured default bypass activity, postability or asset type', () => {
    for (const extra of [{ isActive: false }, { isPostable: false }, { type: 'LIABILITY' }]) {
      expect(selectReceiptDepositAccounts([active('bca', 'BCA 0123-456', extra)], 'bca')).toEqual([]);
    }
  });

  it('ignores a configured ID absent from the organization chart', () => {
    expect(selectReceiptDepositAccounts([active('ar', 'Piutang Usaha')], 'foreign-bank')).toEqual([]);
  });

  it('keeps UI Asset casing and parent cash accounts supported without duplicates', () => {
    const accounts = [
      active('header', 'Kas & Bank', { isPostable: false }),
      active('bca', 'BCA IDR', { type: 'Asset', parentId: 'header' }),
    ];
    expect(selectReceiptDepositAccounts(accounts, 'bca').map(a => a.id)).toEqual(['bca']);
  });
});

describe('cash keyword boundaries', () => {
  it('excludes employee advances and embedded cash/bank words from names and report groups', () => {
    const accounts = [
      acc('advances', '1-1800', 'Kasbon Karyawan'),
      acc('cashier', '1-1801', 'Cashier Receivable'),
      acc('group', '1-1802', 'Employee Advances', { reportGroup: 'Kasbon' }),
      acc('kas', '1-1803', 'Kas & Bank'),
    ];
    expect(selectCashAccounts(accounts).map(a => a.id)).toEqual(['kas']);
    expect(selectReceiptDepositAccounts(accounts.map(a => ({ ...a, isActive: true }))).map(a => a.id)).toEqual(['kas']);
  });

  it('does not classify children of a Kasbon header as cash', () => {
    expect(selectCashAccounts([
      acc('hdr', '1-1800', 'Kasbon Karyawan', { isPostable: false }),
      acc('child', '1-1801', 'Employee A', { parentId: 'hdr' }),
    ])).toEqual([]);
  });
});

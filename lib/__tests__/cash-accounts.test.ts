import { describe, expect, it } from 'vitest';
import { selectCashAccounts } from '@/lib/cash-accounts';

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

import { describe, expect, it } from 'vitest';
import { isValidCustomerCodePrefix, nextCodeAfter } from '@/lib/customer-code';

describe('nextCodeAfter', () => {
  it('starts a fresh prefix at 0001', () => {
    expect(nextCodeAfter([], 'CST')).toBe('CST-0001');
  });

  it('continues after the highest existing number, whatever order the rows come in', () => {
    expect(nextCodeAfter(['CST-0003', 'CST-0010', 'CST-0002'], 'CST')).toBe('CST-0011');
  });

  it('ignores other prefixes and codes that are not in the sequence', () => {
    expect(nextCodeAfter(['RET-0009', 'CST-QA74311', 'cst-0004', 'CST-7'], 'CST')).toBe('CST-0008');
  });

  it('keeps counting past four digits', () => {
    expect(nextCodeAfter(['CST-9999'], 'CST')).toBe('CST-10000');
  });

  it('treats the prefix literally', () => {
    expect(nextCodeAfter(['C.T-0005', 'CST-0001'], 'C.T')).toBe('C.T-0006');
  });
});

describe('isValidCustomerCodePrefix', () => {
  it('accepts short alphanumeric prefixes only', () => {
    expect(isValidCustomerCodePrefix('CST')).toBe(true);
    expect(isValidCustomerCodePrefix('RT736')).toBe(true);
    expect(isValidCustomerCodePrefix('')).toBe(false);
    expect(isValidCustomerCodePrefix('C-S')).toBe(false);
    expect(isValidCustomerCodePrefix('ABCDEFGHIJK')).toBe(false);
  });
});

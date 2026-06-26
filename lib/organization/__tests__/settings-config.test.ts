import { describe, it, expect } from 'vitest';
import {
  normalizeFeatures, DEFAULT_FEATURES,
  normalizeDocumentNumbering, DEFAULT_DOCUMENT_NUMBERING,
  normalizeSalesPolicy, DEFAULT_SALES_POLICY,
} from '../settings-config';

describe('normalizeFeatures', () => {
  it('returns all defaults for non-object input', () => {
    expect(normalizeFeatures(null)).toEqual(DEFAULT_FEATURES);
    expect(normalizeFeatures('nope')).toEqual(DEFAULT_FEATURES);
  });
  it('overrides only known boolean keys and ignores junk', () => {
    const out = normalizeFeatures({ salesOrders: false, bogus: true, hrPayroll: 'x' });
    expect(out.salesOrders).toBe(false);
    expect(out.hrPayroll).toBe(true); // junk value ignored -> default
    expect('bogus' in out).toBe(false);
  });
});

describe('normalizeSalesPolicy', () => {
  it('defaults when missing', () => {
    expect(normalizeSalesPolicy(undefined)).toEqual(DEFAULT_SALES_POLICY);
  });
  it('keeps known booleans only', () => {
    const out = normalizeSalesPolicy({ blockSellBelowCost: true, requireSalesOrder: 'y', x: 1 });
    expect(out).toEqual({ blockSellBelowCost: true, requireSalesOrder: false });
  });
});

describe('normalizeDocumentNumbering', () => {
  it('fills defaults for all six doc types', () => {
    const out = normalizeDocumentNumbering(null);
    expect(Object.keys(out).sort()).toEqual(Object.keys(DEFAULT_DOCUMENT_NUMBERING).sort());
    expect(out.ar_invoice).toEqual(DEFAULT_DOCUMENT_NUMBERING.ar_invoice);
  });
  it('merges per-doc fields and coerces types', () => {
    const out = normalizeDocumentNumbering({ ar_invoice: { prefix: 'FAK', seqLength: 8 }, junk: { prefix: 'X' } });
    expect(out.ar_invoice).toEqual({ prefix: 'FAK', resetPeriod: 'monthly', seqLength: 8 });
    expect('junk' in out).toBe(false);
    expect(out.ap_bill).toEqual(DEFAULT_DOCUMENT_NUMBERING.ap_bill);
  });
  it('rejects invalid resetPeriod and seqLength', () => {
    const out = normalizeDocumentNumbering({ so_order: { resetPeriod: 'daily', seqLength: 99 } });
    expect(out.so_order.resetPeriod).toBe('monthly'); // invalid -> default
    expect(out.so_order.seqLength).toBe(6);            // not in {4,5,6,8} -> default
  });
});

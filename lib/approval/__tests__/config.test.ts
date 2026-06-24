import { describe, expect, it } from 'vitest';
import {
  APPROVAL_MODULE_KEYS,
  DEFAULT_APPROVAL_REQUIREMENTS,
  normalizeApprovalRequirements,
  requiresApproval,
} from '../config';

describe('approval config helpers', () => {
  it('defaults every module to false', () => {
    expect(APPROVAL_MODULE_KEYS).toHaveLength(10);
    expect(Object.values(DEFAULT_APPROVAL_REQUIREMENTS).every((v) => v === false)).toBe(true);
  });

  it('normalize merges partial/raw over defaults and drops unknown keys', () => {
    const out = normalizeApprovalRequirements({ ar_invoices: true, bogus_key: true });
    expect(out.ar_invoices).toBe(true);
    expect(out.ap_pos).toBe(false);
    expect((out as Record<string, unknown>).bogus_key).toBeUndefined();
  });

  it('normalize is safe on null/undefined/non-object', () => {
    expect(normalizeApprovalRequirements(null).ar_invoices).toBe(false);
    expect(normalizeApprovalRequirements(undefined).ap_pos).toBe(false);
    expect(normalizeApprovalRequirements('nope').inv_adj).toBe(false);
  });

  it('requiresApproval reads the flag, false when config missing', () => {
    expect(requiresApproval({ ...DEFAULT_APPROVAL_REQUIREMENTS, ar_invoices: true }, 'ar_invoices')).toBe(true);
    expect(requiresApproval(DEFAULT_APPROVAL_REQUIREMENTS, 'ar_invoices')).toBe(false);
    expect(requiresApproval(null, 'ar_invoices')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { normalizePermissionMatrix, roleGrantsSettingsEdit, MODULE_KEYS } from '../role-permissions';

describe('normalizePermissionMatrix', () => {
  it('keeps only known module keys and coerces booleans', () => {
    const out = normalizePermissionMatrix([
      { moduleKey: 'AR_INVOICES', canView: true },
      { moduleKey: 'BOGUS', canView: true },
    ] as never);
    const ar = out.find((r) => r.moduleKey === 'AR_INVOICES');
    expect(ar).toEqual({ moduleKey: 'AR_INVOICES', canView: true, canCreate: false, canEdit: false, canDelete: false, canApprove: false });
    expect(out.some((r) => (r.moduleKey as string) === 'BOGUS')).toBe(false);
  });
});

describe('roleGrantsSettingsEdit', () => {
  it('true for ADMIN roleType regardless of rows', () => {
    expect(roleGrantsSettingsEdit('ADMIN', [])).toBe(true);
  });
  it('true when a SETTINGS row has canEdit', () => {
    expect(roleGrantsSettingsEdit('CUSTOM', [{ moduleKey: 'SETTINGS', canEdit: true } as never])).toBe(true);
  });
  it('false otherwise', () => {
    expect(roleGrantsSettingsEdit('CUSTOM', [{ moduleKey: 'AR_INVOICES', canEdit: true } as never])).toBe(false);
  });
});

it('MODULE_KEYS is non-empty and includes SETTINGS', () => {
  expect(MODULE_KEYS).toContain('SETTINGS');
});

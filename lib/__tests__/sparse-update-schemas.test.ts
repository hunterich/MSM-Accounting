import { describe, expect, it } from 'vitest';
import {
  arPaymentInputSchema, apPaymentInputSchema,
  updateArPaymentInputSchema, updateApPaymentInputSchema,
  updateSalesOrderInputSchema, updateStockAdjustmentInputSchema,
  updateBankAccountInputSchema, updateBankTransactionInputSchema,
  updateEmployeeInputSchema, updateIntegrationInputSchema,
  updateAttendanceRecordInputSchema, updateLeaveTypeInputSchema,
  updateAssetCategoryInputSchema, updateAssetInputSchema,
  updateRoleInputSchema, updateAccountInputSchema,
} from '../../types/api';
import { assertPaymentEditable } from '../payment-validation';

const updates = {
  ar: updateArPaymentInputSchema, ap: updateApPaymentInputSchema,
  salesOrder: updateSalesOrderInputSchema, stockAdjustment: updateStockAdjustmentInputSchema,
  bankAccount: updateBankAccountInputSchema, bankTransaction: updateBankTransactionInputSchema,
  employee: updateEmployeeInputSchema, integration: updateIntegrationInputSchema,
  attendance: updateAttendanceRecordInputSchema, leaveType: updateLeaveTypeInputSchema,
  assetCategory: updateAssetCategoryInputSchema, asset: updateAssetInputSchema,
  role: updateRoleInputSchema,
};

describe('sparse API updates with Zod 4', () => {
  for (const [name, schema] of Object.entries(updates)) {
    it(`${name}: omitted fields cannot reset persisted values to create defaults`, () => {
      expect(schema.parse({})).toEqual({});
    });
  }
  for (const [kind, schema] of [['AR', updateArPaymentInputSchema], ['AP', updateApPaymentInputSchema]] as const) {
    it(`${kind}: completion replay contains only the requested status and remains idempotent`, () => {
      const parsed = schema.parse({ status: 'COMPLETED' });
      expect(parsed).toEqual({ status: 'COMPLETED' });
      expect(() => assertPaymentEditable({ status: 'COMPLETED', journalEntryId: 'posted' }, parsed)).not.toThrow();
      expect(() => assertPaymentEditable({ status: 'COMPLETED', journalEntryId: 'posted' }, schema.parse({ totalAmount: 0 }))).toThrow('Only draft');
      const invalid = schema.safeParse({ totalAmount: 'invalid' });
      expect(invalid.success).toBe(false);
      if (!invalid.success) expect(invalid.error.issues[0].message).toBe('Must be a number');
    });
  }
  it('retains explicit zero/false/empty values and defaults inside supplied allocations', () => {
    expect(updateBankAccountInputSchema.parse({ openingBalance: 0, isActive: false })).toEqual({ openingBalance: 0, isActive: false });
    expect(updateSalesOrderInputSchema.parse({ items: [] })).toEqual({ items: [] });
    expect(updateArPaymentInputSchema.parse({ allocations: [{ invoiceId: 'invoice', amountApplied: '12.50' }] })).toEqual({
      allocations: [{ invoiceId: 'invoice', amountApplied: 12.5, discountAmount: 0, penaltyAmount: 0 }],
    });
  });
  it('does not reactivate accounts when an unrelated account field is edited', () => {
    expect(updateAccountInputSchema.parse({ organizationId: 'org', name: 'Renamed' })).toEqual({ organizationId: 'org', name: 'Renamed' });
    expect(updateAccountInputSchema.safeParse({ name: 'Renamed' }).success).toBe(false);
  });
  it('preserves payment creation defaults', () => {
    const common = { organizationId: 'org', date: '2026-09-15', totalAmount: 100 };
    expect(arPaymentInputSchema.parse({ ...common, customerId: 'customer' })).toMatchObject({ method: 'BANK_TRANSFER', status: 'DRAFT' });
    expect(apPaymentInputSchema.parse({ ...common, vendorId: 'vendor' })).toMatchObject({ method: 'BANK_TRANSFER', status: 'DRAFT' });
  });
});
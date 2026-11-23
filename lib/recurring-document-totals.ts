import type { RecurringBillLine, RecurringInvoiceLine } from '@prisma/client';
import { calculateBillAmounts, normalizeBillLineAmounts } from './bill-totals';
import { calculateInvoiceTotals } from './invoice-totals';

/** Financial fields for both the scheduled and manual recurring invoice runs. */
export function recurringInvoiceAmounts(template: { taxRate: RecurringInvoiceLine['price']; lines: RecurringInvoiceLine[] }) {
  const { lines, subtotal, discountPct, discountAmount, taxEnabled, taxInclusive, taxRate, taxAmount, totalAmount } =
    calculateInvoiceTotals({ lines: template.lines }, {
      taxEnabled: template.taxRate.gt(0) && template.lines.some(line => line.taxable),
      taxInclusiveByDefault: false,
      taxDefaultRate: template.taxRate,
    });
  return {
    subtotal, discountPct, discountAmount, taxEnabled, taxInclusive, taxRate, taxAmount, totalAmount,
    lines: { create: lines.map((line, index) => ({ ...line, lineNo: template.lines[index].lineNo })) },
  };
}

/** Financial fields for both the scheduled and manual recurring bill runs. */
export function recurringBillAmounts(template: { taxRate: RecurringBillLine['price']; lines: RecurringBillLine[] }) {
  const { taxRate } = template;
  const taxable = taxRate.gt(0) && template.lines.some(line => line.taxable);
  const lines = template.lines.map(line => ({
    lineNo: line.lineNo, itemId: line.itemId || null, accountId: line.accountId || null,
    description: line.description, unit: line.unit || 'PCS', taxable: line.taxable,
    ...normalizeBillLineAmounts(line),
  }));
  const { subtotal, taxAmount, totalAmount } = calculateBillAmounts({ lines, taxable, taxRate });
  return { subtotal, taxRate, taxable, taxInclusive: false, taxAmount, totalAmount, lines: { create: lines } };
}

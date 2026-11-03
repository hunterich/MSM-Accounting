export interface InvoiceExportRow {
  number: string;
  issueDate: Date;
  dueDate: Date | null;
  status: string;
  currency: string;
  totalAmount: { toString(): string };
  customer: { name: string; code: string | null };
}

/** Spreadsheet text is never interpreted as a formula; amounts stay numeric. */
function textCell(value: string | null): string {
  let text = value ?? '';
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
export function invoiceExportCsv(rows: InvoiceExportRow[]): string {
  const header = 'Invoice number,Issue date,Due date,Customer code,Customer name,Status,Currency,Total';
  const lines = rows.map(row => [
    textCell(row.number), row.issueDate.toISOString().slice(0, 10),
    row.dueDate?.toISOString().slice(0, 10) ?? '', textCell(row.customer.code),
    textCell(row.customer.name), textCell(row.status), textCell(row.currency),
    row.totalAmount.toString(),
  ].join(','));
  return [header, ...lines].join('\r\n');
}

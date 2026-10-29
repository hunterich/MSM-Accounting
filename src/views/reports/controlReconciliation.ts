import type {
  ControlReconciliation,
  ControlAccountReconciliation,
} from '../../../lib/control-reconciliation';
export const controlReconciliationKind = (
  id: string,
): 'ar' | 'ap' | undefined =>
  id === 'ar-control-reconciliation'
    ? 'ar'
    : id === 'ap-control-reconciliation'
      ? 'ap'
      : undefined;
export const controlNeedsReview = (row: ControlAccountReconciliation) =>
  Math.abs(row.difference) >= 0.005 || row.items.length > 0;
export function controlReviewSummary(data: ControlReconciliation) {
  const count = data.accounts.filter(controlNeedsReview).length;
  return !data.accounts.length
    ? 'No control accounts found. Review company account setup.'
    : count
      ? `Review required: ${count} control account${count === 1 ? '' : 's'}. Company totals can hide offsetting differences.`
      : 'No differences identified in the selected control accounts.';
}
// Financial numbers remain numeric. Free-text cells cannot become spreadsheet formulas.
function cell(value: string | number) {
  let text = String(value);
  if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
export function controlReconciliationCsv(data: ControlReconciliation) {
  const rows: Array<Array<string | number>> = [
    [
      'Account',
      'Category',
      'Reference',
      'Date',
      'GL',
      'Subledger',
      'Difference',
      'Details',
    ],
  ];
  const date = data.asOf.slice(0, 10);
  rows.push([
    data.kind.toUpperCase(),
    'SUMMARY',
    'Company totals',
    date,
    data.totals.glBalance,
    data.totals.subledgerBalance,
    data.totals.difference,
    controlReviewSummary(data),
  ]);
  for (const row of data.accounts) {
    const name = `${row.accountCode} ${row.accountName}`;
    rows.push([
      name,
      'ACCOUNT',
      row.isDefault ? 'Default control' : 'Other control',
      date,
      row.glBalance,
      row.subledgerBalance,
      row.difference,
      controlNeedsReview(row) ? 'Review required' : 'No difference identified',
    ]);
    for (const [label, amount] of [
      ['Documents', row.subledger.documents],
      ['Settlements', row.subledger.settlements],
      ['Notes', row.subledger.notes],
      ['Opening subledger', row.subledger.opening],
    ] as const)
      rows.push([name, 'COMPONENT', label, date, '', amount, '', '']);
    rows.push([
      name,
      'COMPONENT',
      'Opening GL',
      date,
      row.opening.gl,
      '',
      '',
      '',
    ]);
    for (const item of row.items)
      rows.push([
        name,
        item.category,
        item.reference,
        item.date ?? '',
        '',
        '',
        item.amount,
        [item.entryNo, item.source, item.message].filter(Boolean).join(' | '),
      ]);
  }
  return rows.map((row) => row.map(cell).join(',')).join('\n');
}

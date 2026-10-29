import React from 'react';
import type { ControlReconciliation } from '../../../lib/control-reconciliation';
import { formatIDR, formatDateID } from '../../utils/formatters';
import {
  controlNeedsReview,
  controlReviewSummary,
} from './controlReconciliation';
export default function ControlReconciliationReport({
  data,
}: {
  data: ControlReconciliation;
}) {
  const needsReview =
    !data.accounts.length || data.accounts.some(controlNeedsReview);
  return (
    <div className="space-y-4">
      <div
        role="status"
        className={
          'rounded-lg border p-3 ' +
          (needsReview
            ? 'border-amber-300 bg-amber-50 text-amber-900'
            : 'border-green-200 bg-green-50 text-green-900')
        }
      >
        {controlReviewSummary(data)}
      </div>
      <p className="text-sm text-neutral-600">
        As of {formatDateID(data.asOf)}.{' '}
        {data.kind === 'ar'
          ? 'Receivables use debit minus credit.'
          : 'Payables use credit minus debit.'}{' '}
        Difference = GL minus independently calculated subledger. Advances and
        standalone notes are included.
      </p>
      <div className="overflow-x-auto">
        <table
          aria-label="Control account reconciliation"
          className="w-full text-sm text-left"
        >
          <thead>
            <tr>
              {[
                'Account',
                'GL balance',
                'Subledger balance',
                'Difference',
                'Review',
              ].map((label) => (
                <th key={label} className="p-2 border-b">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((row) => (
              <tr key={row.accountId}>
                <td className="p-2 border-b">
                  {row.accountCode} — {row.accountName}
                  {row.isDefault && (
                    <span className="ml-2 text-xs">Default control</span>
                  )}
                </td>
                <td className="p-2 border-b tabular-nums">
                  {formatIDR(row.glBalance)}
                </td>
                <td className="p-2 border-b tabular-nums">
                  {formatIDR(row.subledgerBalance)}
                </td>
                <td className="p-2 border-b tabular-nums">
                  {formatIDR(row.difference)}
                </td>
                <td className="p-2 border-b">
                  {controlNeedsReview(row)
                    ? 'Review required'
                    : 'No difference identified'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="p-2">Company totals</td>
              <td className="p-2">{formatIDR(data.totals.glBalance)}</td>
              <td className="p-2">{formatIDR(data.totals.subledgerBalance)}</td>
              <td className="p-2">{formatIDR(data.totals.difference)}</td>
              <td className="p-2">Review each account above</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {data.accounts.map((row) => (
        <section
          key={row.accountId}
          aria-label={'Reconciliation details for ' + row.accountCode}
          className="border rounded-lg p-3 break-inside-avoid"
        >
          <h3 className="font-semibold">
            {row.accountCode} — {row.accountName}
          </h3>
          <dl className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm my-3">
            {[
              ['Documents', row.subledger.documents],
              ['Settlements', row.subledger.settlements],
              ['Notes', row.subledger.notes],
              ['Opening subledger', row.subledger.opening],
              ['Opening GL', row.opening.gl],
            ].map(([label, amount]) => (
              <div key={String(label)}>
                <dt className="text-neutral-600">{label}</dt>
                <dd className="font-medium">{formatIDR(Number(amount))}</dd>
              </div>
            ))}
          </dl>
          {row.items.length ? (
            <ul className="space-y-2 text-sm">
              {row.items.map((item, index) => (
                <li key={index} className="border-t pt-2">
                  <span className="font-semibold">
                    {item.category} · {item.reference} ·{' '}
                    {formatIDR(item.amount)}
                  </span>
                  <div>
                    {[
                      item.date ? formatDateID(item.date) : null,
                      item.entryNo,
                      item.source,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  <p className="whitespace-pre-wrap">{item.message}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-500">
              No named differences for this account.
            </p>
          )}
        </section>
      ))}
      <p className="text-xs text-neutral-600">
        Read-only reconciliation. Confirm the control-account scope and
        historical warnings with finance. Differences are shown for review; this
        report does not create balancing entries or change whether a period may
        close.
      </p>
    </div>
  );
}

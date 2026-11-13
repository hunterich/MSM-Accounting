import React from 'react';
import { formatIDR } from '../../utils/formatters';
import { renderEmptyReport, type ReportResultProps } from './reportResultHelpers';
import type { StockMovementRow, StockValuationData } from './reportTypes';

export default function InventoryReportResult({ activeReport, categoryNameById }: ReportResultProps): React.ReactNode {
  const { report, data } = activeReport;
  if (report.id === 'stock-movement') {
    const smData = data as { rows: StockMovementRow[] };
    const smRows = smData.rows || [];
    if (!smRows.length) return renderEmptyReport('No stock movement data found for the selected period.');
    return (
      <div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-blue-50">
              <th className="p-3 text-left font-semibold border border-neutral-300 w-[140px]">SKU</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Item Name</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Opening</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">In</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Out</th>
              <th className="p-3 text-right font-semibold border border-neutral-300">Closing</th>
            </tr>
          </thead>
          <tbody>
            {smRows.map((row) => (
              <tr key={row.itemId} className="hover:bg-neutral-50">
                <td className="p-3 border border-neutral-200 font-mono text-xs">{row.sku}</td>
                <td className="p-3 border border-neutral-200">{row.itemName}</td>
                <td className="p-3 border border-neutral-200 text-right">{Number(row.openingBalance).toFixed(2)}</td>
                <td className="p-3 border border-neutral-200 text-right text-success-700">{Number(row.totalIn).toFixed(2)}</td>
                <td className="p-3 border border-neutral-200 text-right text-danger-600">{Number(row.totalOut).toFixed(2)}</td>
                <td className="p-3 border border-neutral-200 text-right font-medium">{Number(row.closingBalance).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (report.id === 'stock-valuation') {
    const valData = data as StockValuationData;
    const valRows = valData.items || [];
    if (!valRows.length) return renderEmptyReport('No inventory on hand for the selected filters.');
    const totalValue = valData.summary?.totalValue
      ?? valRows.reduce((s, r) => s + r.totalValue, 0);
    return (
      <div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-blue-50">
              <th className="p-3 text-left font-semibold border border-neutral-300 w-[140px]">SKU</th>
              <th className="p-3 text-left font-semibold border border-neutral-300">Item Name</th>
              <th className="p-3 text-left font-semibold border border-neutral-300 w-[160px]">Category</th>
              <th className="p-3 text-right font-semibold border border-neutral-300 w-[120px]">Qty on Hand</th>
              <th className="p-3 text-right font-semibold border border-neutral-300 w-[160px]">Avg Unit Cost</th>
              <th className="p-3 text-right font-semibold border border-neutral-300 w-[180px]">Total Value</th>
            </tr>
          </thead>
          <tbody>
            {valRows.map((row) => (
              <tr key={row.itemId} className="hover:bg-neutral-50">
                <td className="p-3 border border-neutral-200 font-mono text-xs">{row.sku}</td>
                <td className="p-3 border border-neutral-200">{row.name}</td>
                <td className="p-3 border border-neutral-200 text-neutral-600">
                  {(row.categoryId && categoryNameById.get(row.categoryId)) || '—'}
                </td>
                <td className="p-3 border border-neutral-200 text-right">{Number(row.totalQty).toLocaleString('id-ID')}</td>
                <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.avgCost)}</td>
                <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.totalValue)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-neutral-50 font-semibold">
              <td className="p-3 border border-neutral-300 text-right" colSpan={5}>Total Inventory Value</td>
              <td className="p-3 border border-neutral-300 text-right text-primary-700">{formatIDR(totalValue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }
  return null;
}

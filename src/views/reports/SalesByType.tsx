import React, { useMemo, useState } from 'react';
import Card from '../../components/UI/Card';
import { formatIDR } from '../../utils/formatters';
import { useSalesByType } from '../../hooks/useSalesTypes';

/** First day of the current month (WIB), as YYYY-MM-DD. */
function currentMonthStart(): string {
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Today (WIB), as YYYY-MM-DD. */
function today(): string {
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, '0')}-${String(wib.getUTCDate()).padStart(2, '0')}`;
}

const CHANNEL_LABEL: Record<string, string> = {
  ONLINE: 'Online',
  OFFLINE: 'Offline',
};

const SalesByType = () => {
  const [from, setFrom] = useState<string>(currentMonthStart());
  const [to, setTo] = useState<string>(today());

  const { data, isLoading } = useSalesByType(from, to);
  const rows = data?.data ?? [];

  const totals = useMemo(() => {
    let online = 0;
    let offline = 0;
    let gross = 0;
    let count = 0;
    for (const r of rows) {
      gross += r.gross;
      count += r.count;
      if (r.channel === 'ONLINE') online += r.gross;
      else if (r.channel === 'OFFLINE') offline += r.gross;
    }
    return { online, offline, gross, count };
  }, [rows]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Sales by Type</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
          <span className="text-sm text-gray-500">to</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
      </div>

      {/* Online vs offline summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <div className="text-xs uppercase tracking-wide text-gray-500">Online</div>
          <div className="text-lg font-semibold">{formatIDR(totals.online)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-gray-500">Offline</div>
          <div className="text-lg font-semibold">{formatIDR(totals.offline)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-gray-500">Total gross</div>
          <div className="text-lg font-semibold">{formatIDR(totals.gross)}</div>
        </Card>
      </div>

      <Card>
        {isLoading ? (
          <div className="p-6 text-sm text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">No sales in this date range yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 px-3">Sales Type</th>
                  <th className="py-2 px-3">Channel</th>
                  <th className="py-2 px-3 text-right">Invoices</th>
                  <th className="py-2 px-3 text-right">Gross</th>
                  <th className="py-2 px-3 text-right">Net (pre-tax)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id ?? 'untagged'} className="border-b last:border-0">
                    <td className="py-2 px-3">{r.name}</td>
                    <td className="py-2 px-3">{r.channel ? (CHANNEL_LABEL[r.channel] ?? r.channel) : '—'}</td>
                    <td className="py-2 px-3 text-right">{r.count}</td>
                    <td className="py-2 px-3 text-right">{formatIDR(r.gross)}</td>
                    <td className="py-2 px-3 text-right">{formatIDR(r.netPreTax)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-2 px-3">Total</td>
                  <td className="py-2 px-3" />
                  <td className="py-2 px-3 text-right">{totals.count}</td>
                  <td className="py-2 px-3 text-right">{formatIDR(totals.gross)}</td>
                  <td className="py-2 px-3 text-right">
                    {formatIDR(rows.reduce((s, r) => s + r.netPreTax, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default SalesByType;

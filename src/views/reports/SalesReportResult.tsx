import { ChevronRight } from 'lucide-react';
import React, { Fragment, useState } from 'react';
import { api } from '../../api/apiClient';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { getStatusPillClass, type ReportResultProps } from './reportResultHelpers';
import type {
  CustomerDayRow,
  SalesByCustomerRow,
  SalesByItemCustomerRow,
  SalesByItemRow,
  SalesHistoryRow,
  SalesMonthlyRow,
  SalesReturnListRow,
  SalesShareItemRow,
  SalesShareRow,
} from './reportTypes';

const SHARE_PALETTE = ['#3b6bd6', '#d2451e', '#f59e0b', '#16a34a', '#9333ea', '#0ea5c6', '#db2777', '#65a30d'];

const ShareBreakdown: React.FC<{
  rows: { label: string; total: number; isOthers?: boolean }[];
  grandTotal: number;
}> = ({ rows: inputRows, grandTotal }) => {
  const rows = inputRows.filter((r) => r.total > 0);
  if (rows.length === 0 || grandTotal <= 0) {
    return <div className="py-10 text-center text-sm text-neutral-500">Tidak ada penjualan pada periode ini.</div>;
  }
  let palIdx = 0;
  const slices = rows.map((r) => ({
    ...r,
    color: r.isOthers ? '#94a3b8' : SHARE_PALETTE[palIdx++ % SHARE_PALETTE.length],
    pct: (r.total / grandTotal) * 100,
  }));
  const R = 110;
  let angle = -Math.PI / 2;
  const paths = slices.map((sl) => {
    const sweep = (sl.total / grandTotal) * Math.PI * 2;
    const a0 = angle;
    angle += sweep;
    if (slices.length === 1) return { ...sl, d: '' };
    const large = sweep > Math.PI ? 1 : 0;
    const x0 = R * Math.cos(a0), y0 = R * Math.sin(a0);
    const x1 = R * Math.cos(a0 + sweep), y1 = R * Math.sin(a0 + sweep);
    return { ...sl, d: `M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z` };
  });
  return (
    <div className="flex flex-wrap items-center justify-center gap-10 py-4">
      <svg viewBox={`${-R - 4} ${-R - 4} ${R * 2 + 8} ${R * 2 + 8}`} className="w-[260px] h-[260px] shrink-0" role="img" aria-label="Diagram porsi penjualan">
        {paths.map((sl) => (
          sl.d
            ? <path key={sl.label} d={sl.d} fill={sl.color} stroke="#fff" strokeWidth={1.5}><title>{`${sl.label}: ${formatIDR(sl.total)} (${sl.pct.toFixed(1)}%)`}</title></path>
            : <circle key={sl.label} r={R} fill={sl.color} />
        ))}
      </svg>
      <div className="flex-1 min-w-[300px] max-w-[560px]">
        <table className="w-full text-sm tabular-nums">
          <tbody>
            {slices.map((sl) => (
              <tr key={sl.label} className="border-b border-neutral-200">
                <td className="py-2 pr-2 w-4"><span className="block w-3 h-3 rounded-full print:[print-color-adjust:exact]" style={{ background: sl.color }} /></td>
                <td className="py-2 pr-3">{sl.label}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{formatIDR(sl.total)}</td>
                <td className="py-2 text-right w-16 text-neutral-600">{sl.pct.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td />
              <td className="py-2">Total</td>
              <td className="py-2 text-right whitespace-nowrap">{formatIDR(grandTotal)}</td>
              <td className="py-2 text-right">100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

export default function SalesReportResult({ activeReport }: ReportResultProps): React.ReactNode {
  const [customerDays, setCustomerDays] = useState<Record<string, { open: boolean; loading: boolean; days: CustomerDayRow[]; error?: string }>>({});
  // eslint-disable-next-line complexity
  // Drill-down for Sales by Customer: click a customer's total to see its per-day orders.
  const toggleCustomerDays = async (row: SalesByCustomerRow) => {
    const id = row.customerId;
    if (!id || !activeReport) return;
    const key = `${activeReport.params.dateFrom}|${activeReport.params.dateTo}|${id}`;
    const current = customerDays[key];
    if (current && !current.error) {
      setCustomerDays((prev) => ({ ...prev, [key]: { ...current, open: !current.open } }));
      return;
    }
    setCustomerDays((prev) => ({ ...prev, [key]: { open: true, loading: true, days: [] } }));
    try {
      const res = await api.get<{ rows: CustomerDayRow[] }>('/api/v1/reports/sales', {
        type: 'by-customer-daily',
        customerId: id,
        dateFrom: activeReport.params.dateFrom,
        dateTo: activeReport.params.dateTo,
      });
      setCustomerDays((prev) => ({ ...prev, [key]: { open: true, loading: false, days: res.rows } }));
    } catch (e) {
      setCustomerDays((prev) => ({
        ...prev,
        [key]: { open: true, loading: false, days: [], error: e instanceof Error ? e.message : 'Gagal memuat rincian' },
      }));
    }
  };

  const { report, data } = activeReport;
  if (report.id === 'by-customer') {
    const rows = (data as { rows: SalesByCustomerRow[]; grandTotal: number });
    const totalInvoices = rows.rows.reduce((s, r) => s + r.invoiceCount, 0);
    const fmtInt = (n: number) => n.toLocaleString('id-ID');
    const fmtPct = (n: number) => `${n.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    if (rows.rows.length === 0) {
      return <div className="py-10 text-center text-sm text-neutral-500">Tidak ada penjualan pada periode ini.</div>;
    }
    return (
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr className="bg-blue-50">
            <th className="p-3 text-center font-semibold border border-neutral-300 w-[52px]">#</th>
            <th className="p-3 text-left font-semibold border border-neutral-300">Pelanggan</th>
            <th className="p-3 text-right font-semibold border border-neutral-300 w-[110px]">Jml Invoice</th>
            <th className="p-3 text-right font-semibold border border-neutral-300 w-[170px]">Rata-rata / Invoice</th>
            <th className="p-3 text-right font-semibold border border-neutral-300 w-[170px]">Penjualan</th>
            <th className="p-3 text-left font-semibold border border-neutral-300 w-[190px]">Kontribusi</th>
          </tr>
        </thead>
        <tbody>
          {rows.rows.map((row, i) => {
            const pct = rows.grandTotal > 0 ? (row.total / rows.grandTotal) * 100 : 0;
            const dayKey = `${activeReport.params.dateFrom}|${activeReport.params.dateTo}|${row.customerId}`;
            const detail = row.customerId ? customerDays[dayKey] : undefined;
            return (
              <Fragment key={row.customerId ?? i}>
                <tr className="hover:bg-neutral-50">
                  <td className="p-3 border border-neutral-200 text-center text-neutral-500">{i + 1}</td>
                  <td className="p-3 border border-neutral-200">{row.customerName}</td>
                  <td className="p-3 border border-neutral-200 text-right">{fmtInt(row.invoiceCount)}</td>
                  <td className="p-3 border border-neutral-200 text-right text-neutral-600">
                    {formatIDR(row.invoiceCount > 0 ? row.total / row.invoiceCount : 0)}
                  </td>
                  <td className="p-3 border border-neutral-200 text-right font-medium">
                    {row.customerId ? (
                      <button
                        type="button"
                        onClick={() => toggleCustomerDays(row)}
                        title="Klik untuk melihat rincian per hari"
                        className="inline-flex items-center gap-1 text-primary-700 hover:underline print:no-underline print:text-inherit"
                      >
                        <ChevronRight size={14} className={`print:hidden transition-transform ${detail?.open ? 'rotate-90' : ''}`} />
                        {formatIDR(row.total)}
                      </button>
                    ) : formatIDR(row.total)}
                  </td>
                  <td className="p-3 border border-neutral-200">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-neutral-100 overflow-hidden print:border print:border-neutral-300">
                        <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <span className="w-12 text-right text-xs text-neutral-600">{fmtPct(pct)}</span>
                    </div>
                  </td>
                </tr>
                {detail?.open && (
                  <tr>
                    <td className="border border-neutral-200 bg-neutral-50" />
                    <td colSpan={5} className="px-3 py-2 border border-neutral-200 bg-neutral-50">
                      {detail.loading ? (
                        <span className="text-xs text-neutral-500">Memuat rincian...</span>
                      ) : detail.error ? (
                        <span className="text-xs text-danger-600">{detail.error}</span>
                      ) : (
                        <table className="w-full text-xs">
                          <tbody>
                            {detail.days.map((d) => (
                              <tr key={d.date} className="border-b border-neutral-200 last:border-0">
                                <td className="py-1.5">
                                  {new Date(`${d.date}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
                                </td>
                                <td className="py-1.5 text-right w-[110px] text-neutral-600">{fmtInt(d.invoiceCount)} order</td>
                                <td className="py-1.5 text-right w-[170px] font-medium">{formatIDR(d.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-blue-50 font-bold">
            <td className="p-3 border border-neutral-300" />
            <td className="p-3 border border-neutral-300">
              Total <span className="font-normal text-neutral-500">({fmtInt(rows.rows.length)} pelanggan)</span>
            </td>
            <td className="p-3 border border-neutral-300 text-right">{fmtInt(totalInvoices)}</td>
            <td className="p-3 border border-neutral-300 text-right">
              {formatIDR(totalInvoices > 0 ? rows.grandTotal / totalInvoices : 0)}
            </td>
            <td className="p-3 border border-neutral-300 text-right">{formatIDR(rows.grandTotal)}</td>
            <td className="p-3 border border-neutral-300 text-right text-xs">100%</td>
          </tr>
        </tfoot>
      </table>
    );
  }

  if (report.id === 'by-item') {
    const rows = (data as { rows: SalesByItemRow[]; grandTotal: number });
    return (
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-blue-50">
            <th className="p-3 text-left font-semibold border border-neutral-300">Barang</th>
            <th className="p-3 text-right font-semibold border border-neutral-300 w-[100px]">Qty</th>
            <th className="p-3 text-right font-semibold border border-neutral-300 w-[180px]">Penjualan</th>
          </tr>
        </thead>
        <tbody>
          {rows.rows.map((row, i) => (
            <tr key={i} className="hover:bg-neutral-50">
              <td className="p-3 border border-neutral-200">{row.description}</td>
              <td className="p-3 border border-neutral-200 text-right">{Number(row.qty).toFixed(0)}</td>
              <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-blue-50 font-bold">
            <td className="p-3 border border-neutral-300">Total</td>
            <td className="p-3 border border-neutral-300 text-right">
              {rows.rows.reduce((sum, row) => sum + Number(row.qty), 0).toFixed(0)}
            </td>
            <td className="p-3 border border-neutral-300 text-right">{formatIDR(rows.grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    );
  }

  if (report.id === 'by-item-customer') {
    const rows = (data as { rows: SalesByItemCustomerRow[]; grandTotal: number });
    return (
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-blue-50">
            <th className="p-3 text-left font-semibold border border-neutral-300">Pelanggan</th>
            <th className="p-3 text-left font-semibold border border-neutral-300">Barang</th>
            <th className="p-3 text-right font-semibold border border-neutral-300 w-[100px]">Qty</th>
            <th className="p-3 text-right font-semibold border border-neutral-300 w-[180px]">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.rows.map((row, i) => (
            <tr key={i} className="hover:bg-neutral-50">
              <td className="p-3 border border-neutral-200">{row.customerName}</td>
              <td className="p-3 border border-neutral-200">{row.description}</td>
              <td className="p-3 border border-neutral-200 text-right">{Number(row.qty).toFixed(0)}</td>
              <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-blue-50 font-bold">
            <td colSpan={3} className="p-3 border border-neutral-300">Total</td>
            <td className="p-3 border border-neutral-300 text-right">{formatIDR(rows.grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    );
  }

  if (report.id === 'history') {
    const rows = (data as { rows: SalesHistoryRow[]; grandTotal: number });
    return (
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-blue-50">
            <th className="p-3 text-left font-semibold border border-neutral-300">No Faktur</th>
            <th className="p-3 text-left font-semibold border border-neutral-300 w-[120px]">Tanggal</th>
            <th className="p-3 text-left font-semibold border border-neutral-300">Pelanggan</th>
            <th className="p-3 text-left font-semibold border border-neutral-300 w-[100px]">Status</th>
            <th className="p-3 text-right font-semibold border border-neutral-300 w-[160px]">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.rows.map((row, i) => (
            <tr key={i} className="hover:bg-neutral-50">
              <td className="p-3 border border-neutral-200 font-mono text-xs">{row.number}</td>
              <td className="p-3 border border-neutral-200">{formatDateID(row.issueDate)}</td>
              <td className="p-3 border border-neutral-200">{row.customerName}</td>
              <td className="p-3 border border-neutral-200">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusPillClass(row.status)}`}>
                  {row.status}
                </span>
              </td>
              <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.totalAmount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-blue-50 font-bold">
            <td colSpan={4} className="p-3 border border-neutral-300">Total ({rows.rows.length} faktur)</td>
            <td className="p-3 border border-neutral-300 text-right">{formatIDR(rows.grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    );
  }

  if (report.id === 'sales-return-list') {
    const rows = (data as { rows: SalesReturnListRow[]; grandTotal: number });
    if (rows.rows.length === 0) {
      return <div className="py-10 text-center text-sm text-neutral-500">Tidak ada retur penjualan pada periode ini.</div>;
    }
    return (
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr className="bg-blue-50">
            <th className="p-3 text-left font-semibold border border-neutral-300">No Retur</th>
            <th className="p-3 text-left font-semibold border border-neutral-300 w-[120px]">Tanggal</th>
            <th className="p-3 text-left font-semibold border border-neutral-300">Pelanggan</th>
            <th className="p-3 text-left font-semibold border border-neutral-300">Faktur Asal</th>
            <th className="p-3 text-left font-semibold border border-neutral-300 w-[150px]">Status</th>
            <th className="p-3 text-right font-semibold border border-neutral-300 w-[160px]">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.rows.map((row) => (
            <tr key={row.id} className="hover:bg-neutral-50">
              <td className="p-3 border border-neutral-200 font-mono text-xs break-all">{row.number}</td>
              <td className="p-3 border border-neutral-200">{formatDateID(row.returnDate)}</td>
              <td className="p-3 border border-neutral-200">{row.customerName}</td>
              <td className="p-3 border border-neutral-200 font-mono text-xs break-all">{row.invoiceNumber || '—'}</td>
              <td className="p-3 border border-neutral-200">
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-neutral-100 text-neutral-600">
                  {row.status.replace(/_/g, ' ')}
                </span>
              </td>
              <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.totalAmount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-blue-50 font-bold">
            <td colSpan={5} className="p-3 border border-neutral-300">Total ({rows.rows.length.toLocaleString('id-ID')} retur)</td>
            <td className="p-3 border border-neutral-300 text-right">{formatIDR(rows.grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    );
  }

  if (report.id === 'monthly-chart') {
    const chartData = data as { rows: SalesMonthlyRow[]; grandTotal: number };
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

    // Fill months with no sales so gaps show as empty slots instead of being skipped.
    const byMonth = new Map(chartData.rows.map((r) => [r.month, r.total]));
    const months: SalesMonthlyRow[] = [];
    const from = activeReport.params.dateFrom;
    const to = activeReport.params.dateTo;
    if (from && to) {
      const cur = new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 1);
      const end = new Date(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, 1);
      while (cur <= end && months.length < 120) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
        months.push({ month: key, total: byMonth.get(key) ?? 0 });
        cur.setMonth(cur.getMonth() + 1);
      }
    } else {
      months.push(...chartData.rows);
    }
    if (months.length === 0 || chartData.grandTotal === 0) {
      return <div className="py-10 text-center text-sm text-neutral-500">Tidak ada penjualan pada periode ini.</div>;
    }

    const max = Math.max(...months.map((m) => m.total), 1);
    const rawStep = max / 4;
    const pow = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * pow).find((s) => s >= rawStep) ?? rawStep;
    const top = step * Math.ceil(max / step);
    const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
    const compact = (n: number) =>
      n >= 1e9 ? `${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`
        : n >= 1e6 ? `${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`
          : n.toLocaleString('id-ID');
    const monthLabel = (key: string) => {
      const [year, month] = key.split('-');
      return `${monthNames[parseInt(month, 10) - 1]} ${year}`;
    };
    const best = months.reduce((a, b) => (b.total > a.total ? b : a), months[0]);
    const avg = chartData.grandTotal / months.length;
    const CHART_H = 260;

    return (
      <div>
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Total Penjualan', value: formatIDR(chartData.grandTotal) },
            { label: 'Rata-rata / Bulan', value: formatIDR(avg) },
            { label: 'Bulan Tertinggi', value: `${monthLabel(best.month)} · ${formatIDR(best.total)}` },
          ].map((s) => (
            <div key={s.label} className="rounded-md border border-neutral-200 px-4 py-3">
              <div className="text-xs text-neutral-500">{s.label}</div>
              <div className="text-sm font-semibold text-neutral-900 mt-0.5 tabular-nums">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="flex overflow-x-auto pb-2">
          <div className="relative shrink-0 w-14 text-right pr-2 text-[10px] text-neutral-500 tabular-nums" style={{ height: CHART_H }}>
            {ticks.map((t) => (
              <div key={t} className="absolute right-2 -translate-y-1/2" style={{ bottom: `${(t / top) * 100}%`, transform: 'translateY(50%)' }}>
                {compact(t)}
              </div>
            ))}
          </div>
          <div className="flex-1 min-w-0">
            <div className="relative border-l border-b border-neutral-300" style={{ height: CHART_H, minWidth: months.length * 56 }}>
              {ticks.slice(1).map((t) => (
                <div key={t} className="absolute left-0 right-0 border-t border-dashed border-neutral-200" style={{ bottom: `${(t / top) * 100}%` }} />
              ))}
              <div className="absolute inset-0 flex items-end gap-2 px-2">
                {months.map((m) => (
                  <div key={m.month} className="flex-1 h-full flex flex-col justify-end items-center min-w-0" title={`${monthLabel(m.month)}: ${formatIDR(m.total)}`}>
                    {m.total > 0 && (
                      <div className="text-[10px] font-medium text-neutral-700 tabular-nums mb-1 whitespace-nowrap">
                        {months.length > 9 ? compact(m.total) : m.total.toLocaleString('id-ID')}
                      </div>
                    )}
                    <div
                      className="w-full max-w-[64px] rounded-t-sm bg-primary-500 print:[print-color-adjust:exact]"
                      style={{ height: `${(m.total / top) * (CHART_H - 20)}px`, minHeight: m.total > 0 ? 2 : 0 }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2 px-2 pt-1.5" style={{ minWidth: months.length * 56 }}>
              {months.map((m) => (
                <div key={m.month} className="flex-1 text-center text-[10px] text-neutral-600 min-w-0">{monthLabel(m.month)}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (report.id === 'share-by-item') {
    const d = data as { rows: SalesShareItemRow[]; grandTotal: number };
    return <ShareBreakdown rows={d.rows.map((r) => ({ label: r.description, total: r.total, isOthers: r.isOthers }))} grandTotal={d.grandTotal} />;
  }

  if (report.id === 'share-by-customer') {
    const d = data as { rows: SalesShareRow[]; grandTotal: number };
    return <ShareBreakdown rows={d.rows.map((r) => ({ label: r.customerName, total: r.total, isOthers: r.isOthers }))} grandTotal={d.grandTotal} />;
  }
  return null;
}

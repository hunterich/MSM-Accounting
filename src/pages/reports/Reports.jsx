import React, { useState } from 'react';
import {
  ShoppingCart, BookOpen, Landmark, ArrowDownLeft, ArrowUpRight, Package,
  Search, Printer, Download, X, LayoutGrid, BarChart3
} from 'lucide-react';
import { formatIDR, formatDateID } from '../../utils/formatters';
import { useSettingsStore } from '../../stores/useSettingsStore';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import { api } from '../../api/apiClient';

// ─── Icon Components ────────────────────────────────────────────────────────

const TableIcon = () => (
  <div className="w-12 h-12 rounded-lg bg-purple-50 flex items-center justify-center">
    <LayoutGrid size={24} className="text-purple-600" />
  </div>
);

const ChartIcon = () => (
  <div className="w-12 h-12 rounded-lg bg-orange-50 flex items-center justify-center">
    <BarChart3 size={24} className="text-orange-500" />
  </div>
);

// ─── Report Card ─────────────────────────────────────────────────────────────

const ReportCard = ({ report, onClick }) => (
  <button
    onClick={() => onClick(report)}
    className="flex items-start gap-4 p-4 bg-neutral-0 border border-neutral-200 rounded-lg text-left hover:border-primary-400 hover:shadow-sm transition-all cursor-pointer w-full"
  >
    {report.type === 'chart' ? <ChartIcon /> : <TableIcon />}
    <div>
      <div className="font-semibold text-neutral-900 text-sm mb-0.5">{report.name}</div>
      <div className="text-xs text-neutral-500 leading-relaxed">{report.description}</div>
    </div>
  </button>
);

// ─── Data Definitions ────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'sales',     label: 'Penjualan',  icon: ShoppingCart },
  { id: 'gl',        label: 'Buku Besar', icon: BookOpen },
  { id: 'banking',   label: 'Kas & Bank', icon: Landmark },
  { id: 'ar',        label: 'Piutang',    icon: ArrowDownLeft },
  { id: 'ap',        label: 'Utang',      icon: ArrowUpRight },
  { id: 'inventory', label: 'Persediaan', icon: Package },
];

const SALES_REPORTS = [
  {
    id: 'by-customer',
    name: 'Penjualan per Pelanggan',
    description: 'Menampilkan daftar nilai penjualan per pelanggan',
    type: 'table',
  },
  {
    id: 'by-item',
    name: 'Penjualan per Barang',
    description: 'Menampilkan daftar nilai penjualan per barang',
    type: 'table',
  },
  {
    id: 'by-item-customer',
    name: 'Penjualan Barang per Pelanggan',
    description: 'Menampilkan nilai penjualan barang per pelanggan',
    type: 'table',
  },
  {
    id: 'history',
    name: 'Histori Penjualan',
    description: 'Menampilkan riwayat faktur penjualan beserta status',
    type: 'table',
  },
  {
    id: 'monthly-chart',
    name: 'Grafik Penjualan Bulanan',
    description: 'Menampilkan grafik batang penjualan per bulan',
    type: 'chart',
  },
  {
    id: 'share-by-customer',
    name: 'Porsi Penjualan per Pelanggan',
    description: 'Menampilkan porsi penjualan dari pelanggan',
    type: 'chart',
  },
];

// ─── Date Helpers ─────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

// ─── Main Component ───────────────────────────────────────────────────────────

const Reports = () => {
  const company = useSettingsStore(s => s.companyInfo);

  const [activeCategory, setActiveCategory] = useState('sales');
  const [searchTerm, setSearchTerm] = useState('');

  // Parameter modal state
  const [paramModal, setParamModal] = useState(null); // null or report object
  const [dateFrom, setDateFrom] = useState(fmtDate(firstOfMonth));
  const [dateTo, setDateTo] = useState(fmtDate(today));

  // Report-specific filter state
  const [filterCustomer, setFilterCustomer] = useState('');
  const [topNCustomer, setTopNCustomer]     = useState(false);
  const [filterItem, setFilterItem]         = useState('');
  const [topNItem, setTopNItem]             = useState(false);
  const [itemSortBy, setItemSortBy]         = useState('total'); // 'total' | 'qty'

  // Report result state
  const [activeReport, setActiveReport] = useState(null); // { report, data, dateFrom, dateTo, params }
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const filteredReports = SALES_REPORTS.filter(r =>
    r.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCardClick = (report) => {
    // Reset filters when switching to a different report type
    if (!activeReport || activeReport.report.id !== report.id) {
      setFilterCustomer(''); setTopNCustomer(false);
      setFilterItem(''); setTopNItem(false); setItemSortBy('total');
    }
    setParamModal(report);
  };

  const handleRunReport = async () => {
    if (!paramModal) return;
    const reportToRun = paramModal;
    setParamModal(null);
    setIsLoading(true);
    setError(null);
    try {
      const params = { type: reportToRun.id, dateFrom, dateTo };
      if (reportToRun.id === 'by-customer') {
        if (filterCustomer) params.customerSearch = filterCustomer;
        if (topNCustomer)   params.topN = 30;
      }
      if (reportToRun.id === 'by-item') {
        if (filterItem)             params.itemSearch = filterItem;
        if (topNItem)               params.topN = 30;
        if (itemSortBy === 'qty')   params.sortBy = 'qty';
      }
      const data = await api.get('/api/v1/reports/sales', params);
      setActiveReport({ report: reportToRun, data, dateFrom, dateTo, params });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCsv = () => {
    if (!activeReport) return;
    const { report, data } = activeReport;
    let csv = '';
    if (report.id === 'by-customer') {
      csv = 'Pelanggan,Jumlah Invoice,Total Penjualan\n';
      csv += data.rows.map(r => `"${r.customerName}",${r.invoiceCount},${r.total}`).join('\n');
      csv += `\nTotal,,${data.grandTotal}`;
    } else if (report.id === 'by-item') {
      csv = 'Barang,Qty,Total Penjualan\n';
      csv += data.rows.map(r => `"${r.description}",${r.qty},${r.total}`).join('\n');
      csv += `\nTotal,,${data.grandTotal}`;
    } else if (report.id === 'history') {
      csv = 'No Faktur,Tanggal,Pelanggan,Status,Total\n';
      csv += data.rows.map(r => `"${r.number}","${r.issueDate}","${r.customerName}","${r.status}",${r.totalAmount}`).join('\n');
    } else if (report.id === 'by-item-customer') {
      csv = 'Pelanggan,Barang,Qty,Total\n';
      csv += data.rows.map(r => `"${r.customerName}","${r.description}",${r.qty},${r.total}`).join('\n');
    } else if (report.id === 'monthly-chart') {
      csv = 'Bulan,Total Penjualan\n';
      csv += data.rows.map(r => `"${r.month}",${r.total}`).join('\n');
    } else if (report.id === 'share-by-customer') {
      csv = 'Pelanggan,Total,Porsi (%)\n';
      csv += data.rows.map(r =>
        `"${r.customerName}",${r.total},${data.grandTotal > 0 ? ((r.total / data.grandTotal) * 100).toFixed(1) : 0}`
      ).join('\n');
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.id}-${activeReport.dateFrom}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Report Result Renderer ───────────────────────────────────────────────

  const renderReportResult = () => {
    if (isLoading) return <div className="p-12 text-center text-neutral-500">Memuat laporan...</div>;
    if (error) return <div className="p-8 text-center text-danger-600">Error: {error}</div>;
    if (!activeReport) return null;
    const { report, data } = activeReport;

    if (report.id === 'by-customer') {
      return (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-blue-50">
              <th className="p-3 text-left font-semibold border border-neutral-300">Pelanggan</th>
              <th className="p-3 text-right font-semibold border border-neutral-300 w-[120px]">Jml Invoice</th>
              <th className="p-3 text-right font-semibold border border-neutral-300 w-[180px]">Penjualan</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i} className="hover:bg-neutral-50">
                <td className="p-3 border border-neutral-200">{row.customerName}</td>
                <td className="p-3 border border-neutral-200 text-right">{row.invoiceCount}</td>
                <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-blue-50 font-bold">
              <td className="p-3 border border-neutral-300">Total Pelanggan</td>
              <td className="p-3 border border-neutral-300 text-right">{data.rows.length}</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(data.grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      );
    }

    if (report.id === 'by-item') {
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
            {data.rows.map((row, i) => (
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
                {data.rows.reduce((s, r) => s + Number(r.qty), 0).toFixed(0)}
              </td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(data.grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      );
    }

    if (report.id === 'by-item-customer') {
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
            {data.rows.map((row, i) => (
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
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(data.grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      );
    }

    if (report.id === 'history') {
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
            {data.rows.map((row, i) => (
              <tr key={i} className="hover:bg-neutral-50">
                <td className="p-3 border border-neutral-200 font-mono text-xs">{row.number}</td>
                <td className="p-3 border border-neutral-200">{formatDateID(row.issueDate)}</td>
                <td className="p-3 border border-neutral-200">{row.customerName}</td>
                <td className="p-3 border border-neutral-200">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    row.status === 'PAID'    ? 'bg-success-50 text-success-700' :
                    row.status === 'OVERDUE' ? 'bg-danger-50 text-danger-700' :
                    row.status === 'SENT'    ? 'bg-primary-50 text-primary-700' :
                    'bg-neutral-100 text-neutral-600'
                  }`}>{row.status}</span>
                </td>
                <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-blue-50 font-bold">
              <td colSpan={4} className="p-3 border border-neutral-300">Total ({data.rows.length} faktur)</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(data.grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      );
    }

    if (report.id === 'monthly-chart') {
      const max = Math.max(...data.rows.map(r => r.total), 1);
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return (
        <div>
          <div className="flex items-end gap-2 h-[280px] px-4 pb-8 pt-4 overflow-x-auto">
            {data.rows.map((row, i) => {
              const pct = (row.total / max) * 100;
              const [year, month] = row.month.split('-');
              const label = `${monthNames[parseInt(month) - 1]} ${year}`;
              return (
                <div key={i} className="flex flex-col items-center gap-1 flex-1 min-w-[60px]">
                  <div className="text-xs font-medium text-neutral-600">{formatIDR(row.total)}</div>
                  <div
                    className="w-full bg-primary-500 rounded-t-sm transition-all"
                    style={{ height: `${Math.max(pct * 2, 4)}px` }}
                    title={formatIDR(row.total)}
                  />
                  <div className="text-[10px] text-neutral-500 text-center leading-tight">{label}</div>
                </div>
              );
            })}
            {data.rows.length === 0 && (
              <div className="w-full text-center text-neutral-500 self-center">No data</div>
            )}
          </div>
          <div className="mt-4 pt-4 border-t border-neutral-200 flex justify-between items-center px-4">
            <span className="text-sm text-neutral-600">Total Penjualan</span>
            <span className="font-bold text-lg text-primary-700">{formatIDR(data.grandTotal)}</span>
          </div>
        </div>
      );
    }

    if (report.id === 'share-by-customer') {
      const colors = ['bg-primary-500','bg-success-500','bg-warning-500','bg-purple-500','bg-pink-500','bg-cyan-500'];
      return (
        <div className="space-y-3">
          {data.rows.map((row, i) => {
            const share = data.grandTotal > 0 ? (row.total / data.grandTotal) * 100 : 0;
            const color = colors[i % colors.length];
            return (
              <div key={i} className="flex items-center gap-3">
                <div className="w-[180px] text-sm text-neutral-700 truncate" title={row.customerName}>
                  {row.customerName}
                </div>
                <div className="flex-1 bg-neutral-100 rounded-full h-5 overflow-hidden">
                  <div className={`${color} h-full rounded-full transition-all`} style={{ width: `${share}%` }} />
                </div>
                <div className="w-[100px] text-right text-sm font-medium">{share.toFixed(1)}%</div>
                <div className="w-[140px] text-right text-sm text-neutral-600">{formatIDR(row.total)}</div>
              </div>
            );
          })}
          <div className="mt-4 pt-3 border-t border-neutral-200 flex justify-between font-bold">
            <span className="text-sm">Total</span>
            <span className="text-primary-700">{formatIDR(data.grandTotal)}</span>
          </div>
        </div>
      );
    }

    return <div className="p-8 text-center text-neutral-500">No renderer for this report type.</div>;
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0" style={{ height: 'calc(100vh - 56px)' }}>
      {/* Left category sidebar */}
      <div className="w-[200px] shrink-0 border-r border-neutral-200 bg-neutral-50 p-3 flex flex-col gap-1 overflow-y-auto">
        {CATEGORIES.map(cat => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.id}
              onClick={() => {
                setActiveCategory(cat.id); setActiveReport(null); setError(null);
                setFilterCustomer(''); setTopNCustomer(false);
                setFilterItem(''); setTopNItem(false); setItemSortBy('total');
              }}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors w-full ${
                activeCategory === cat.id
                  ? 'bg-primary-600 text-white'
                  : 'text-neutral-700 hover:bg-neutral-200'
              }`}
            >
              <Icon size={16} strokeWidth={1.8} />
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {activeCategory === 'sales' ? (
          <div className="p-6">
            {/* Category header + search */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-neutral-900">Penjualan</h2>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  placeholder="Cari laporan..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="h-9 pl-9 pr-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 w-[220px]"
                />
              </div>
            </div>

            {/* Report cards grid — only show when no active report */}
            {!activeReport && !isLoading && (
              <div className="grid grid-cols-2 gap-3 mb-6">
                {filteredReports.map(report => (
                  <ReportCard key={report.id} report={report} onClick={handleCardClick} />
                ))}
              </div>
            )}

            {/* Loading state */}
            {isLoading && (
              <div className="p-12 text-center text-neutral-500 text-sm">Memuat laporan...</div>
            )}

            {/* Error state (no active report yet) */}
            {error && !activeReport && !isLoading && (
              <div className="p-8 text-center text-danger-600 text-sm">
                Gagal memuat laporan: {error}
              </div>
            )}

            {/* Active report result */}
            {activeReport && !isLoading && (
              <div>
                {/* Report toolbar */}
                <div className="mb-4 pb-3 border-b border-neutral-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => { setActiveReport(null); setError(null); }}
                        className="flex items-center gap-1.5 text-sm text-neutral-600 hover:text-neutral-900"
                      >
                        <X size={14} /> Tutup
                      </button>
                      <div className="h-4 w-px bg-neutral-300" />
                      <span className="font-semibold text-neutral-900">{activeReport.report.name}</span>
                      <span className="text-xs text-neutral-500">
                        {formatDateID(activeReport.dateFrom)} s/d {formatDateID(activeReport.dateTo)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => window.print()}
                        className="flex items-center gap-1.5 h-8 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 hover:bg-neutral-100"
                      >
                        <Printer size={14} /> Print
                      </button>
                      <button
                        onClick={handleExportCsv}
                        className="flex items-center gap-1.5 h-8 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 hover:bg-neutral-100"
                      >
                        <Download size={14} /> Export CSV
                      </button>
                    </div>
                  </div>
                  {/* Active filter badges */}
                  {activeReport.params && (activeReport.params.customerSearch || activeReport.params.itemSearch || activeReport.params.topN || activeReport.params.sortBy === 'qty') && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="text-xs text-neutral-500">Filter aktif:</span>
                      {activeReport.params.customerSearch && (
                        <span className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full border border-primary-200">
                          Pelanggan: {activeReport.params.customerSearch}
                        </span>
                      )}
                      {activeReport.params.itemSearch && (
                        <span className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full border border-primary-200">
                          Barang: {activeReport.params.itemSearch}
                        </span>
                      )}
                      {activeReport.params.topN && (
                        <span className="text-xs bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full border border-orange-200">
                          Top {activeReport.params.topN}
                        </span>
                      )}
                      {activeReport.params.sortBy === 'qty' && (
                        <span className="text-xs bg-neutral-100 text-neutral-700 px-2 py-0.5 rounded-full border border-neutral-300">
                          Urut: Qty (pcs)
                        </span>
                      )}
                      <button
                        onClick={() => setParamModal(activeReport.report)}
                        className="text-xs text-primary-600 hover:text-primary-800 underline ml-1"
                      >
                        Ubah Filter
                      </button>
                    </div>
                  )}
                </div>

                {/* Report header (Accurate-style printed header) */}
                <div className="text-center mb-5">
                  <div className="text-sm font-semibold text-neutral-700 uppercase tracking-wide">
                    {company?.companyName || 'PT. Demo Accounting'}
                  </div>
                  <div className="text-lg font-bold text-primary-700 mt-1">{activeReport.report.name}</div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Dari {formatDateID(activeReport.dateFrom)} s/d {formatDateID(activeReport.dateTo)}
                  </div>
                </div>

                {/* Report content */}
                <div className="overflow-x-auto">
                  {renderReportResult()}
                </div>

                {/* Show other report cards below */}
                <div className="mt-8 pt-6 border-t border-neutral-200">
                  <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-3">
                    Laporan Lainnya
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {SALES_REPORTS.filter(r => r.id !== activeReport.report.id).map(report => (
                      <ReportCard key={report.id} report={report} onClick={handleCardClick} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          // Other categories — coming soon
          <div className="p-6">
            <h2 className="text-xl font-bold text-neutral-900 mb-2">
              {CATEGORIES.find(c => c.id === activeCategory)?.label}
            </h2>
            <div className="mt-12 text-center">
              <div className="text-neutral-400 text-5xl mb-4">📊</div>
              <div className="text-neutral-600 font-medium">Laporan akan segera tersedia</div>
              <div className="text-neutral-400 text-sm mt-1">Coming soon</div>
            </div>
          </div>
        )}
      </div>

      {/* Parameter Modal */}
      {paramModal && (
        <Modal
          isOpen={true}
          onClose={() => setParamModal(null)}
          title="Parameter Laporan"
          size="sm"
        >
          <div className="space-y-4">
            {/* Date range */}
            <div>
              <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Tanggal</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-neutral-600 mb-1">Dari</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                  />
                </div>
                <div>
                  <label className="block text-sm text-neutral-600 mb-1">s/d</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                  />
                </div>
              </div>
            </div>

            {/* by-customer: customer filter + top 30 */}
            {paramModal.id === 'by-customer' && (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Filter Pelanggan</div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-neutral-600 mb-1">Nama Pelanggan <span className="text-neutral-400">(opsional)</span></label>
                    <input
                      type="text"
                      value={filterCustomer}
                      onChange={e => setFilterCustomer(e.target.value)}
                      placeholder="Cari nama pelanggan..."
                      className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={topNCustomer}
                      onChange={e => setTopNCustomer(e.target.checked)}
                      className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-neutral-700">Top 30 Pelanggan <span className="text-neutral-400">(berdasarkan nilai penjualan)</span></span>
                  </label>
                </div>
              </div>
            )}

            {/* by-item: item filter + top 30 + sort by */}
            {paramModal.id === 'by-item' && (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Filter Barang</div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-neutral-600 mb-1">Nama Barang <span className="text-neutral-400">(opsional)</span></label>
                    <input
                      type="text"
                      value={filterItem}
                      onChange={e => setFilterItem(e.target.value)}
                      placeholder="Cari nama barang..."
                      className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={topNItem}
                      onChange={e => setTopNItem(e.target.checked)}
                      className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-neutral-700">Top 30 Barang</span>
                  </label>
                  <div>
                    <div className="text-sm text-neutral-600 mb-2">Urut berdasarkan</div>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="radio"
                          name="itemSortBy"
                          value="total"
                          checked={itemSortBy === 'total'}
                          onChange={() => setItemSortBy('total')}
                          className="w-4 h-4 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="text-sm text-neutral-700">Nilai Penjualan</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="radio"
                          name="itemSortBy"
                          value="qty"
                          checked={itemSortBy === 'qty'}
                          onChange={() => setItemSortBy('qty')}
                          className="w-4 h-4 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="text-sm text-neutral-700">Qty (pcs)</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button
                text="Tampilkan"
                variant="primary"
                onClick={handleRunReport}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Reports;

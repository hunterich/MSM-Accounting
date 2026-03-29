import React, { useEffect, useRef, useState } from 'react';
import {
  ShoppingCart, BookOpen, Landmark, ArrowDownLeft, ArrowUpRight, Package,
  Search, Printer, Download, X, LayoutGrid, BarChart3
} from 'lucide-react';
import { useReactToPrint } from 'react-to-print';
import { formatIDR, formatDateID } from '../../utils/formatters';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useCustomers } from '../../hooks/useAR';
import { useItems } from '../../hooks/useInventory';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { api } from '../../api/apiClient';

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

const CATEGORIES = [
  { id: 'sales', label: 'Penjualan', icon: ShoppingCart },
  { id: 'gl', label: 'Buku Besar', icon: BookOpen },
  { id: 'banking', label: 'Kas & Bank', icon: Landmark },
  { id: 'ar', label: 'Piutang', icon: ArrowDownLeft },
  { id: 'ap', label: 'Utang', icon: ArrowUpRight },
  { id: 'inventory', label: 'Persediaan', icon: Package },
];

const SALES_REPORTS = [
  {
    id: 'by-customer',
    category: 'sales',
    apiPath: '/api/v1/reports/sales',
    name: 'Penjualan per Pelanggan',
    description: 'Menampilkan daftar nilai penjualan per pelanggan',
    type: 'table',
    filterMode: 'date-range',
  },
  {
    id: 'by-item',
    category: 'sales',
    apiPath: '/api/v1/reports/sales',
    name: 'Penjualan per Barang',
    description: 'Menampilkan daftar nilai penjualan per barang',
    type: 'table',
    filterMode: 'date-range',
  },
  {
    id: 'by-item-customer',
    category: 'sales',
    apiPath: '/api/v1/reports/sales',
    name: 'Penjualan Barang per Pelanggan',
    description: 'Menampilkan nilai penjualan barang per pelanggan',
    type: 'table',
    filterMode: 'date-range',
  },
  {
    id: 'history',
    category: 'sales',
    apiPath: '/api/v1/reports/sales',
    name: 'Histori Penjualan',
    description: 'Menampilkan riwayat faktur penjualan beserta status',
    type: 'table',
    filterMode: 'date-range',
  },
  {
    id: 'monthly-chart',
    category: 'sales',
    apiPath: '/api/v1/reports/sales',
    name: 'Grafik Penjualan Bulanan',
    description: 'Menampilkan grafik batang penjualan per bulan',
    type: 'chart',
    filterMode: 'date-range',
  },
  {
    id: 'share-by-customer',
    category: 'sales',
    apiPath: '/api/v1/reports/sales',
    name: 'Porsi Penjualan per Pelanggan',
    description: 'Menampilkan porsi penjualan dari pelanggan',
    type: 'chart',
    filterMode: 'date-range',
  },
];

const AR_REPORTS = [
  {
    id: 'aging',
    category: 'ar',
    apiPath: '/api/v1/reports/ar',
    name: 'Umur Piutang',
    description: 'Menampilkan daftar piutang terbuka per invoice beserta bucket umur piutang.',
    type: 'table',
    filterMode: 'as-of',
  },
  {
    id: 'customer-balance',
    category: 'ar',
    apiPath: '/api/v1/reports/ar',
    name: 'Saldo Piutang per Pelanggan',
    description: 'Merangkum total tertagih, pembayaran, dan saldo piutang per pelanggan.',
    type: 'table',
    filterMode: 'as-of',
  },
  {
    id: 'overdue-list',
    category: 'ar',
    apiPath: '/api/v1/reports/ar',
    name: 'Daftar Tagihan Jatuh Tempo',
    description: 'Menampilkan invoice piutang yang sudah melewati jatuh tempo untuk follow-up koleksi.',
    type: 'table',
    filterMode: 'as-of',
  },
];

const GL_REPORTS = [
  {
    id: 'trial-balance',
    category: 'gl',
    apiPath: '/api/v1/reports/gl',
    name: 'Trial Balance',
    description: 'Shows debit, credit, and ending balances by general ledger account.',
    type: 'table',
    filterMode: 'as-of',
  },
  {
    id: 'balance-sheet',
    category: 'gl',
    apiPath: '/api/v1/reports/gl',
    name: 'Balance Sheet (Standard)',
    description: 'Shows assets, liabilities, and equity as of a selected date.',
    type: 'table',
    filterMode: 'as-of',
  },
  {
    id: 'balance-sheet-multi-period',
    category: 'gl',
    apiPath: '/api/v1/reports/gl',
    name: 'Balance Sheet (Multi-Period)',
    description: 'Compares two balance sheet dates side by side with variance.',
    type: 'table',
    filterMode: 'as-of',
  },
  {
    id: 'profit-loss',
    category: 'gl',
    apiPath: '/api/v1/reports/gl',
    name: 'Profit & Loss',
    description: 'Shows revenue, expenses, and net income for the selected period.',
    type: 'table',
    filterMode: 'date-range',
  },
];

const REPORTS_BY_CATEGORY = {
  sales: SALES_REPORTS,
  gl: GL_REPORTS,
  ar: AR_REPORTS,
};

const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
const REPORT_PRESETS_KEY = 'msm-report-presets';

const loadReportPresets = () => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(REPORT_PRESETS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const defaultCompareAsOfDate = () => fmtDate(new Date(today.getFullYear(), today.getMonth(), 0));

const escapeCsvCell = (value) => {
  if (value === null || value === undefined) return '';
  return `"${String(value).replace(/"/g, '""')}"`;
};

const getStatusPillClass = (status) => {
  if (status === 'PAID' || status === 'Completed') return 'bg-success-50 text-success-700';
  if (status === 'OVERDUE') return 'bg-danger-50 text-danger-700';
  if (status === 'SENT') return 'bg-primary-50 text-primary-700';
  return 'bg-neutral-100 text-neutral-600';
};

const buildSalesCsv = (report, data) => {
  if (report.id === 'by-customer') {
    let csv = 'Pelanggan,Jumlah Invoice,Total Penjualan\n';
    csv += data.rows.map((row) => [
      escapeCsvCell(row.customerName),
      row.invoiceCount,
      row.total,
    ].join(',')).join('\n');
    csv += `\nTotal,,${data.grandTotal}`;
    return csv;
  }

  if (report.id === 'by-item') {
    let csv = 'Barang,Qty,Total Penjualan\n';
    csv += data.rows.map((row) => [
      escapeCsvCell(row.description),
      row.qty,
      row.total,
    ].join(',')).join('\n');
    csv += `\nTotal,,${data.grandTotal}`;
    return csv;
  }

  if (report.id === 'history') {
    let csv = 'No Faktur,Tanggal,Pelanggan,Status,Total\n';
    csv += data.rows.map((row) => [
      escapeCsvCell(row.number),
      escapeCsvCell(row.issueDate),
      escapeCsvCell(row.customerName),
      escapeCsvCell(row.status),
      row.totalAmount,
    ].join(',')).join('\n');
    return csv;
  }

  if (report.id === 'by-item-customer') {
    let csv = 'Pelanggan,Barang,Qty,Total\n';
    csv += data.rows.map((row) => [
      escapeCsvCell(row.customerName),
      escapeCsvCell(row.description),
      row.qty,
      row.total,
    ].join(',')).join('\n');
    return csv;
  }

  if (report.id === 'monthly-chart') {
    let csv = 'Bulan,Total Penjualan\n';
    csv += data.rows.map((row) => [
      escapeCsvCell(row.month),
      row.total,
    ].join(',')).join('\n');
    return csv;
  }

  if (report.id === 'share-by-customer') {
    let csv = 'Pelanggan,Total,Porsi (%)\n';
    csv += data.rows.map((row) => [
      escapeCsvCell(row.customerName),
      row.total,
      data.grandTotal > 0 ? ((row.total / data.grandTotal) * 100).toFixed(1) : 0,
    ].join(',')).join('\n');
    return csv;
  }

  return '';
};

const buildArCsv = (report, data) => {
  const summary = data.summary || {};

  if (report.id === 'aging') {
    let csv = 'No Faktur,Tanggal Faktur,Jatuh Tempo,Pelanggan,Hari Lewat Jatuh Tempo,Nilai Faktur,Terlunasi,Saldo,Current,1-30,31-60,61-90,90+\n';
    csv += data.rows.map((row) => [
      escapeCsvCell(row.invoiceNumber),
      escapeCsvCell(row.invoiceDate),
      escapeCsvCell(row.dueDate),
      escapeCsvCell(row.customerName),
      row.daysOverdue,
      row.originalAmount,
      row.clearedAmount,
      row.balance,
      row.current,
      row.d1To30,
      row.d31To60,
      row.d61To90,
      row.d90Plus,
    ].join(',')).join('\n');
    csv += `\nTotal,,,,,,,${summary.totalOutstanding || 0},${summary.current || 0},${summary.d1To30 || 0},${summary.d31To60 || 0},${summary.d61To90 || 0},${summary.d90Plus || 0}`;
    return csv;
  }

  if (report.id === 'customer-balance') {
    let csv = 'Kode Pelanggan,Pelanggan,Total Ditagih,Total Dibayar,Saldo Piutang\n';
    csv += data.rows.map((row) => [
      escapeCsvCell(row.customerCode || ''),
      escapeCsvCell(row.customerName),
      row.invoicedAmount,
      row.paidAmount,
      row.outstandingAmount,
    ].join(',')).join('\n');
    csv += `\nTotal,,${summary.totalInvoiced || 0},${summary.totalPaid || 0},${summary.totalOutstanding || 0}`;
    return csv;
  }

  if (report.id === 'overdue-list') {
    let csv = 'No Faktur,Jatuh Tempo,Pelanggan,Hari Lewat Jatuh Tempo,Status,Saldo\n';
    csv += data.rows.map((row) => [
      escapeCsvCell(row.invoiceNumber),
      escapeCsvCell(row.dueDate),
      escapeCsvCell(row.customerName),
      row.daysOverdue,
      escapeCsvCell(row.status),
      row.balance,
    ].join(',')).join('\n');
    csv += `\nTotal Invoice Overdue,${summary.overdueInvoiceCount || 0},,,,${summary.overdueAmount || 0}`;
    return csv;
  }

  return '';
};

const buildGlCsv = (report, data) => {
  if (report.id === 'trial-balance') {
    let csv = 'Account Code,Account Name,Type,Total Debit,Total Credit,Ending Debit,Ending Credit\n';
    csv += data.rows.map((row) => [
      escapeCsvCell(row.accountCode),
      escapeCsvCell(row.accountName),
      escapeCsvCell(row.accountType),
      row.totalDebit,
      row.totalCredit,
      row.endingDebit,
      row.endingCredit,
    ].join(',')).join('\n');
    csv += `\nTotal,,,${data.summary.totalDebit || 0},${data.summary.totalCredit || 0},${data.summary.endingDebit || 0},${data.summary.endingCredit || 0}`;
    return csv;
  }

  if (report.id === 'profit-loss') {
    let csv = 'Section,Account Code,Account Name,Amount\n';
    csv += (data.sections || []).flatMap((section) => (
      section.rows.map((row) => [
        escapeCsvCell(section.label),
        escapeCsvCell(row.accountCode),
        escapeCsvCell(row.accountName),
        row.amount,
      ].join(','))
    )).join('\n');
    csv += `\nTotal Revenue,,,${data.summary.totalRevenue || 0}`;
    csv += `\nTotal Expenses,,,${data.summary.totalExpense || 0}`;
    csv += `\nNet Income,,,${data.summary.netIncome || 0}`;
    return csv;
  }

  if (report.id === 'balance-sheet') {
    let csv = 'Section,Account Code,Account Name,Amount\n';
    csv += (data.sections || []).flatMap((section) => (
      section.rows.map((row) => [
        escapeCsvCell(section.label),
        escapeCsvCell(row.accountCode),
        escapeCsvCell(row.accountName),
        row.amount,
      ].join(','))
    )).join('\n');
    csv += `\nTotal Assets,,,${data.summary.totalAssets || 0}`;
    csv += `\nTotal Liabilities,,,${data.summary.totalLiabilities || 0}`;
    csv += `\nTotal Equity,,,${data.summary.totalEquity || 0}`;
    csv += `\nTotal Liabilities + Equity,,,${data.summary.totalLiabilitiesAndEquity || 0}`;
    return csv;
  }

  if (report.id === 'balance-sheet-multi-period') {
    let csv = 'Section,Account Code,Account Name,Current Period,Compare Period,Variance\n';
    csv += (data.sections || []).flatMap((section) => (
      section.rows.map((row) => [
        escapeCsvCell(section.label),
        escapeCsvCell(row.accountCode),
        escapeCsvCell(row.accountName),
        row.currentAmount,
        row.compareAmount,
        row.variance,
      ].join(','))
    )).join('\n');
    csv += `\nTotal Assets,,,${data.summary.current.totalAssets || 0},${data.summary.compare.totalAssets || 0},${data.summary.variance.totalAssets || 0}`;
    csv += `\nTotal Liabilities,,,${data.summary.current.totalLiabilities || 0},${data.summary.compare.totalLiabilities || 0},${data.summary.variance.totalLiabilities || 0}`;
    csv += `\nTotal Equity,,,${data.summary.current.totalEquity || 0},${data.summary.compare.totalEquity || 0},${data.summary.variance.totalEquity || 0}`;
    return csv;
  }

  return '';
};

const Reports = () => {
  const company = useSettingsStore((s) => s.companyInfo);
  const { data: customersData } = useCustomers({ limit: 100 });
  const { data: itemsData } = useItems({ limit: 100 });
  const customers = customersData?.data || [];
  const items = itemsData?.data || [];
  const customerOptions = customers.map((customer) => ({
    value: customer.id,
    label: customer.name,
    subLabel: customer.code || undefined,
  }));
  const itemOptions = items.map((item) => ({
    value: item.id,
    label: item.name,
    subLabel: item.sku || undefined,
  }));
  const [activeCategory, setActiveCategory] = useState('sales');
  const [searchTerm, setSearchTerm] = useState('');

  const [paramModal, setParamModal] = useState(null);
  const [dateFrom, setDateFrom] = useState(fmtDate(firstOfMonth));
  const [dateTo, setDateTo] = useState(fmtDate(today));
  const [asOfDate, setAsOfDate] = useState(fmtDate(today));
  const [compareAsOfDate, setCompareAsOfDate] = useState(defaultCompareAsOfDate());
  const [filterCustomer, setFilterCustomer] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [topNCustomer, setTopNCustomer] = useState(false);
  const [filterItem, setFilterItem] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [topNItem, setTopNItem] = useState(false);
  const [itemSortBy, setItemSortBy] = useState('total');
  const [overdueStatus, setOverdueStatus] = useState('');

  const [openReports, setOpenReports] = useState([]);
  const [activeReportId, setActiveReportId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const printRef = useRef(null);
  const [reportPresets, setReportPresets] = useState(loadReportPresets);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(REPORT_PRESETS_KEY, JSON.stringify(reportPresets));
  }, [reportPresets]);

  useEffect(() => {
    if (!filterCustomer || selectedCustomerId || !customers.length) return;
    const matchedCustomer = customers.find(
      (customer) => customer.name.toLowerCase() === filterCustomer.toLowerCase()
    );
    if (matchedCustomer) {
      setSelectedCustomerId(matchedCustomer.id);
    }
  }, [customers, filterCustomer, selectedCustomerId]);

  useEffect(() => {
    if (!filterItem || selectedItemId || !items.length) return;
    const matchedItem = items.find(
      (item) => item.name.toLowerCase() === filterItem.toLowerCase()
    );
    if (matchedItem) {
      setSelectedItemId(matchedItem.id);
    }
  }, [items, filterItem, selectedItemId]);

  const categoryReports = REPORTS_BY_CATEGORY[activeCategory] || [];
  const activeCategoryMeta = CATEGORIES.find((category) => category.id === activeCategory);
  const activeReport = openReports.find((entry) => entry.report.id === activeReportId) || null;
  const filteredReports = categoryReports.filter((report) =>
    report.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: activeReport
      ? `${activeReport.report.id}-${activeReport.asOfDate || activeReport.dateFrom || 'report'}`
      : 'report',
  });

  const resetCategoryState = (categoryId) => {
    setActiveCategory(categoryId);
    setOpenReports([]);
    setActiveReportId(null);
    setError(null);
    setParamModal(null);
    setSearchTerm('');
    setFilterCustomer('');
    setSelectedCustomerId('');
    setFilterItem('');
    setSelectedItemId('');
  };

  const closeReportTab = (reportId) => {
    setOpenReports((prev) => {
      const next = prev.filter((entry) => entry.report.id !== reportId);
      if (activeReportId === reportId) {
        const currentIndex = prev.findIndex((entry) => entry.report.id === reportId);
        const fallback = next[Math.max(0, currentIndex - 1)] || next[0] || null;
        setActiveReportId(fallback?.report.id || null);
      }
      return next;
    });
  };

  const syncCustomerFilter = (customerSearch = '') => {
    const matchedCustomer = customers.find(
      (customer) => customer.name.toLowerCase() === String(customerSearch).toLowerCase()
    );
    setSelectedCustomerId(matchedCustomer?.id || '');
    setFilterCustomer(customerSearch || '');
  };

  const syncItemFilter = (itemSearch = '') => {
    const matchedItem = items.find(
      (item) => item.name.toLowerCase() === String(itemSearch).toLowerCase()
    );
    setSelectedItemId(matchedItem?.id || '');
    setFilterItem(itemSearch || '');
  };

  const openParamModal = (report, presetParams = null) => {
    const params = presetParams || reportPresets[report.id] || {};
    if (params.dateFrom) setDateFrom(params.dateFrom);
    if (params.dateTo) setDateTo(params.dateTo);
    if (params.asOfDate) setAsOfDate(params.asOfDate);
    if (params.compareAsOfDate) setCompareAsOfDate(params.compareAsOfDate);
    syncCustomerFilter(params.customerSearch || '');
    syncItemFilter(params.itemSearch || '');
    setTopNCustomer(Boolean(params.topN) && report.id === 'by-customer');
    setTopNItem(Boolean(params.topN) && report.id === 'by-item');
    setItemSortBy(params.sortBy === 'qty' ? 'qty' : 'total');
    setOverdueStatus(params.status || '');
    setParamModal(report);
  };

  const resetModalFilters = () => {
    if (!paramModal) return;

    setDateFrom(fmtDate(firstOfMonth));
    setDateTo(fmtDate(today));
    setAsOfDate(fmtDate(today));
    setCompareAsOfDate(defaultCompareAsOfDate());
    setFilterCustomer('');
    setSelectedCustomerId('');
    setTopNCustomer(false);
    setFilterItem('');
    setSelectedItemId('');
    setTopNItem(false);
    setItemSortBy('total');
    setOverdueStatus('');
    setReportPresets((prev) => {
      const next = { ...prev };
      delete next[paramModal.id];
      return next;
    });
  };

  const handleCardClick = (report) => {
    const presetParams = activeReport?.report.id === report.id ? activeReport.params : null;
    openParamModal(report, presetParams);
  };

  const buildRequestParams = (report) => {
    if (report.category === 'sales') {
      const params = { type: report.id, dateFrom, dateTo };
      if (report.id === 'by-customer') {
        if (filterCustomer) params.customerSearch = filterCustomer;
        if (topNCustomer) params.topN = 30;
      }
      if (report.id === 'by-item') {
        if (filterItem) params.itemSearch = filterItem;
        if (topNItem) params.topN = 30;
        if (itemSortBy === 'qty') params.sortBy = 'qty';
      }
      if (report.id === 'by-item-customer') {
        if (filterCustomer) params.customerSearch = filterCustomer;
        if (filterItem) params.itemSearch = filterItem;
      }
      return params;
    }

    if (report.category === 'ar') {
      const params = { type: report.id, asOfDate };
      if (filterCustomer) params.customerSearch = filterCustomer;
      if (report.id === 'overdue-list' && overdueStatus) params.status = overdueStatus;
      return params;
    }

    if (report.category === 'gl') {
      if (report.id === 'balance-sheet-multi-period') {
        return { type: report.id, asOfDate, compareAsOfDate };
      }
      if (report.filterMode === 'as-of') {
        return { type: report.id, asOfDate };
      }
      return { type: report.id, dateFrom, dateTo };
    }

    return { type: report.id };
  };

  const handleRunReport = async () => {
    if (!paramModal) return;
    const reportToRun = paramModal;
    setParamModal(null);
    setIsLoading(true);
    setError(null);

    try {
      const params = buildRequestParams(reportToRun);
      setReportPresets((prev) => ({
        ...prev,
        [reportToRun.id]: params,
      }));
      const data = await api.get(reportToRun.apiPath, params);
      const reportEntry = {
        report: reportToRun,
        data,
        params,
        dateFrom: reportToRun.filterMode === 'date-range' ? dateFrom : null,
        dateTo: reportToRun.filterMode === 'date-range' ? dateTo : null,
        asOfDate: reportToRun.filterMode === 'as-of' ? asOfDate : null,
      };

      setOpenReports((prev) => {
        const existingIndex = prev.findIndex((entry) => entry.report.id === reportToRun.id);
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = reportEntry;
          return next;
        }
        return [...prev, reportEntry];
      });
      setActiveReportId(reportToRun.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCsv = () => {
    if (!activeReport) return;

    const { report, data } = activeReport;
    const csv = report.category === 'ar'
      ? buildArCsv(report, data)
      : report.category === 'gl'
        ? buildGlCsv(report, data)
        : buildSalesCsv(report, data);

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.id}-${activeReport.asOfDate || activeReport.dateFrom || 'report'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderEmptyReport = (message) => (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-6 py-10 text-center text-sm text-neutral-500">
      {message}
    </div>
  );

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
                {data.rows.reduce((sum, row) => sum + Number(row.qty), 0).toFixed(0)}
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
              <td colSpan={4} className="p-3 border border-neutral-300">Total ({data.rows.length} faktur)</td>
              <td className="p-3 border border-neutral-300 text-right">{formatIDR(data.grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      );
    }

    if (report.id === 'monthly-chart') {
      const max = Math.max(...data.rows.map((row) => row.total), 1);
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      return (
        <div>
          <div className="flex items-end gap-2 h-[280px] px-4 pb-8 pt-4 overflow-x-auto">
            {data.rows.map((row, i) => {
              const pct = (row.total / max) * 100;
              const [year, month] = row.month.split('-');
              const label = `${monthNames[parseInt(month, 10) - 1]} ${year}`;

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
      const colors = ['bg-primary-500', 'bg-success-500', 'bg-warning-500', 'bg-purple-500', 'bg-pink-500', 'bg-cyan-500'];

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

    if (report.id === 'aging') {
      if (!data.rows.length) return renderEmptyReport('Tidak ada piutang terbuka pada tanggal yang dipilih.');

      return (
        <div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-blue-50">
                <th className="p-3 text-left font-semibold border border-neutral-300">No Faktur</th>
                <th className="p-3 text-left font-semibold border border-neutral-300">Tanggal</th>
                <th className="p-3 text-left font-semibold border border-neutral-300">Jatuh Tempo</th>
                <th className="p-3 text-left font-semibold border border-neutral-300">Pelanggan</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">Hari</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">Faktur</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">Terlunasi</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">Saldo</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">Current</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">1-30</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">31-60</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">61-90</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">90+</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.invoiceId} className="hover:bg-neutral-50">
                  <td className="p-3 border border-neutral-200 font-mono text-xs">{row.invoiceNumber}</td>
                  <td className="p-3 border border-neutral-200">{formatDateID(row.invoiceDate)}</td>
                  <td className="p-3 border border-neutral-200">{row.dueDate ? formatDateID(row.dueDate) : '—'}</td>
                  <td className="p-3 border border-neutral-200">{row.customerName}</td>
                  <td className="p-3 border border-neutral-200 text-right">
                    {row.daysOverdue > 0 ? <span className="text-danger-600 font-medium">{row.daysOverdue}</span> : 'Current'}
                  </td>
                  <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.originalAmount)}</td>
                  <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.clearedAmount)}</td>
                  <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.balance)}</td>
                  <td className="p-3 border border-neutral-200 text-right">{row.current ? formatIDR(row.current) : '—'}</td>
                  <td className="p-3 border border-neutral-200 text-right">{row.d1To30 ? formatIDR(row.d1To30) : '—'}</td>
                  <td className="p-3 border border-neutral-200 text-right">{row.d31To60 ? formatIDR(row.d31To60) : '—'}</td>
                  <td className="p-3 border border-neutral-200 text-right">{row.d61To90 ? formatIDR(row.d61To90) : '—'}</td>
                  <td className="p-3 border border-neutral-200 text-right">{row.d90Plus ? formatIDR(row.d90Plus) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 pt-4 border-t border-neutral-200 flex flex-wrap gap-4 text-sm font-semibold text-neutral-700">
            <span>Current: {formatIDR(data.summary.current || 0)}</span>
            <span>1-30: {formatIDR(data.summary.d1To30 || 0)}</span>
            <span>31-60: {formatIDR(data.summary.d31To60 || 0)}</span>
            <span>61-90: {formatIDR(data.summary.d61To90 || 0)}</span>
            <span>90+: {formatIDR(data.summary.d90Plus || 0)}</span>
            <span className="ml-auto text-primary-700">Total Outstanding: {formatIDR(data.summary.totalOutstanding || 0)}</span>
          </div>
        </div>
      );
    }

    if (report.id === 'customer-balance') {
      if (!data.rows.length) return renderEmptyReport('Tidak ada saldo piutang pelanggan pada tanggal yang dipilih.');

      return (
        <div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-blue-50">
                <th className="p-3 text-left font-semibold border border-neutral-300 w-[140px]">Kode</th>
                <th className="p-3 text-left font-semibold border border-neutral-300">Pelanggan</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">Total Ditagih</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">Total Dibayar</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">Saldo Piutang</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.customerId} className="hover:bg-neutral-50">
                  <td className="p-3 border border-neutral-200">{row.customerCode || '—'}</td>
                  <td className="p-3 border border-neutral-200">{row.customerName}</td>
                  <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.invoicedAmount)}</td>
                  <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.paidAmount)}</td>
                  <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.outstandingAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-blue-50 font-bold">
                <td colSpan={2} className="p-3 border border-neutral-300">Total ({data.summary.customerCount || 0} pelanggan)</td>
                <td className="p-3 border border-neutral-300 text-right">{formatIDR(data.summary.totalInvoiced || 0)}</td>
                <td className="p-3 border border-neutral-300 text-right">{formatIDR(data.summary.totalPaid || 0)}</td>
                <td className="p-3 border border-neutral-300 text-right">{formatIDR(data.summary.totalOutstanding || 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      );
    }

    if (report.id === 'overdue-list') {
      if (!data.rows.length) return renderEmptyReport('Tidak ada tagihan jatuh tempo pada tanggal yang dipilih.');

      return (
        <div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-blue-50">
                <th className="p-3 text-left font-semibold border border-neutral-300">No Faktur</th>
                <th className="p-3 text-left font-semibold border border-neutral-300">Jatuh Tempo</th>
                <th className="p-3 text-left font-semibold border border-neutral-300">Pelanggan</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">Hari</th>
                <th className="p-3 text-left font-semibold border border-neutral-300">Status</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.invoiceId} className="hover:bg-neutral-50">
                  <td className="p-3 border border-neutral-200 font-mono text-xs">{row.invoiceNumber}</td>
                  <td className="p-3 border border-neutral-200">{row.dueDate ? formatDateID(row.dueDate) : '—'}</td>
                  <td className="p-3 border border-neutral-200">{row.customerName}</td>
                  <td className="p-3 border border-neutral-200 text-right text-danger-600 font-medium">{row.daysOverdue}</td>
                  <td className="p-3 border border-neutral-200">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusPillClass(row.status)}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-blue-50 font-bold">
                <td colSpan={5} className="p-3 border border-neutral-300">Total Invoice Overdue ({data.summary.overdueInvoiceCount || 0})</td>
                <td className="p-3 border border-neutral-300 text-right">{formatIDR(data.summary.overdueAmount || 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      );
    }

    if (report.id === 'trial-balance') {
      if (!data.rows.length) return renderEmptyReport('No general ledger balances found for the selected date.');

      return (
        <div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-blue-50">
                <th className="p-3 text-left font-semibold border border-neutral-300 w-[140px]">Code</th>
                <th className="p-3 text-left font-semibold border border-neutral-300">Account Name</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">Total Debit</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">Total Credit</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">Ending Debit</th>
                <th className="p-3 text-right font-semibold border border-neutral-300">Ending Credit</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.accountId} className="hover:bg-neutral-50">
                  <td className="p-3 border border-neutral-200 font-mono text-xs">{row.accountCode}</td>
                  <td className="p-3 border border-neutral-200">{row.accountName}</td>
                  <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.totalDebit)}</td>
                  <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.totalCredit)}</td>
                  <td className="p-3 border border-neutral-200 text-right font-medium">{row.endingDebit ? formatIDR(row.endingDebit) : '—'}</td>
                  <td className="p-3 border border-neutral-200 text-right font-medium">{row.endingCredit ? formatIDR(row.endingCredit) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-blue-50 font-bold">
                <td colSpan={2} className="p-3 border border-neutral-300">Total</td>
                <td className="p-3 border border-neutral-300 text-right">{formatIDR(data.summary.totalDebit || 0)}</td>
                <td className="p-3 border border-neutral-300 text-right">{formatIDR(data.summary.totalCredit || 0)}</td>
                <td className="p-3 border border-neutral-300 text-right">{formatIDR(data.summary.endingDebit || 0)}</td>
                <td className="p-3 border border-neutral-300 text-right">{formatIDR(data.summary.endingCredit || 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      );
    }

    if (report.id === 'profit-loss') {
      const sections = data.sections || [];
      const hasRows = sections.some((section) => section.rows.length > 0);
      if (!hasRows) return renderEmptyReport('No revenue or expense activity found for the selected period.');

      return (
        <div className="space-y-6">
          {sections.map((section) => (
            <div key={section.id}>
              <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{section.label}</div>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-blue-50">
                    <th className="p-3 text-left font-semibold border border-neutral-300 w-[140px]">Code</th>
                    <th className="p-3 text-left font-semibold border border-neutral-300">Account Name</th>
                    <th className="p-3 text-right font-semibold border border-neutral-300 w-[220px]">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => (
                    <tr key={row.accountId} className="hover:bg-neutral-50">
                      <td className="p-3 border border-neutral-200 font-mono text-xs">{row.accountCode}</td>
                      <td className="p-3 border border-neutral-200">{row.accountName}</td>
                      <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-blue-50 font-bold">
                    <td colSpan={2} className="p-3 border border-neutral-300">Subtotal {section.label}</td>
                    <td className="p-3 border border-neutral-300 text-right">{formatIDR(section.total || 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}

          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-600">Total Revenue</span>
              <span className="font-semibold">{formatIDR(data.summary.totalRevenue || 0)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-neutral-600">Total Expenses</span>
              <span className="font-semibold">{formatIDR(data.summary.totalExpense || 0)}</span>
            </div>
            <div className="mt-3 border-t border-neutral-200 pt-3 flex items-center justify-between">
              <span className="font-semibold text-neutral-900">Net Income</span>
              <span className="font-bold text-primary-700">{formatIDR(data.summary.netIncome || 0)}</span>
            </div>
          </div>
        </div>
      );
    }

    if (report.id === 'balance-sheet') {
      const sections = data.sections || [];
      const hasRows = sections.some((section) => section.rows.length > 0);
      if (!hasRows) return renderEmptyReport('No balance sheet balances found for the selected date.');

      return (
        <div className="space-y-6">
          {sections.map((section) => (
            <div key={section.id}>
              <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{section.label}</div>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-blue-50">
                    <th className="p-3 text-left font-semibold border border-neutral-300 w-[140px]">Code</th>
                    <th className="p-3 text-left font-semibold border border-neutral-300">Account Name</th>
                    <th className="p-3 text-right font-semibold border border-neutral-300 w-[220px]">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => (
                    <tr key={row.accountId} className="hover:bg-neutral-50">
                      <td className="p-3 border border-neutral-200 font-mono text-xs">{row.accountCode || '—'}</td>
                      <td className="p-3 border border-neutral-200">{row.accountName}</td>
                      <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-blue-50 font-bold">
                    <td colSpan={2} className="p-3 border border-neutral-300">Subtotal {section.label}</td>
                    <td className="p-3 border border-neutral-300 text-right">{formatIDR(section.total || 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}

          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-600">Total Assets</span>
              <span className="font-semibold">{formatIDR(data.summary.totalAssets || 0)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-neutral-600">Total Liabilities</span>
              <span className="font-semibold">{formatIDR(data.summary.totalLiabilities || 0)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-neutral-600">Total Equity</span>
              <span className="font-semibold">{formatIDR(data.summary.totalEquity || 0)}</span>
            </div>
            <div className="mt-3 border-t border-neutral-200 pt-3 flex items-center justify-between">
              <span className="font-semibold text-neutral-900">Total Liabilities + Equity</span>
              <span className="font-bold text-primary-700">{formatIDR(data.summary.totalLiabilitiesAndEquity || 0)}</span>
            </div>
          </div>
        </div>
      );
    }

    if (report.id === 'balance-sheet-multi-period') {
      const sections = data.sections || [];
      const hasRows = sections.some((section) => section.rows.length > 0);
      if (!hasRows) return renderEmptyReport('No balance sheet balances found for the selected comparison dates.');

      return (
        <div className="space-y-6">
          {sections.map((section) => (
            <div key={section.id}>
              <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{section.label}</div>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-blue-50">
                    <th className="p-3 text-left font-semibold border border-neutral-300 w-[140px]">Code</th>
                    <th className="p-3 text-left font-semibold border border-neutral-300">Account Name</th>
                    <th className="p-3 text-right font-semibold border border-neutral-300">Current Period</th>
                    <th className="p-3 text-right font-semibold border border-neutral-300">Compare Period</th>
                    <th className="p-3 text-right font-semibold border border-neutral-300">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => (
                    <tr key={row.accountId} className="hover:bg-neutral-50">
                      <td className="p-3 border border-neutral-200 font-mono text-xs">{row.accountCode || '—'}</td>
                      <td className="p-3 border border-neutral-200">{row.accountName}</td>
                      <td className="p-3 border border-neutral-200 text-right font-medium">{formatIDR(row.currentAmount)}</td>
                      <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.compareAmount)}</td>
                      <td className="p-3 border border-neutral-200 text-right">{formatIDR(row.variance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-blue-50 font-bold">
                    <td colSpan={2} className="p-3 border border-neutral-300">Subtotal {section.label}</td>
                    <td className="p-3 border border-neutral-300 text-right">{formatIDR(section.totalCurrent || 0)}</td>
                    <td className="p-3 border border-neutral-300 text-right">{formatIDR(section.totalCompare || 0)}</td>
                    <td className="p-3 border border-neutral-300 text-right">{formatIDR(section.totalVariance || 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}

          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-600">Total Assets</span>
              <span className="font-semibold">{formatIDR(data.summary.current.totalAssets || 0)} vs {formatIDR(data.summary.compare.totalAssets || 0)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-600">Total Liabilities</span>
              <span className="font-semibold">{formatIDR(data.summary.current.totalLiabilities || 0)} vs {formatIDR(data.summary.compare.totalLiabilities || 0)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-600">Total Equity</span>
              <span className="font-semibold">{formatIDR(data.summary.current.totalEquity || 0)} vs {formatIDR(data.summary.compare.totalEquity || 0)}</span>
            </div>
            <div className="border-t border-neutral-200 pt-3 flex items-center justify-between">
              <span className="font-semibold text-neutral-900">Assets Variance</span>
              <span className="font-bold text-primary-700">{formatIDR(data.summary.variance.totalAssets || 0)}</span>
            </div>
          </div>
        </div>
      );
    }

    return <div className="p-8 text-center text-neutral-500">No renderer for this report type.</div>;
  };

  const activeFilterBadges = activeReport ? [
    activeReport.params.customerSearch ? `Pelanggan: ${activeReport.params.customerSearch}` : null,
    activeReport.params.itemSearch ? `Barang: ${activeReport.params.itemSearch}` : null,
    activeReport.params.topN ? `Top ${activeReport.params.topN}` : null,
    activeReport.params.sortBy === 'qty' ? 'Urut: Qty (pcs)' : null,
    activeReport.params.status ? `Status: ${activeReport.params.status}` : null,
    activeReport.params.compareAsOfDate ? `Compare: ${formatDateID(activeReport.params.compareAsOfDate)}` : null,
  ].filter(Boolean) : [];

  const periodLabel = activeReport
    ? activeReport.report.id === 'balance-sheet-multi-period'
      ? `${formatDateID(activeReport.asOfDate)} vs ${formatDateID(activeReport.params.compareAsOfDate)}`
      : activeReport.report.filterMode === 'as-of'
        ? activeReport.report.category === 'gl'
          ? `As of ${formatDateID(activeReport.asOfDate)}`
          : `Per ${formatDateID(activeReport.asOfDate)}`
        : activeReport.report.category === 'gl'
          ? `${formatDateID(activeReport.dateFrom)} to ${formatDateID(activeReport.dateTo)}`
          : `${formatDateID(activeReport.dateFrom)} s/d ${formatDateID(activeReport.dateTo)}`
    : '';

  return (
    <div className="flex h-full min-h-0" style={{ height: 'calc(100vh - 56px)' }}>
      <div className="w-[200px] shrink-0 border-r border-neutral-200 bg-neutral-50 p-3 flex flex-col gap-1 overflow-y-auto">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.id}
              onClick={() => resetCategoryState(cat.id)}
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

      <div className="flex-1 min-w-0 overflow-y-auto">
        {categoryReports.length > 0 ? (
          <div className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-neutral-900">{activeCategoryMeta?.label}</h2>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  placeholder="Cari laporan..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-9 pl-9 pr-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0 w-[220px]"
                />
              </div>
            </div>

            {!activeReport && !isLoading && (
              <div className="grid grid-cols-2 gap-3 mb-6">
                {filteredReports.map((report) => (
                  <ReportCard key={report.id} report={report} onClick={handleCardClick} />
                ))}
              </div>
            )}

            {!activeReport && !isLoading && !filteredReports.length && (
              renderEmptyReport('Tidak ada laporan yang cocok dengan pencarian.')
            )}

            {isLoading && (
              <div className="p-12 text-center text-neutral-500 text-sm">Memuat laporan...</div>
            )}

            {error && !activeReport && !isLoading && (
              <div className="p-8 text-center text-danger-600 text-sm">
                Gagal memuat laporan: {error}
              </div>
            )}

            {openReports.length > 0 && !isLoading && (
              <div className="mb-4 overflow-x-auto">
                <div className="inline-flex min-w-full items-end gap-1 border-b border-neutral-300">
                  {openReports.map((entry) => {
                    const isActive = entry.report.id === activeReportId;
                    return (
                      <button
                        key={entry.report.id}
                        type="button"
                        onClick={() => setActiveReportId(entry.report.id)}
                        className={`group inline-flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2 text-sm transition-colors ${
                          isActive
                            ? 'border-neutral-300 bg-white font-semibold text-neutral-900'
                            : 'border-neutral-200 bg-neutral-100 text-neutral-600 hover:bg-neutral-0 hover:text-neutral-900'
                        }`}
                      >
                        <span className="max-w-[220px] truncate">{entry.report.name}</span>
                        <span
                          onClick={(event) => {
                            event.stopPropagation();
                            closeReportTab(entry.report.id);
                          }}
                          className="inline-flex h-5 w-5 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-neutral-700"
                          role="button"
                          aria-label={`Tutup ${entry.report.name}`}
                        >
                          <X size={13} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {activeReport && !isLoading && (
              <div>
                <div className="mb-4 pb-3 border-b border-neutral-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          closeReportTab(activeReport.report.id);
                          setError(null);
                        }}
                        className="flex items-center gap-1.5 text-sm text-neutral-600 hover:text-neutral-900"
                      >
                        <X size={14} /> Tutup
                      </button>
                      <div className="h-4 w-px bg-neutral-300" />
                      <span className="font-semibold text-neutral-900">{activeReport.report.name}</span>
                      <span className="text-xs text-neutral-500">{periodLabel}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handlePrint}
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
                  {activeReport.params && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {activeFilterBadges.length > 0 ? <span className="text-xs text-neutral-500">Filter aktif:</span> : null}
                      {activeFilterBadges.map((badge) => (
                        <span
                          key={badge}
                          className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full border border-primary-200"
                        >
                          {badge}
                        </span>
                      ))}
                      <button
                        onClick={() => openParamModal(activeReport.report, activeReport.params)}
                        className="text-xs text-primary-600 hover:text-primary-800 underline ml-1"
                      >
                        Ubah Filter
                      </button>
                    </div>
                  )}
                </div>

                <div ref={printRef} className="bg-white">
                  <div className="text-center mb-5">
                    <div className="text-sm font-semibold text-neutral-700 uppercase tracking-wide">
                      {company?.companyName || 'PT. Demo Accounting'}
                    </div>
                    <div className="text-lg font-bold text-primary-700 mt-1">{activeReport.report.name}</div>
                    <div className="text-xs text-neutral-500 mt-1">{periodLabel}</div>
                  </div>

                  <div className="overflow-x-auto print:overflow-visible">
                    {renderReportResult()}
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-neutral-200 print:hidden">
                  <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-3">
                    Laporan Lainnya
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {categoryReports
                      .filter((report) => report.id !== activeReport.report.id)
                      .map((report) => (
                        <ReportCard key={report.id} report={report} onClick={handleCardClick} />
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-6">
            <h2 className="text-xl font-bold text-neutral-900 mb-2">{activeCategoryMeta?.label}</h2>
            <div className="mt-12 text-center">
              <div className="text-neutral-400 text-5xl mb-4">📊</div>
              <div className="text-neutral-600 font-medium">Laporan akan segera tersedia</div>
              <div className="text-neutral-400 text-sm mt-1">Coming soon</div>
            </div>
          </div>
        )}
      </div>

      {paramModal && (
        <Modal
          isOpen={true}
          onClose={() => setParamModal(null)}
          title="Parameter Laporan"
          size="sm"
        >
          <div className="space-y-4">
            {paramModal.filterMode === 'date-range' ? (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">
                  {paramModal.category === 'gl' ? 'Date Range' : 'Tanggal'}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-neutral-600 mb-1">
                      {paramModal.category === 'gl' ? 'From' : 'Dari'}
                    </label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-neutral-600 mb-1">
                      {paramModal.category === 'gl' ? 'To' : 's/d'}
                    </label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">
                  {paramModal.category === 'gl' ? 'Report Date' : 'Snapshot Piutang'}
                </div>
                <div>
                  <label className="block text-sm text-neutral-600 mb-1">As of Date</label>
                  <input
                    type="date"
                    value={asOfDate}
                    onChange={(e) => setAsOfDate(e.target.value)}
                    className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                  />
                </div>
                {paramModal.id === 'balance-sheet-multi-period' && (
                  <div className="mt-3">
                    <label className="block text-sm text-neutral-600 mb-1">Compare As of Date</label>
                    <input
                      type="date"
                      value={compareAsOfDate}
                      onChange={(e) => setCompareAsOfDate(e.target.value)}
                      className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                    />
                  </div>
                )}
              </div>
            )}

            {paramModal.id === 'by-customer' && (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Filter Pelanggan</div>
                <div className="space-y-3">
                  <SearchableSelect
                    label="Customer (Optional)"
                    options={customerOptions}
                    value={selectedCustomerId}
                    onChange={(customerId) => {
                      setSelectedCustomerId(customerId);
                      const customer = customers.find((entry) => entry.id === customerId);
                      setFilterCustomer(customer?.name || '');
                    }}
                    placeholder="Select customer..."
                    className="mb-0"
                  />
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={topNCustomer}
                      onChange={(e) => setTopNCustomer(e.target.checked)}
                      className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-neutral-700">Top 30 Pelanggan <span className="text-neutral-400">(berdasarkan nilai penjualan)</span></span>
                  </label>
                </div>
              </div>
            )}

            {paramModal.id === 'by-item' && (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Filter Barang</div>
                <div className="space-y-3">
                  <SearchableSelect
                    label="Barang (Opsional)"
                    options={itemOptions}
                    value={selectedItemId}
                    onChange={(itemId) => {
                      setSelectedItemId(itemId);
                      const item = items.find((entry) => entry.id === itemId);
                      setFilterItem(item?.name || '');
                    }}
                    placeholder="Pilih barang..."
                    className="mb-0"
                  />
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={topNItem}
                      onChange={(e) => setTopNItem(e.target.checked)}
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

            {paramModal.id === 'by-item-customer' && (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Filter Penjualan Barang</div>
                <div className="space-y-3">
                  <SearchableSelect
                    label="Pelanggan (Opsional)"
                    options={customerOptions}
                    value={selectedCustomerId}
                    onChange={(customerId) => {
                      setSelectedCustomerId(customerId);
                      const customer = customers.find((entry) => entry.id === customerId);
                      setFilterCustomer(customer?.name || '');
                    }}
                    placeholder="Pilih pelanggan..."
                    className="mb-0"
                  />
                  <SearchableSelect
                    label="Barang (Opsional)"
                    options={itemOptions}
                    value={selectedItemId}
                    onChange={(itemId) => {
                      setSelectedItemId(itemId);
                      const item = items.find((entry) => entry.id === itemId);
                      setFilterItem(item?.name || '');
                    }}
                    placeholder="Pilih barang..."
                    className="mb-0"
                  />
                </div>
              </div>
            )}

            {paramModal.category === 'ar' && (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Filter Pelanggan</div>
                <div className="space-y-3">
                  <SearchableSelect
                    label="Customer (Optional)"
                    options={customerOptions}
                    value={selectedCustomerId}
                    onChange={(customerId) => {
                      setSelectedCustomerId(customerId);
                      const customer = customers.find((entry) => entry.id === customerId);
                      setFilterCustomer(customer?.name || '');
                    }}
                    placeholder="Select customer..."
                    className="mb-0"
                  />

                  {paramModal.id === 'overdue-list' && (
                    <div>
                      <label className="block text-sm text-neutral-600 mb-1">Status Faktur <span className="text-neutral-400">(opsional)</span></label>
                      <select
                        value={overdueStatus}
                        onChange={(e) => setOverdueStatus(e.target.value)}
                        className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                      >
                        <option value="">Semua status</option>
                        <option value="SENT">SENT</option>
                        <option value="OVERDUE">OVERDUE</option>
                        <option value="PAID">PAID</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={resetModalFilters}
                className="text-sm text-neutral-500 hover:text-neutral-800 underline"
              >
                Reset Filters
              </button>
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

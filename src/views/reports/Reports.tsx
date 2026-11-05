import {
  Download, FileText,
  Printer,
  RefreshCw,
  Search,
  X
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { api } from '../../api/apiClient';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { useBankAccounts } from '../../hooks/useBanking';
import { useChartOfAccounts } from '../../hooks/useGL';
import { useItemCategories, useWarehouses } from '../../hooks/useInventory';
import { getActiveOrgId } from '../../lib/activeOrg';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { exportCsvToPdf } from '../../utils/exportPdf';
import { formatDateID, formatIDR } from '../../utils/formatters';
import ReportCard from './ReportCard';
import ReportEntitySelect from './ReportEntitySelect';
import ReportResult from './ReportResult';
import { controlReconciliationKind, controlReconciliationCsv } from './controlReconciliation';
import type { ControlReconciliation } from '../../../lib/control-reconciliation';
import { buildApCsv, buildArCsv, buildBankingCsv, buildGlCsv, buildHrCsv, buildInventoryCsv, buildSalesCsv } from './reportCsv';
import { DEFAULT_CATEGORY, IMPLEMENTED_CATEGORIES, REPORTS_BY_CATEGORY } from './reportDefinitions';
import { renderEmptyReport } from './reportResultHelpers';
import type {
  OpenReportEntry,
  ReportCategoryId,
  ReportDefinition,
  ReportParams,
  ReportType,
  StatementData,
} from './reportTypes';
export { ALL_REPORTS, findReportById } from './reportDefinitions';
export type * from './reportTypes';

// ── Utility helpers ────────────────────────────────────────────────────────────

const pad = (n: number): string => String(n).padStart(2, '0');
const fmtDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
const REPORT_PRESETS_KEY = 'msm-report-presets';

const PERIOD_PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: 'Bulan ini', range: () => [fmtDate(new Date(today.getFullYear(), today.getMonth(), 1)), fmtDate(today)] },
  { label: 'Bulan lalu', range: () => [fmtDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)), fmtDate(new Date(today.getFullYear(), today.getMonth(), 0))] },
  { label: '3 bulan terakhir', range: () => [fmtDate(new Date(today.getFullYear(), today.getMonth() - 2, 1)), fmtDate(today)] },
  { label: 'Tahun ini', range: () => [fmtDate(new Date(today.getFullYear(), 0, 1)), fmtDate(today)] },
];

// Presets hold org entity ids (accountId, warehouseId, customerId, …) so they
// are partitioned per company, mirroring the org-scoped zustand stores.
const reportPresetsKey = (): string => `${REPORT_PRESETS_KEY}:${getActiveOrgId() ?? 'default'}`;

const loadReportPresets = (): Record<string, ReportParams> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(reportPresetsKey());
    return raw ? (JSON.parse(raw) as Record<string, ReportParams>) : {};
  } catch {
    return {};
  }
};

const defaultCompareAsOfDate = (): string => fmtDate(new Date(today.getFullYear(), today.getMonth(), 0));

export interface ReportsProps {
  /** 'legacy' (default): standalone-route behaviour — internal tab strip + "Laporan Lainnya".
   *  'catalog': render only the category sidebar + cards; running a report calls onRunReport.
   *  'single': render exactly one report (singleReport/singleParams); no catalog, no other-report cards. */
  variant?: 'legacy' | 'catalog' | 'single';
  /** catalog: called when the user runs a report from the parameter modal. */
  onRunReport?: (report: ReportDefinition, params: ReportParams) => void;
  /** single: the report to display and its run parameters. */
  singleReport?: ReportDefinition;
  singleParams?: ReportParams;
  /** single: called when the user re-runs via "Ubah Filter", to persist new params. */
  onParamsChange?: (params: ReportParams) => void;
}

// Pie + legend used by the "Portion of Sales" reports (per item, per customer).
const Reports: React.FC<ReportsProps> = ({
  variant = 'legacy',
  onRunReport,
  singleReport,
  singleParams,
  onParamsChange,
}) => {
  const company = useSettingsStore((s) => s.companyInfo);
  const [activeCategory, setActiveCategory] = useState<ReportCategoryId>(DEFAULT_CATEGORY);
  const [searchTerm, setSearchTerm] = useState<string>('');

  const [paramModal, setParamModal] = useState<ReportDefinition | null>(null);
  const [dateFrom, setDateFrom] = useState<string>(fmtDate(firstOfMonth));
  const [dateTo, setDateTo] = useState<string>(fmtDate(today));
  const [asOfDate, setAsOfDate] = useState<string>(fmtDate(today));
  const [compareAsOfDate, setCompareAsOfDate] = useState<string>(defaultCompareAsOfDate());
  const [filterCustomer, setFilterCustomer] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [topNCustomer, setTopNCustomer] = useState<boolean>(false);
  const [filterItem, setFilterItem] = useState<string>('');
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [topNItem, setTopNItem] = useState<boolean>(false);
  const [shareTopN, setShareTopN] = useState<number>(5);
  const [itemSortBy, setItemSortBy] = useState<'total' | 'qty'>('total');
  const [overdueStatus, setOverdueStatus] = useState<string>('');
  const [valuationCategoryId, setValuationCategoryId] = useState<string>('');
  const [valuationWarehouseId, setValuationWarehouseId] = useState<string>('');
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [compareDateFrom, setCompareDateFrom] = useState<string>(fmtDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)));
  const [compareDateTo, setCompareDateTo] = useState<string>(fmtDate(new Date(today.getFullYear(), today.getMonth(), 0)));
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string>('');

  const [openReports, setOpenReports] = useState<OpenReportEntry[]>([]);
  const [activeReportId, setActiveReportId] = useState<ReportType | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // `single` variant: bumped to re-fetch when the saved params are unchanged
  // (Refresh, or "Ubah Filter" re-run with the same filters).
  const [refreshNonce, setRefreshNonce] = useState(0);
  const printRef = useRef<HTMLDivElement>(null);
  const [reportPresets, setReportPresets] = useState<Record<string, ReportParams>>(loadReportPresets);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(reportPresetsKey(), JSON.stringify(reportPresets));
  }, [reportPresets]);

  useEffect(() => {
    if (!IMPLEMENTED_CATEGORIES.some((category) => category.id === activeCategory)) {
      setActiveCategory(DEFAULT_CATEGORY);
    }
  }, [activeCategory]);

  const categoryReports: ReportDefinition[] = REPORTS_BY_CATEGORY[activeCategory] || [];
  const activeCategoryMeta = IMPLEMENTED_CATEGORIES.find((category) => category.id === activeCategory);
  const activeReport = openReports.find((entry) => entry.report.id === activeReportId) || null;
  // Reference data is needed only for the corresponding filter or result labels.
  const valuationVisible = paramModal?.id === 'stock-valuation' || activeReport?.report.id === 'stock-valuation';
  const bankVisible = paramModal?.filterMode === 'bank-period' || activeReport?.report.filterMode === 'bank-period';
  const { data: accountsData } = useChartOfAccounts(undefined, { enabled: paramModal?.id === 'account-ledger' });
  const { data: warehousesData } = useWarehouses({ enabled: valuationVisible });
  const { data: categoriesData } = useItemCategories({ enabled: valuationVisible });
  const { data: bankAccountsData } = useBankAccounts({ enabled: bankVisible });
  const warehouses = warehousesData ?? [];
  const itemCategories = categoriesData ?? [];
  const categoryNameById = new Map(itemCategories.map((category) => [category.id, category.name]));
  const bankAccounts = (bankAccountsData ?? []).filter((account) => account.isActive);
  const accountOptions = (accountsData ?? []).map((account) => ({
    value: account.id, label: account.name, subLabel: account.code,
  }));
  const showCategorySidebar = variant !== 'single';
  const showCatalog = variant === 'legacy' || variant === 'catalog';
  const showInternalTabs = variant === 'legacy';
  const showOtherReports = variant === 'legacy';
  const filteredReports = categoryReports.filter((report) =>
    report.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: activeReport
      ? `${activeReport.report.id}-${activeReport.asOfDate || activeReport.dateFrom || 'report'}`
      : 'report',
  });

  const resetCategoryState = (categoryId: ReportCategoryId) => {
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
    setValuationCategoryId('');
    setValuationWarehouseId('');
    setSelectedVendorId('');
    setSelectedBankAccountId('');
  };

  const closeReportTab = (reportId: ReportType) => {
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
    setSelectedCustomerId('');
    setFilterCustomer(customerSearch);
  };

  const syncItemFilter = (itemSearch = '') => {
    setSelectedItemId('');
    setFilterItem(itemSearch);
  };

  const openParamModal = (report: ReportDefinition, presetParams: ReportParams | null = null) => {
    const params = presetParams || reportPresets[report.id] || {};
    if (params.dateFrom) setDateFrom(params.dateFrom);
    if (params.dateTo) setDateTo(params.dateTo);
    if (params.asOfDate) setAsOfDate(params.asOfDate);
    if (params.compareAsOfDate) setCompareAsOfDate(params.compareAsOfDate);
    if (params.compareDateFrom) setCompareDateFrom(params.compareDateFrom);
    if (params.compareDateTo) setCompareDateTo(params.compareDateTo);
    if (params.accountId) setSelectedAccountId(params.accountId);
    syncCustomerFilter(params.customerSearch || '');
    syncItemFilter(params.itemSearch || '');
    setTopNCustomer(Boolean(params.topN) && report.id === 'by-customer');
    setTopNItem(Boolean(params.topN) && report.id === 'by-item');
    setShareTopN(params.topN && (report.id === 'share-by-item' || report.id === 'share-by-customer') ? params.topN : 5);
    setItemSortBy(params.sortBy === 'qty' ? 'qty' : 'total');
    setOverdueStatus(params.status || '');
    setValuationCategoryId(params.categoryId || '');
    setValuationWarehouseId(params.warehouseId || '');
    if (report.id === 'statement') setSelectedCustomerId(params.customerId || '');
    setSelectedVendorId(params.vendorId || '');
    setSelectedBankAccountId(params.bankAccountId || '');
    setParamModal(report);
  };

  const resetModalFilters = () => {
    if (!paramModal) return;

    setDateFrom(fmtDate(firstOfMonth));
    setDateTo(fmtDate(today));
    setAsOfDate(fmtDate(today));
    setCompareAsOfDate(defaultCompareAsOfDate());
    setCompareDateFrom(fmtDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)));
    setCompareDateTo(fmtDate(new Date(today.getFullYear(), today.getMonth(), 0)));
    setSelectedAccountId('');
    setFilterCustomer('');
    setSelectedCustomerId('');
    setTopNCustomer(false);
    setFilterItem('');
    setSelectedItemId('');
    setTopNItem(false);
    setShareTopN(5);
    setItemSortBy('total');
    setOverdueStatus('');
    setValuationCategoryId('');
    setValuationWarehouseId('');
    setSelectedVendorId('');
    setSelectedBankAccountId('');
    setReportPresets((prev) => {
      const next = { ...prev };
      delete next[paramModal.id];
      return next;
    });
  };

  const handleCardClick = (report: ReportDefinition) => {
    const presetParams = activeReport?.report.id === report.id ? activeReport.params : null;
    openParamModal(report, presetParams);
  };

  const buildRequestParams = (report: ReportDefinition): ReportParams => {
    const kind = controlReconciliationKind(report.id);
    if (kind) return { type: report.id, kind, asOfDate };
    if (report.category === 'sales') {
      const params: ReportParams = { type: report.id, dateFrom, dateTo };
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
      if (report.id === 'share-by-item' || report.id === 'share-by-customer') params.topN = shareTopN;
      if (report.id === 'sales-return-list' && filterCustomer) params.customerSearch = filterCustomer;
      return params;
    }

    if (report.category === 'ar') {
      if (report.id === 'statement') {
        return { type: report.id, customerId: selectedCustomerId, dateFrom, dateTo };
      }
      const params: ReportParams = { type: report.id, asOfDate };
      if (filterCustomer) params.customerSearch = filterCustomer;
      if (report.id === 'overdue-list' && overdueStatus) params.status = overdueStatus;
      return params;
    }

    if (report.category === 'gl') {
      if (report.id === 'balance-sheet-multi-period') {
        return { type: report.id, asOfDate, compareAsOfDate };
      }
      if (report.id === 'profit-loss-multi-period') {
        return { type: report.id, dateFrom, dateTo, compareDateFrom, compareDateTo };
      }
      if (report.id === 'account-ledger') {
        return { type: report.id, dateFrom, dateTo, accountId: selectedAccountId };
      }
      if (report.filterMode === 'as-of') {
        return { type: report.id, asOfDate };
      }
      return { type: report.id, dateFrom, dateTo };
    }

    if (report.category === 'ap') {
      const apiType = report.id.replace(/^ap-/, '');
      if (report.id === 'ap-statement') {
        return { type: apiType as ReportType, vendorId: selectedVendorId, dateFrom, dateTo };
      }
      return { type: apiType as ReportType, asOfDate };
    }

    if (report.category === 'hr') {
      return { type: report.id, dateFrom, dateTo };
    }

    if (report.id === 'stock-valuation') {
      const params: ReportParams = { type: report.id, asOfDate };
      if (valuationCategoryId) params.categoryId = valuationCategoryId;
      if (valuationWarehouseId) params.warehouseId = valuationWarehouseId;
      return params;
    }

    if (report.filterMode === 'bank-period') {
      const params: ReportParams = { type: report.id, dateFrom, dateTo };
      if (selectedBankAccountId) params.bankAccountId = selectedBankAccountId;
      return params;
    }

    if (report.category === 'banking' || report.category === 'inventory') {
      return { type: report.id, dateFrom, dateTo };
    }

    return { type: report.id };
  };

  const handleRunReport = async () => {
    if (!paramModal) return;
    const reportToRun = paramModal;
    // Statements need a party selected before they can run.
    if (reportToRun.id === 'statement' && !selectedCustomerId) {
      setError('Pilih pelanggan terlebih dahulu.');
      return;
    }
    if (reportToRun.id === 'ap-statement' && !selectedVendorId) {
      setError('Pilih vendor terlebih dahulu.');
      return;
    }
    if (reportToRun.filterMode === 'bank-period' && reportToRun.bankRequired && !selectedBankAccountId) {
      setError('Pilih bank terlebih dahulu.');
      return;
    }
    setParamModal(null);
    setIsLoading(true);
    setError(null);

    try {
      const params = buildRequestParams(reportToRun);
      setReportPresets((prev) => ({
        ...prev,
        [reportToRun.id]: params,
      }));
      if (variant === 'catalog') {
        onRunReport?.(reportToRun, params);
        return;
      }
      if (variant === 'single') {
        // The single-mode effect is the sole fetch path: persisting the new
        // params re-renders this component with fresh singleParams, which the
        // effect picks up and fetches. Returning here avoids a double request.
        // Unchanged params would not re-trigger the effect, so bump the nonce.
        if (JSON.stringify(params) === JSON.stringify(singleParams ?? null)) setRefreshNonce((n) => n + 1);
        else onParamsChange?.(params);
        return;
      }
      // api.get returns unknown; cast to record since shape varies per report
      // Cast via unknown because ReportParams has no index signature; api.get accepts Record<string, unknown>
      const data = await api.get<Record<string, unknown>>(reportToRun.apiPath, params as unknown as Record<string, unknown>);
      const reportEntry: OpenReportEntry = {
        report: reportToRun,
        data,
        params,
        dateFrom: (reportToRun.filterMode === 'date-range' || reportToRun.filterMode === 'statement' || reportToRun.filterMode === 'bank-period') ? dateFrom : null,
        dateTo: (reportToRun.filterMode === 'date-range' || reportToRun.filterMode === 'statement' || reportToRun.filterMode === 'bank-period') ? dateTo : null,
        asOfDate: params.asOfDate ?? null,
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
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  // `single` variant: fetch the one report from its saved params on mount and
  // whenever the params change (e.g. after "Ubah Filter"). With no saved params
  // yet (a fresh/deep-linked report tab), open the parameter modal to collect them.
  const singleParamsKey = singleParams ? JSON.stringify(singleParams) : '';
  useEffect(() => {
    if (variant !== 'single' || !singleReport) return;
    if (!singleParams) {
      openParamModal(singleReport);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await api.get<Record<string, unknown>>(
          singleReport.apiPath,
          singleParams as unknown as Record<string, unknown>,
        );
        if (cancelled) return;
        const entry: OpenReportEntry = {
          report: singleReport,
          data,
          params: singleParams,
          dateFrom: singleParams.dateFrom ?? null,
          dateTo: singleParams.dateTo ?? null,
          asOfDate: singleParams.asOfDate ?? null,
        };
        setOpenReports([entry]);
        setActiveReportId(singleReport.id);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, singleReport, singleParamsKey, refreshNonce]);

  /** Re-fetch the shown report with its current params (no filter changes). */
  const refreshActiveReport = async () => {
    if (!activeReport?.params || isLoading) return;
    if (variant === 'single') {
      setRefreshNonce((n) => n + 1);
      return;
    }
    const { report, params } = activeReport;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<Record<string, unknown>>(report.apiPath, params as unknown as Record<string, unknown>);
      setOpenReports((prev) => prev.map((entry) => (entry.report.id === report.id ? { ...entry, data } : entry)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const buildActiveReportCsv = (report: ReportDefinition, data: Record<string, unknown>): string =>
    controlReconciliationKind(report.id) ? controlReconciliationCsv(data as unknown as ControlReconciliation) : report.category === 'ar'
      ? buildArCsv(report, data)
      : report.category === 'gl'
        ? buildGlCsv(report, data)
        : report.category === 'ap'
          ? buildApCsv(report, data)
          : report.category === 'banking'
            ? buildBankingCsv(report, data)
            : report.category === 'inventory'
              ? buildInventoryCsv(report, data, categoryNameById)
              : report.category === 'hr'
                ? buildHrCsv(report, data)
                : buildSalesCsv(report, data);

  const handleExportCsv = () => {
    if (!activeReport) return;

    const { report, data } = activeReport;
    if (controlReconciliationKind(report.id) && (isLoading || error)) return;
    let csv = buildActiveReportCsv(report, data as Record<string, unknown>);
    const credit = data?.summary?.unappliedCredits ?? data?.summary?.unallocatedCredit ?? 0;
    if (credit > 0) csv += `\nUnapplied credits / credit balances,${credit}\nNet balance,${data.summary.netOutstanding}`;
    if (Array.isArray(data?.warnings)) for (const warning of data.warnings) csv += `\nWarning,"${String(warning).replaceAll('"', '""')}"`;

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.id}-${activeReport.asOfDate || activeReport.dateFrom || 'report'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    if (!activeReport) return;

    const { report, data } = activeReport;
    if (controlReconciliationKind(report.id) && (isLoading || error)) return;
    const csv = buildActiveReportCsv(report, data as Record<string, unknown>);
    if (!csv.trim()) return;

    exportCsvToPdf(
      `${report.id}-${activeReport.asOfDate || activeReport.dateFrom || 'report'}`,
      report.name,
      csv,
      company ? { name: company.companyName, address: company.address, npwp: company.npwp } : null,
      periodLabel,
    );
  };

  const activeFilterBadges: string[] = activeReport ? [
    activeReport.params.customerSearch ? `Pelanggan: ${activeReport.params.customerSearch}` : null,
    activeReport.params.itemSearch ? `Barang: ${activeReport.params.itemSearch}` : null,
    activeReport.params.topN ? `Top ${activeReport.params.topN}` : null,
    activeReport.params.sortBy === 'qty' ? 'Urut: Qty (pcs)' : null,
    activeReport.params.status ? `Status: ${activeReport.params.status}` : null,
    activeReport.params.compareAsOfDate ? `Compare: ${formatDateID(activeReport.params.compareAsOfDate)}` : null,
    activeReport.report.filterMode === 'bank-period'
      ? `Bank: ${activeReport.params.bankAccountId ? (bankAccounts.find((a) => a.id === activeReport.params.bankAccountId)?.name ?? 'Bank') : 'Semua bank'}`
      : null,
  ].filter((x): x is string => x !== null) : [];

  const valuationFilterLabel = activeReport
    ? [
      activeReport.params.categoryId
        ? (categoryNameById.get(activeReport.params.categoryId) ?? 'Kategori')
        : 'Semua kategori',
      activeReport.params.warehouseId
        ? (warehouses.find((w) => w.id === activeReport.params.warehouseId)?.name ?? 'Gudang')
        : 'Semua gudang',
    ].join(' · ')
    : '';

  const periodLabel = activeReport
    ? activeReport.report.filterMode === 'statement'
      ? `${(activeReport.data as StatementData)?.party?.name ?? ''} · ${formatDateID(activeReport.dateFrom ?? '')} s/d ${formatDateID(activeReport.dateTo ?? '')}`
      : activeReport.report.id === 'stock-valuation'
        ? `Per ${formatDateID(activeReport.params.asOfDate ?? '')} · ${valuationFilterLabel}`
        : activeReport.report.id === 'balance-sheet-multi-period'
          ? `${formatDateID(activeReport.asOfDate ?? '')} vs ${formatDateID(activeReport.params.compareAsOfDate ?? '')}`
          : activeReport.report.filterMode === 'as-of'
            ? (activeReport.report.category === 'gl' || activeReport.report.category === 'ap')
              ? `As of ${formatDateID(activeReport.asOfDate ?? '')}`
              : `Per ${formatDateID(activeReport.asOfDate ?? '')}`
            : (activeReport.report.category === 'gl' || activeReport.report.category === 'banking' || activeReport.report.category === 'inventory' || activeReport.report.category === 'hr')
              ? `${formatDateID(activeReport.dateFrom ?? '')} to ${formatDateID(activeReport.dateTo ?? '')}`
              : `${formatDateID(activeReport.dateFrom ?? '')} s/d ${formatDateID(activeReport.dateTo ?? '')}`
    : '';

  return (
    <div className="flex h-full min-h-0" style={{ height: 'calc(100vh - 56px)' }}>
      {showCategorySidebar && (
        <div className="w-[200px] shrink-0 border-r border-neutral-200 bg-neutral-50 p-3 flex flex-col gap-1 overflow-y-auto">
          {IMPLEMENTED_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                onClick={() => resetCategoryState(cat.id)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors w-full ${activeCategory === cat.id
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
      )}

      <div className="flex-1 min-w-0 overflow-y-auto">
        {(variant === 'single' || categoryReports.length > 0) && (
          <div className="p-6">
            {showCatalog && (
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
            )}

            {showCatalog && !activeReport && !isLoading && (
              <div className="grid grid-cols-2 gap-3 mb-6">
                {filteredReports.map((report) => (
                  <ReportCard key={report.id} report={report} onClick={handleCardClick} />
                ))}
              </div>
            )}

            {showCatalog && !activeReport && !isLoading && !filteredReports.length && (
              renderEmptyReport('Tidak ada laporan yang cocok dengan pencarian.')
            )}

            {isLoading && (
              <div className="p-12 text-center text-neutral-500 text-sm" role="status" aria-live="polite">Memuat laporan...</div>
            )}

            {error && !activeReport && !isLoading && (
              <div className="p-8 text-center text-danger-600 text-sm">
                Gagal memuat laporan: {error}
              </div>
            )}

            {showInternalTabs && openReports.length > 0 && !isLoading && (
              <div className="mb-4 overflow-x-auto">
                <div className="inline-flex min-w-full items-end gap-1 border-b border-neutral-300">
                  {openReports.map((entry) => {
                    const isActive = entry.report.id === activeReportId;
                    return (
                      <button
                        key={entry.report.id}
                        type="button"
                        onClick={() => setActiveReportId(entry.report.id)}
                        className={`group inline-flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2 text-sm transition-colors ${isActive
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
                      {variant === 'legacy' && (
                        <>
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
                        </>
                      )}
                      <span className="font-semibold text-neutral-900">{activeReport.report.name}</span>
                      <span className="text-xs text-neutral-500">{periodLabel}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {activeReport.params && (
                        <button
                          onClick={() => { void refreshActiveReport(); }}
                          disabled={isLoading}
                          title="Reload this report with the same filters"
                          className="flex items-center gap-1.5 h-8 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-default"
                        >
                          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} /> Refresh
                        </button>
                      )}
                      <button
                        onClick={handlePrint}
                        disabled={!!controlReconciliationKind(activeReport.report.id) && (isLoading || !!error)}
                        className="flex items-center gap-1.5 h-8 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 hover:bg-neutral-100"
                      >
                        <Printer size={14} /> Print
                      </button>
                      <button
                        onClick={handleExportCsv}
                        disabled={!!controlReconciliationKind(activeReport.report.id) && (isLoading || !!error)}
                        className="flex items-center gap-1.5 h-8 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 hover:bg-neutral-100"
                      >
                        <Download size={14} /> Export CSV
                      </button>
                      <button
                        onClick={handleExportPdf}
                        disabled={!!controlReconciliationKind(activeReport.report.id) && (isLoading || !!error)}
                        className="flex items-center gap-1.5 h-8 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 hover:bg-neutral-100"
                      >
                        <FileText size={14} /> Export PDF
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
                    {activeReport.report.category === 'sales' && (
                      <div className="text-xs text-neutral-500 mt-1">{activeReport.report.description}</div>
                    )}
                  </div>

                  <div className="overflow-x-auto print:overflow-visible">
                    {Number(activeReport.data?.summary?.unappliedCredits ?? activeReport.data?.summary?.unallocatedCredit ?? 0) > 0 && (
                      <p className="p-3 mb-4 border border-neutral-300">
                        Unapplied credits / credit balances: {formatIDR(activeReport.data.summary.unappliedCredits ?? activeReport.data.summary.unallocatedCredit)}.
                        {' '}Net balance: {formatIDR(activeReport.data.summary.netOutstanding)}.
                      </p>
                    )}
                    {Array.isArray(activeReport.data?.warnings) && activeReport.data.warnings.length > 0 && (
                      <div role="alert" className="p-3 mb-4 border border-warning-300 text-warning-800">
                        {activeReport.data.warnings.map((warning: string) => <p key={warning}>{warning}</p>)}
                      </div>
                    )}
                    <ReportResult activeReport={activeReport} isLoading={isLoading} error={error} categoryNameById={categoryNameById} />
                  </div>
                </div>

                {showOtherReports && (
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
                )}
              </div>
            )}
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
            {paramModal.filterMode === 'statement' ? (
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">
                    {paramModal.category === 'ap' ? 'Pilih Vendor' : 'Pilih Pelanggan'}
                  </div>
                  {paramModal.category === 'ap' ? (
                    <ReportEntitySelect
                      kind="vendors"
                      label="Vendor"
                      value={selectedVendorId}
                      onChange={(vendorId) => setSelectedVendorId(vendorId)}
                      placeholder="Pilih vendor..."
                      className="mb-0"
                    />
                  ) : (
                    <ReportEntitySelect
                      kind="customers"
                      label="Pelanggan"
                      value={selectedCustomerId}
                      selectedName={filterCustomer}
                      onChange={(customerId) => setSelectedCustomerId(customerId)}
                      placeholder="Pilih pelanggan..."
                      className="mb-0"
                    />
                  )}
                </div>
                <div>
                  <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Periode</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm text-neutral-600 mb-1">Dari</label>
                      <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-neutral-600 mb-1">s/d</label>
                      <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : paramModal.filterMode === 'inventory-snapshot' ? (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Filter Persediaan</div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-neutral-600 mb-1">As of Date</label>
                    <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} className="block w-full px-3 h-10 border border-neutral-300 rounded-md" />
                  </div>
                  <div>
                    <label className="block text-sm text-neutral-600 mb-1">Kategori</label>
                    <select
                      value={valuationCategoryId}
                      onChange={(e) => setValuationCategoryId(e.target.value)}
                      className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                    >
                      <option value="">Semua kategori</option>
                      {itemCategories.map((cat) => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-neutral-600 mb-1">Gudang</label>
                    <select
                      value={valuationWarehouseId}
                      onChange={(e) => setValuationWarehouseId(e.target.value)}
                      className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                    >
                      <option value="">Semua gudang</option>
                      {warehouses.map((wh) => (
                        <option key={wh.id} value={wh.id}>{wh.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ) : paramModal.filterMode === 'bank-period' ? (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Periode &amp; Bank</div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-sm text-neutral-600 mb-1">Dari</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-neutral-600 mb-1">s/d</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                    />
                  </div>
                </div>
                <SearchableSelect
                  label={paramModal.bankRequired ? 'Bank' : 'Bank (Opsional — semua bank bila kosong)'}
                  options={bankAccounts.map((a) => ({ value: a.id, label: a.name }))}
                  value={selectedBankAccountId}
                  onChange={(id) => setSelectedBankAccountId(id)}
                  placeholder={paramModal.bankRequired ? 'Pilih bank...' : 'Semua bank'}
                  className="mb-0"
                />
              </div>
            ) : paramModal.filterMode === 'date-range' ? (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">
                  {paramModal.id === 'profit-loss-multi-period' ? 'Periode Saat Ini' : paramModal.category === 'gl' ? 'Date Range' : 'Tanggal'}
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
                {paramModal.category === 'sales' && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {PERIOD_PRESETS.map((preset) => {
                      const [from, to] = preset.range();
                      const active = dateFrom === from && dateTo === to;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => { setDateFrom(from); setDateTo(to); }}
                          className={`px-2.5 h-7 text-xs rounded-full border transition-colors ${active
                              ? 'bg-primary-50 border-primary-300 text-primary-700 font-medium'
                              : 'bg-neutral-0 border-neutral-300 text-neutral-600 hover:bg-neutral-100'
                            }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {paramModal.id === 'profit-loss-multi-period' && (
                  <div className="mt-4">
                    <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Periode Pembanding</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm text-neutral-600 mb-1">From</label>
                        <input
                          type="date"
                          value={compareDateFrom}
                          onChange={(e) => setCompareDateFrom(e.target.value)}
                          className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-neutral-600 mb-1">To</label>
                        <input
                          type="date"
                          value={compareDateTo}
                          onChange={(e) => setCompareDateTo(e.target.value)}
                          className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">
                  {paramModal.category === 'gl' ? 'Report Date' : paramModal.category === 'ap' ? 'Snapshot Utang' : 'Snapshot Piutang'}
                </div>
                <div>
                  <label className="block text-sm text-neutral-600 mb-1">As of Date</label>
                  <input
                    type="date"
                    aria-label="Report as-of date"
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
                  <ReportEntitySelect
                    kind="customers"
                    label="Pelanggan (Opsional)"
                    value={selectedCustomerId}
                    selectedName={filterCustomer}
                    onChange={(customerId, name) => {
                      setSelectedCustomerId(customerId);
                      setFilterCustomer(name);
                    }}
                    placeholder="Semua pelanggan"
                    className="mb-0"
                  />
                  <label className="flex items-start gap-3 p-3 rounded-md border border-neutral-200 hover:bg-neutral-50 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={topNCustomer}
                      onChange={(e) => setTopNCustomer(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span>
                      <span className="block text-sm font-medium text-neutral-800">Top 30 Pelanggan</span>
                      <span className="block text-xs text-neutral-500">Tampilkan 30 pelanggan dengan nilai penjualan tertinggi</span>
                    </span>
                  </label>
                </div>
              </div>
            )}

            {(paramModal.id === 'share-by-item' || paramModal.id === 'share-by-customer') && (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Tampilan Diagram</div>
                <label className="block text-sm text-neutral-600 mb-1">
                  {paramModal.id === 'share-by-item' ? 'Jumlah barang teratas' : 'Jumlah pelanggan teratas'}
                </label>
                <select
                  value={shareTopN}
                  onChange={(e) => setShareTopN(Number(e.target.value))}
                  className="block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
                >
                  {[5, 10, 15, 20].map((n) => (
                    <option key={n} value={n}>Top {n} (sisanya digabung sebagai Others)</option>
                  ))}
                </select>
              </div>
            )}

            {paramModal.id === 'sales-return-list' && (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Filter Pelanggan</div>
                <ReportEntitySelect
                  kind="customers"
                  label="Pelanggan (Opsional)"
                  value={selectedCustomerId}
                  selectedName={filterCustomer}
                  onChange={(customerId, name) => {
                    setSelectedCustomerId(customerId);
                    setFilterCustomer(name);
                  }}
                  placeholder="Semua pelanggan"
                  className="mb-0"
                />
              </div>
            )}

            {paramModal.id === 'by-item' && (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Filter Barang</div>
                <div className="space-y-3">
                  <ReportEntitySelect
                    kind="items"
                    label="Barang (Opsional)"
                    value={selectedItemId}
                    selectedName={filterItem}
                    onChange={(itemId, name) => {
                      setSelectedItemId(itemId);
                      setFilterItem(name);
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
                  <ReportEntitySelect
                    kind="customers"
                    label="Pelanggan (Opsional)"
                    value={selectedCustomerId}
                    selectedName={filterCustomer}
                    onChange={(customerId, name) => {
                      setSelectedCustomerId(customerId);
                      setFilterCustomer(name);
                    }}
                    placeholder="Pilih pelanggan..."
                    className="mb-0"
                  />
                  <ReportEntitySelect
                    kind="items"
                    label="Barang (Opsional)"
                    value={selectedItemId}
                    selectedName={filterItem}
                    onChange={(itemId, name) => {
                      setSelectedItemId(itemId);
                      setFilterItem(name);
                    }}
                    placeholder="Pilih barang..."
                    className="mb-0"
                  />
                </div>
              </div>
            )}

            {paramModal.id === 'account-ledger' && (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Pilih Akun</div>
                <SearchableSelect
                  label="Akun"
                  options={accountOptions}
                  value={selectedAccountId}
                  onChange={(accountId) => setSelectedAccountId(accountId)}
                  placeholder="Pilih akun..."
                  className="mb-0"
                />
              </div>
            )}

            {paramModal.category === 'ar' && paramModal.id !== 'statement' && (
              <div>
                <div className="text-sm font-semibold text-neutral-700 mb-3 pb-2 border-b">Filter Pelanggan</div>
                <div className="space-y-3">
                  <ReportEntitySelect
                    kind="customers"
                    label="Customer (Optional)"
                    value={selectedCustomerId}
                    selectedName={filterCustomer}
                    onChange={(customerId, name) => {
                      setSelectedCustomerId(customerId);
                      setFilterCustomer(name);
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

            <div className="flex items-center justify-between pt-4 border-t border-neutral-200">
              <button
                type="button"
                onClick={resetModalFilters}
                className="text-sm text-neutral-500 hover:text-neutral-800 underline"
              >
                Reset Filter
              </button>
              <Button
                text="Tampilkan"
                variant="primary"
                onClick={handleRunReport}
                disabled={
                  (paramModal.id === 'statement' && !selectedCustomerId) ||
                  (paramModal.id === 'ap-statement' && !selectedVendorId) ||
                  (paramModal.filterMode === 'bank-period' && paramModal.bankRequired && !selectedBankAccountId)
                }
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Reports;

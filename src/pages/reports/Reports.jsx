import React, { useState, useMemo, useCallback } from 'react';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Table from '../../components/UI/Table';
import ListPage from '../../components/Layout/ListPage';
import { useChartOfAccounts } from '../../hooks/useGL';
import { rollupBalances } from '../../utils/coa';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { useReportStore } from '../../stores/useReportStore';
import { useGLStore } from '../../stores/useGLStore';
import APAging from './APAging';
import CashFlow from './CashFlow';
import PrintPreviewModal from '../../components/UI/PrintPreviewModal';
import ReportPrintTemplate from '../../components/print/ReportPrintTemplate';
import { exportToExcel } from '../../utils/exportExcel';
import { exportToPdf } from '../../utils/exportPdf';
import { useSettingsStore } from '../../stores/useSettingsStore';

// ─── Date Range Helpers ────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const getPresetRange = (preset, referenceDate = new Date()) => {
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth(); // 0-indexed

    switch (preset) {
        case 'this-month': {
            return { startDate: fmtDate(new Date(year, month, 1)), endDate: fmtDate(new Date(year, month + 1, 0)) };
        }
        case 'last-month': {
            return { startDate: fmtDate(new Date(year, month - 1, 1)), endDate: fmtDate(new Date(year, month, 0)) };
        }
        case 'this-quarter': {
            const qs = Math.floor(month / 3) * 3;
            return { startDate: fmtDate(new Date(year, qs, 1)), endDate: fmtDate(new Date(year, qs + 3, 0)) };
        }
        case 'last-quarter': {
            const qs = Math.floor(month / 3) * 3 - 3;
            return { startDate: fmtDate(new Date(year, qs, 1)), endDate: fmtDate(new Date(year, qs + 3, 0)) };
        }
        case 'this-year': {
            return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
        }
        case 'last-year': {
            return { startDate: `${year - 1}-01-01`, endDate: `${year - 1}-12-31` };
        }
        case 'this-week': {
            const offset = (referenceDate.getDay() + 6) % 7;
            const mon = new Date(referenceDate); mon.setDate(referenceDate.getDate() - offset);
            const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
            return { startDate: fmtDate(mon), endDate: fmtDate(sun) };
        }
        case 'last-week': {
            const offset = (referenceDate.getDay() + 6) % 7;
            const thisMonday = new Date(referenceDate); thisMonday.setDate(referenceDate.getDate() - offset);
            const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
            const lastSunday = new Date(lastMonday); lastSunday.setDate(lastMonday.getDate() + 6);
            return { startDate: fmtDate(lastMonday), endDate: fmtDate(lastSunday) };
        }
        default:
            return { startDate: '', endDate: '' };
    }
};

const PERIOD_PRESETS = [
    { value: 'this-month', label: 'This Month' },
    { value: 'last-month', label: 'Last Month' },
    { value: 'this-week', label: 'This Week' },
    { value: 'last-week', label: 'Last Week' },
    { value: 'this-quarter', label: 'This Quarter' },
    { value: 'last-quarter', label: 'Last Quarter' },
    { value: 'this-year', label: 'This Year' },
    { value: 'last-year', label: 'Last Year' },
    { value: 'custom', label: 'Custom Range' },
];

const TABS = [
    { id: 'balance-sheet', label: 'Balance Sheet' },
    { id: 'profit-loss', label: 'Profit & Loss' },
    { id: 'trial-balance', label: 'Trial Balance' },
    { id: 'gl-detail', label: 'GL Detail' },
    { id: 'sales-by-item', label: 'Sales by Item' },
    { id: 'sales-by-customer', label: 'Sales by Customer' },
    { id: 'ar-aging', label: 'A/R Aging' },
    { id: 'ap-aging', label: 'A/P Aging' },
    { id: 'cash-flow', label: 'Cash Flow' },
];

// ─── Period selector sub-component ────────────────────────────────────────

const PeriodSelector = ({ label, preset, onPreset, customStart, onCustomStart, customEnd, onCustomEnd }) => (
    <div className="flex flex-col gap-2">
        {label && <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">{label}</span>}
        <div className="flex flex-wrap gap-2 items-end">
            <div>
                <label className="form-label">Period</label>
                <select
                    className="h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                    value={preset}
                    onChange={(e) => onPreset(e.target.value)}
                >
                    {PERIOD_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                </select>
            </div>
            {preset === 'custom' && (
                <>
                    <div>
                        <label className="form-label">From</label>
                        <input
                            type="date"
                            className="h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                            value={customStart}
                            onChange={(e) => onCustomStart(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="form-label">To</label>
                        <input
                            type="date"
                            className="h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                            value={customEnd}
                            onChange={(e) => onCustomEnd(e.target.value)}
                        />
                    </div>
                </>
            )}
        </div>
    </div>
);

// ─── Period-aware balance computation ─────────────────────────────────────

/**
 * Derive account balances for a given date range by scanning journal entries.
 *
 * Strategy:
 * - Start from the static opening `accountBalancesById` snapshot (represents
 *   balances BEFORE any journal entries, i.e., opening balances).
 * - Add debit/credit movements from journal entries that fall within the
 *   given date range.
 * - Return an `ownBalanceById` map identical in shape to what `rollupBalances`
 *   expects so `buildGroupedRows` stays unchanged.
 *
 * Debit increases Debit-normal accounts (Asset, Expense) and decreases
 * Credit-normal accounts (Liability, Equity, Revenue).
 */
const computePeriodBalances = (accounts, openingBalances, journalEntries, startDate, endDate) => {
    // Build account type lookup
    const typeById = accounts.reduce((m, a) => { m[a.id] = a.type; return m; }, {});
    const debitNormal = new Set(['Asset', 'Expense']);

    // Start from opening balances
    const ownBalanceById = { ...openingBalances };

    // Apply journal entry movements in range
    journalEntries.forEach((entry) => {
        if (!entry.lines) return;
        if (startDate && entry.date < startDate) return;
        if (endDate && entry.date > endDate) return;

        entry.lines.forEach((line) => {
            const acctId = line.accountId;
            if (!typeById[acctId]) return;
            const isDebitNorm = debitNormal.has(typeById[acctId]);
            const debit = Number(line.debit || 0);
            const credit = Number(line.credit || 0);
            const prev = Number(ownBalanceById[acctId] || 0);
            // Debit-normal: +debit -credit / Credit-normal: -debit +credit
            ownBalanceById[acctId] = isDebitNorm
                ? prev + debit - credit
                : prev - debit + credit;
        });
    });

    return ownBalanceById;
};

// ─── Build grouped rows for BS / P&L ─────────────────────────────────────

const buildGroupedRows = (accounts, ownBalanceById, allowedTypes) => {
    const accountRows = accounts
        .filter((a) => a.isPostable && a.isActive && allowedTypes.includes(a.type))
        .map((a) => ({
            id: a.id,
            section: a.reportGroup,
            subGroup: a.reportSubGroup || '-',
            account: `${a.code} - ${a.name}`,
            amountValue: ownBalanceById[a.id] || 0,
        }))
        .sort((a, b) => {
            if (a.section !== b.section) return a.section.localeCompare(b.section);
            if (a.subGroup !== b.subGroup) return a.subGroup.localeCompare(b.subGroup);
            return a.account.localeCompare(b.account);
        });

    const grouped = [];
    let currentGroupKey = '';
    let subtotal = 0;

    accountRows.forEach((row, index) => {
        const rowGroupKey = `${row.section}::${row.subGroup}`;
        const isNewGroup = rowGroupKey !== currentGroupKey;

        if (isNewGroup && currentGroupKey) {
            const [, sg] = currentGroupKey.split('::');
            grouped.push({ id: `subtotal-${currentGroupKey}`, section: '', subGroup: `Subtotal ${sg}`, account: '', amountValue: subtotal, isSubtotal: true });
            subtotal = 0;
        }

        grouped.push({ ...row, section: isNewGroup ? row.section : '', subGroup: isNewGroup ? row.subGroup : '' });
        subtotal += row.amountValue;
        currentGroupKey = rowGroupKey;

        if (index === accountRows.length - 1) {
            const [, sg] = rowGroupKey.split('::');
            grouped.push({ id: `subtotal-${rowGroupKey}`, section: '', subGroup: `Subtotal ${sg}`, account: '', amountValue: subtotal, isSubtotal: true });
        }
    });

    return grouped;
};

// ─── Merge two period row arrays into comparison columns ──────────────────

const mergeComparisonRows = (rowsA, rowsB) => {
    // Build map from id → amountValue for period B
    const bMap = rowsB.reduce((m, r) => { m[r.id] = r.amountValue; return m; }, {});

    return rowsA.map((row) => {
        const aVal = row.amountValue || 0;
        const bVal = bMap[row.id] || 0;
        const diff = aVal - bVal;
        const pct = bVal !== 0 ? ((diff / Math.abs(bVal)) * 100).toFixed(1) : null;
        return { ...row, bVal, diff, pct };
    });
};

// ─── Aging bucket helper ───────────────────────────────────────────────────

const getAgingBucket = (days) => {
    if (days <= 0) return 'current';
    if (days <= 30) return '1-30';
    if (days <= 60) return '31-60';
    if (days <= 90) return '61-90';
    return '90+';
};

// ─── Component ─────────────────────────────────────────────────────────────

const Reports = () => {
    const company = useSettingsStore((s) => s.companyInfo);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);

    // ── API hooks ───────────────────────────────────────────────────────────
    const { data: apiChartOfAccounts = [] } = useChartOfAccounts();
    const accountBalancesById = useMemo(() => {
        const map = {};
        apiChartOfAccounts.forEach(a => { map[a.id] = a.balance ?? 0; });
        return map;
    }, [apiChartOfAccounts]);

    // ── Store data ──────────────────────────────────────────────────────────
    const salesLines = useReportStore((s) => s.salesLines);
    const agingInvoices = useReportStore((s) => s.agingInvoices);
    const journalEntries = useGLStore((s) => s.journalEntries);
    const glChartOfAccounts = useGLStore((s) => s.chartOfAccounts);
    const glAccountBalances = useGLStore((s) => s.accountBalancesById);

    // Use store data when available, fall back to API data
    const accounts = glChartOfAccounts?.length ? glChartOfAccounts : apiChartOfAccounts;
    const openingBal = glAccountBalances && Object.keys(glAccountBalances).length ? glAccountBalances : accountBalancesById;

    // ── Tab ─────────────────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState('balance-sheet');

    // ── Period A (primary) ──────────────────────────────────────────────────
    const [presetA, setPresetA] = useState('this-year');
    const [customStartA, setCustomStartA] = useState('');
    const [customEndA, setCustomEndA] = useState('');

    // ── Period B (comparison) ───────────────────────────────────────────────
    const [compareMode, setCompareMode] = useState(false);
    const [presetB, setPresetB] = useState('last-year');
    const [customStartB, setCustomStartB] = useState('');
    const [customEndB, setCustomEndB] = useState('');

    // ── Resolve date ranges ─────────────────────────────────────────────────
    const rangeA = useMemo(() => {
        if (presetA === 'custom') return { startDate: customStartA, endDate: customEndA };
        return getPresetRange(presetA);
    }, [presetA, customStartA, customEndA]);

    const rangeB = useMemo(() => {
        if (presetB === 'custom') return { startDate: customStartB, endDate: customEndB };
        return getPresetRange(presetB);
    }, [presetB, customStartB, customEndB]);

    // Alias for non-BS/PL tabs which only use one period
    const { startDate, endDate } = rangeA;

    // ── Period labels ───────────────────────────────────────────────────────
    const periodLabel = useCallback(({ startDate: s, endDate: e }) => {
        if (s && e) return `${formatDateID(s)} – ${formatDateID(e)}`;
        if (s) return `From ${formatDateID(s)}`;
        if (e) return `To ${formatDateID(e)}`;
        return 'All Periods';
    }, []);

    const labelA = periodLabel(rangeA);
    const labelB = periodLabel(rangeB);

    // ── isInRange helper (for non-BS tabs) ─────────────────────────────────
    const isInRange = useCallback((dateStr) => {
        if (!startDate && !endDate) return true;
        if (startDate && dateStr < startDate) return false;
        if (endDate && dateStr > endDate) return false;
        return true;
    }, [startDate, endDate]);

    // ── Period-aware balance maps ───────────────────────────────────────────
    const balancesA = useMemo(
        () => computePeriodBalances(accounts, openingBal, journalEntries, rangeA.startDate, rangeA.endDate),
        [accounts, openingBal, journalEntries, rangeA.startDate, rangeA.endDate]
    );

    const balancesB = useMemo(
        () => compareMode
            ? computePeriodBalances(accounts, openingBal, journalEntries, rangeB.startDate, rangeB.endDate)
            : null,
        [accounts, openingBal, journalEntries, rangeB.startDate, rangeB.endDate, compareMode]
    );

    // ── Build BS / P&L row sets ─────────────────────────────────────────────
    const bsTypes = ['Asset', 'Liability', 'Equity'];
    const plTypes = ['Revenue', 'Expense'];

    const bsRowsA = useMemo(() => buildGroupedRows(accounts, balancesA, bsTypes), [accounts, balancesA]);
    const plRowsA = useMemo(() => buildGroupedRows(accounts, balancesA, plTypes), [accounts, balancesA]);

    const bsRowsB = useMemo(
        () => balancesB ? buildGroupedRows(accounts, balancesB, bsTypes) : null,
        [accounts, balancesB]
    );
    const plRowsB = useMemo(
        () => balancesB ? buildGroupedRows(accounts, balancesB, plTypes) : null,
        [accounts, balancesB]
    );

    // Merged comparison rows
    const bsRows = useMemo(
        () => bsRowsB ? mergeComparisonRows(bsRowsA, bsRowsB) : bsRowsA,
        [bsRowsA, bsRowsB]
    );
    const plRows = useMemo(
        () => plRowsB ? mergeComparisonRows(plRowsA, plRowsB) : plRowsA,
        [plRowsA, plRowsB]
    );

    // ── Single-column formatted rows (no comparison) ───────────────────────
    const fmtRows = (rows) => rows.map((r) => ({ ...r, amount: formatIDR(r.amountValue || 0) }));

    // ── Trial Balance ───────────────────────────────────────────────────────
    const trialBalance = useMemo(() => {
        const rows = accounts
            .filter((a) => a.isPostable && a.isActive)
            .map((a) => {
                const balance = balancesA[a.id] || 0;
                const isDr = a.normalSide === 'Debit';
                return {
                    id: a.id,
                    code: a.code,
                    name: a.name,
                    type: a.type,
                    debitValue: isDr ? Math.abs(balance) : balance < 0 ? Math.abs(balance) : 0,
                    creditValue: !isDr ? Math.abs(balance) : balance < 0 ? Math.abs(balance) : 0,
                };
            })
            .filter((r) => r.debitValue !== 0 || r.creditValue !== 0)
            .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

        const totalDebit = rows.reduce((s, r) => s + r.debitValue, 0);
        const totalCredit = rows.reduce((s, r) => s + r.creditValue, 0);

        return {
            rows: rows.map((r) => ({ ...r, debit: formatIDR(r.debitValue), credit: formatIDR(r.creditValue) })),
            totalDebit,
            totalCredit,
            balanced: Math.abs(totalDebit - totalCredit) < 1,
        };
    }, [accounts, balancesA]);

    // ── GL Detail ───────────────────────────────────────────────────────────
    const accountMap = useMemo(() => accounts.reduce((m, a) => { m[a.id] = a; return m; }, {}), [accounts]);

    const glDetail = useMemo(() => {
        const lines = [];
        journalEntries.forEach((entry, ei) => {
            if (!entry.lines || !isInRange(entry.date)) return;
            entry.lines.forEach((line, li) => {
                lines.push({
                    id: `${entry.entryNo}-${line.accountId}-${line.id ?? `${ei}-${li}`}`,
                    date: entry.date,
                    entryNo: entry.entryNo,
                    memo: entry.memo,
                    accountId: line.accountId,
                    debit: line.debit || 0,
                    credit: line.credit || 0,
                });
            });
        });
        return lines.sort((a, b) => a.date.localeCompare(b.date) || a.entryNo.localeCompare(b.entryNo));
    }, [journalEntries, isInRange]);

    // ── Sales reports ───────────────────────────────────────────────────────
    const filteredSalesLines = useMemo(
        () => salesLines.filter((l) => isInRange(l.date)),
        [salesLines, isInRange]
    );

    const salesByItem = useMemo(() => {
        const map = {};
        filteredSalesLines.forEach((l) => {
            if (!map[l.itemId]) map[l.itemId] = { id: l.itemId, itemName: l.itemName, category: l.category, qty: 0, totalValue: 0, invoiceCount: new Set() };
            map[l.itemId].qty += l.qty;
            map[l.itemId].totalValue += l.total;
            map[l.itemId].invoiceCount.add(l.invoiceId);
        });
        return Object.values(map)
            .map((r) => ({ ...r, invoiceCount: r.invoiceCount.size, total: formatIDR(r.totalValue) }))
            .sort((a, b) => b.totalValue - a.totalValue);
    }, [filteredSalesLines]);

    const salesByItemTotal = useMemo(() => filteredSalesLines.reduce((s, l) => s + l.total, 0), [filteredSalesLines]);

    const salesByCustomer = useMemo(() => {
        const map = {};
        filteredSalesLines.forEach((l) => {
            if (!map[l.customerId]) map[l.customerId] = { id: l.customerId, customerName: l.customerName, totalValue: 0, invoiceCount: new Set(), itemCount: 0 };
            map[l.customerId].totalValue += l.total;
            map[l.customerId].invoiceCount.add(l.invoiceId);
            map[l.customerId].itemCount += l.qty;
        });
        return Object.values(map)
            .map((r) => ({ ...r, invoiceCount: r.invoiceCount.size, total: formatIDR(r.totalValue) }))
            .sort((a, b) => b.totalValue - a.totalValue);
    }, [filteredSalesLines]);

    // ── AR Aging ────────────────────────────────────────────────────────────
    const agingRows = useMemo(() => agingInvoices
        .filter((inv) => isInRange(inv.invoiceDate))
        .map((inv) => ({
            ...inv,
            bucket: getAgingBucket(inv.daysOverdue),
            current: inv.daysOverdue <= 0 ? inv.balance : 0,
            d1_30: inv.daysOverdue > 0 && inv.daysOverdue <= 30 ? inv.balance : 0,
            d31_60: inv.daysOverdue > 30 && inv.daysOverdue <= 60 ? inv.balance : 0,
            d61_90: inv.daysOverdue > 60 && inv.daysOverdue <= 90 ? inv.balance : 0,
            d90plus: inv.daysOverdue > 90 ? inv.balance : 0,
        })),
        [agingInvoices, isInRange]);

    const agingTotals = useMemo(() => ({
        current: agingRows.reduce((s, r) => s + r.current, 0),
        d1_30: agingRows.reduce((s, r) => s + r.d1_30, 0),
        d31_60: agingRows.reduce((s, r) => s + r.d31_60, 0),
        d61_90: agingRows.reduce((s, r) => s + r.d61_90, 0),
        d90plus: agingRows.reduce((s, r) => s + r.d90plus, 0),
        balance: agingRows.reduce((s, r) => s + r.balance, 0),
    }), [agingRows]);

    // ── Column definitions ──────────────────────────────────────────────────

    // Single-period grouped report columns (BS / P&L without compare)
    const singleReportColumns = (accountLabel = 'Account') => [
        { key: 'section', label: 'Report Group' },
        { key: 'subGroup', label: 'Sub-group' },
        {
            key: 'account', label: accountLabel,
            render: (val, row) => row.isSubtotal ? <span className="text-strong">Subtotal</span> : val
        },
        {
            key: 'amount', label: 'Amount', align: 'right',
            render: (val, row) => row.isSubtotal ? <span className="text-strong">{val}</span> : val
        },
    ];

    // Comparison columns — Period A | Period B | Variance | %
    const compareColumns = (accountLabel = 'Account') => [
        { key: 'section', label: 'Report Group' },
        { key: 'subGroup', label: 'Sub-group' },
        {
            key: 'account', label: accountLabel,
            render: (val, row) => row.isSubtotal ? <span className="text-strong">Subtotal</span> : val
        },
        {
            key: 'amountValue', label: labelA, align: 'right',
            render: (val, row) => {
                const f = formatIDR(val || 0);
                return row.isSubtotal ? <span className="text-strong">{f}</span> : f;
            }
        },
        {
            key: 'bVal', label: labelB, align: 'right',
            render: (val, row) => {
                const f = formatIDR(val || 0);
                return row.isSubtotal ? <span className="text-strong">{f}</span> : f;
            }
        },
        {
            key: 'diff', label: 'Variance', align: 'right',
            render: (val, row) => {
                const v = val || 0;
                const color = v > 0 ? 'text-success-600' : v < 0 ? 'text-danger-600' : 'text-neutral-400';
                const f = `${v >= 0 ? '+' : ''}${formatIDR(v)}`;
                return row.isSubtotal
                    ? <span className={`text-strong ${color}`}>{f}</span>
                    : <span className={color}>{f}</span>;
            }
        },
        {
            key: 'pct', label: '% Change', align: 'right',
            render: (val, row) => {
                if (row.isSubtotal) return null;
                if (val === null) return <span className="text-neutral-400">—</span>;
                const color = Number(val) > 0 ? 'text-success-600' : Number(val) < 0 ? 'text-danger-600' : 'text-neutral-400';
                return <span className={color}>{val > 0 ? '+' : ''}{val}%</span>;
            }
        },
    ];

    const tbColumns = [
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Account Name' },
        { key: 'type', label: 'Type' },
        { key: 'debit', label: 'Debit', align: 'right' },
        { key: 'credit', label: 'Credit', align: 'right' },
    ];

    const glColumns = [
        { key: 'date', label: 'Date', sortable: true, render: (val) => formatDateID(val) },
        { key: 'entryNo', label: 'Entry No.' },
        { key: 'memo', label: 'Memo' },
        {
            key: 'accountId', label: 'Account',
            render: (val) => { const a = accountMap[val]; return a ? `${a.code} - ${a.name}` : val; }
        },
        { key: 'debit', label: 'Debit', align: 'right', render: (val) => val ? formatIDR(val) : '—' },
        { key: 'credit', label: 'Credit', align: 'right', render: (val) => val ? formatIDR(val) : '—' },
    ];

    const salesByItemColumns = [
        { key: 'itemName', label: 'Item', sortable: true },
        { key: 'category', label: 'Category', sortable: true },
        { key: 'invoiceCount', label: 'Invoices', align: 'right' },
        { key: 'qty', label: 'Qty Sold', align: 'right' },
        { key: 'total', label: 'Sales Amount', align: 'right' },
    ];

    const salesByCustomerColumns = [
        { key: 'customerName', label: 'Customer', sortable: true },
        { key: 'invoiceCount', label: 'Invoices', align: 'right' },
        { key: 'itemCount', label: 'Items Sold', align: 'right' },
        { key: 'total', label: 'Sales Amount', align: 'right' },
    ];

    const agingColumns = [
        { key: 'invoiceId', label: 'Invoice', sortable: true },
        { key: 'customerName', label: 'Customer', sortable: true },
        { key: 'invoiceDate', label: 'Inv. Date', render: (val) => formatDateID(val) },
        { key: 'dueDate', label: 'Due Date', render: (val) => formatDateID(val) },
        {
            key: 'daysOverdue', label: 'Days', align: 'right',
            render: (val) => val > 0 ? <span className="stock-danger">{val}</span> : <span className="stock-normal">Current</span>
        },
        { key: 'current', label: 'Current', align: 'right', render: (val) => val ? formatIDR(val) : '—' },
        { key: 'd1_30', label: '1–30 days', align: 'right', render: (val) => val ? <span className="stock-warning">{formatIDR(val)}</span> : '—' },
        { key: 'd31_60', label: '31–60 days', align: 'right', render: (val) => val ? <span className="stock-danger">{formatIDR(val)}</span> : '—' },
        { key: 'd61_90', label: '61–90 days', align: 'right', render: (val) => val ? <span className="stock-danger">{formatIDR(val)}</span> : '—' },
        { key: 'd90plus', label: '90+ days', align: 'right', render: (val) => val ? <span className="stock-danger">{formatIDR(val)}</span> : '—' },
        { key: 'balance', label: 'Balance', align: 'right', render: (val) => <span className="text-strong">{formatIDR(val)}</span> },
    ];

    // ── Export and Print Helpers ─────────────────────────────────────────────
    const getActiveReportData = () => {
        switch (activeTab) {
            case 'balance-sheet': return { title: 'Balance Sheet', cols: compareMode ? compareColumns('Account') : singleReportColumns('Account'), data: compareMode ? bsRows : fmtRows(bsRows) };
            case 'profit-loss': return { title: 'Profit & Loss', cols: compareMode ? compareColumns('Description') : singleReportColumns('Description'), data: compareMode ? plRows : fmtRows(plRows) };
            case 'trial-balance': return { title: 'Trial Balance', cols: tbColumns, data: trialBalance.rows, totals: [{ label: 'Total Debit', value: formatIDR(trialBalance.totalDebit) }, { label: 'Total Credit', value: formatIDR(trialBalance.totalCredit) }] };
            case 'gl-detail': return { title: 'General Ledger Detail', cols: glColumns, data: glDetail };
            case 'sales-by-item': return { title: 'Sales by Item', cols: salesByItemColumns, data: salesByItem, totals: [{ label: 'Total Sales', value: formatIDR(salesByItemTotal) }] };
            case 'sales-by-customer': return { title: 'Sales by Customer', cols: salesByCustomerColumns, data: salesByCustomer, totals: [{ label: 'Total Sales', value: formatIDR(salesByItemTotal) }] };
            case 'ar-aging': return { title: 'A/R Aging', cols: agingColumns, data: agingRows, totals: [{ label: 'Total Outstanding', value: formatIDR(agingTotals.balance) }] };
            default: return null;
        }
    };

    const handleExportExcel = () => {
        const report = getActiveReportData();
        if (!report) return window.alert('Export not supported for this tab yet.');
        exportToExcel(`Report_${report.title.replace(/\\s+/g, '_')}_${new Date().getTime()}`, report.title, report.cols, report.data);
    };

    const handleExportPdf = () => {
        const report = getActiveReportData();
        if (!report) return window.alert('Export not supported for this tab yet.');
        exportToPdf(`Report_${report.title.replace(/\\s+/g, '_')}_${new Date().getTime()}`, report.title, report.cols, report.data, company);
    };

    const activeReportData = getActiveReportData();

    // ── Tabs that show period filter vs comparison controls ─────────────────
    const isBSOrPL = activeTab === 'balance-sheet' || activeTab === 'profit-loss';
    const showDateFilter = !isBSOrPL && ['trial-balance', 'gl-detail', 'sales-by-item', 'sales-by-customer', 'ar-aging', 'ap-aging', 'cash-flow'].includes(activeTab);

    // ── Render ──────────────────────────────────────────────────────────────
    return (
        <ListPage
            containerClassName="reporting-module"
            title="Financial Reports"
            subtitle="Core financial statements and sales analytics."
            actions={
                <div className="flex gap-2">
                    <Button text="Print / Preview" variant="secondary" size="small" onClick={() => {
                        if (!getActiveReportData()) return window.alert('Print not supported for this tab yet.');
                        setIsPreviewOpen(true);
                    }} />
                    <Button text="Export PDF" variant="secondary" size="small" onClick={handleExportPdf} />
                    <Button text="Export Excel" variant="secondary" size="small" onClick={handleExportExcel} />
                </div>
            }
        >
            {/* ── Tab Row ── */}
            <div className="report-tabs-row">
                {TABS.map((tab) => (
                    <Button
                        key={tab.id}
                        text={tab.label}
                        variant={activeTab === tab.id ? 'primary' : 'secondary'}
                        size="small"
                        onClick={() => setActiveTab(tab.id)}
                    />
                ))}
            </div>

            {/* ── BS / P&L Period Controls ── */}
            {isBSOrPL && (
                <div className="invoice-panel" style={{ marginBottom: 0 }}>
                    <div className="flex flex-wrap gap-6 items-start p-4">
                        {/* Period A */}
                        <PeriodSelector
                            label={compareMode ? 'Period A' : undefined}
                            preset={presetA}
                            onPreset={setPresetA}
                            customStart={customStartA}
                            onCustomStart={setCustomStartA}
                            customEnd={customEndA}
                            onCustomEnd={setCustomEndA}
                        />

                        {/* Compare toggle */}
                        <div className="flex flex-col gap-2">
                            {compareMode && (
                                <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide invisible">x</span>
                            )}
                            <div className="flex items-end h-10">
                                <button
                                    type="button"
                                    onClick={() => setCompareMode((v) => !v)}
                                    className={`h-10 px-4 rounded-md text-sm font-medium border transition-colors ${compareMode
                                            ? 'bg-primary-700 text-white border-primary-700 hover:bg-primary-800'
                                            : 'bg-neutral-0 text-neutral-700 border-neutral-300 hover:bg-neutral-100'
                                        }`}
                                >
                                    {compareMode ? '✓ Comparing' : '⇄ Compare Period'}
                                </button>
                            </div>
                        </div>

                        {/* Period B — only when compare is on */}
                        {compareMode && (
                            <>
                                <div className="flex items-end h-10 pb-0">
                                    <span className="text-sm text-neutral-400 font-medium mb-2.5">vs.</span>
                                </div>
                                <PeriodSelector
                                    label="Period B"
                                    preset={presetB}
                                    onPreset={setPresetB}
                                    customStart={customStartB}
                                    onCustomStart={setCustomStartB}
                                    customEnd={customEndB}
                                    onCustomEnd={setCustomEndB}
                                />
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ── Other tabs: single date filter ── */}
            {showDateFilter && (
                <div className="filter-bar filter-bar--period">
                    <div className="filter-bar__field">
                        <label className="form-label">Period</label>
                        <select
                            className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                            value={presetA}
                            onChange={(e) => setPresetA(e.target.value)}
                        >
                            {PERIOD_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                    </div>
                    {presetA === 'custom' && (
                        <>
                            <div className="filter-bar__field">
                                <label className="form-label">From</label>
                                <input type="date" className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                    value={customStartA} onChange={(e) => setCustomStartA(e.target.value)} />
                            </div>
                            <div className="filter-bar__field">
                                <label className="form-label">To</label>
                                <input type="date" className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                                    value={customEndA} onChange={(e) => setCustomEndA(e.target.value)} />
                            </div>
                        </>
                    )}
                    {startDate && endDate && (
                        <div className="filter-bar__label">
                            Showing: <strong>{labelA}</strong>
                        </div>
                    )}
                </div>
            )}

            {/* ── Balance Sheet ── */}
            {activeTab === 'balance-sheet' && (
                <Card
                    title={compareMode ? `Balance Sheet — ${labelA} vs ${labelB}` : `Balance Sheet — ${labelA}`}
                    padding={false}
                >
                    {compareMode
                        ? <Table columns={compareColumns('Account')} data={bsRows} />
                        : <Table columns={singleReportColumns('Account')} data={fmtRows(bsRows)} />
                    }
                </Card>
            )}

            {/* ── Profit & Loss ── */}
            {activeTab === 'profit-loss' && (
                <Card
                    title={compareMode ? `Profit & Loss — ${labelA} vs ${labelB}` : `Profit & Loss — ${labelA}`}
                    padding={false}
                >
                    {compareMode
                        ? <Table columns={compareColumns('Description')} data={plRows} />
                        : <Table columns={singleReportColumns('Description')} data={fmtRows(plRows)} />
                    }
                </Card>
            )}

            {/* ── Trial Balance ── */}
            {activeTab === 'trial-balance' && (
                <Card title={`Trial Balance — ${labelA}`} padding={false}>
                    <Table columns={tbColumns} data={trialBalance.rows} />
                    <div className="journal-totals-bar" style={{ padding: '12px 16px', borderTop: '2px solid var(--color-neutral-300)' }}>
                        <div />
                        <div className="journal-totals-meta">
                            <div className="text-strong">Total Debit: {formatIDR(trialBalance.totalDebit)}</div>
                            <div className="text-strong">Total Credit: {formatIDR(trialBalance.totalCredit)}</div>
                            {trialBalance.balanced
                                ? <div className="journal-balanced">&#10003; Balanced</div>
                                : <div className="journal-unbalanced">Not Balanced</div>
                            }
                        </div>
                    </div>
                </Card>
            )}

            {/* ── GL Detail ── */}
            {activeTab === 'gl-detail' && (
                <Card title={`General Ledger Detail — ${labelA}`} padding={false}>
                    {glDetail.length > 0
                        ? <Table columns={glColumns} data={glDetail} />
                        : <div className="module-empty-state">No journal entries found for this period.</div>
                    }
                </Card>
            )}

            {/* ── Sales by Item ── */}
            {activeTab === 'sales-by-item' && (
                <Card title={`Sales by Item — ${labelA}`} padding={false}>
                    {salesByItem.length > 0 ? (
                        <>
                            <Table columns={salesByItemColumns} data={salesByItem} />
                            <div className="journal-totals-bar" style={{ padding: '12px 16px', borderTop: '2px solid var(--color-neutral-300)' }}>
                                <div /><div className="journal-totals-meta"><div className="text-strong">Total Sales: {formatIDR(salesByItemTotal)}</div></div>
                            </div>
                        </>
                    ) : <div className="module-empty-state">No sales data found for this period.</div>}
                </Card>
            )}

            {/* ── Sales by Customer ── */}
            {activeTab === 'sales-by-customer' && (
                <Card title={`Sales by Customer — ${labelA}`} padding={false}>
                    {salesByCustomer.length > 0 ? (
                        <>
                            <Table columns={salesByCustomerColumns} data={salesByCustomer} />
                            <div className="journal-totals-bar" style={{ padding: '12px 16px', borderTop: '2px solid var(--color-neutral-300)' }}>
                                <div /><div className="journal-totals-meta"><div className="text-strong">Total Sales: {formatIDR(salesByItemTotal)}</div></div>
                            </div>
                        </>
                    ) : <div className="module-empty-state">No sales data found for this period.</div>}
                </Card>
            )}

            {/* ── A/R Aging ── */}
            {activeTab === 'ar-aging' && (
                <Card title="Accounts Receivable Aging" padding={false}>
                    {agingRows.length > 0 ? (
                        <>
                            <Table columns={agingColumns} data={agingRows} />
                            <div className="journal-totals-bar" style={{ padding: '12px 16px', borderTop: '2px solid var(--color-neutral-300)' }}>
                                <div />
                                <div className="journal-totals-meta" style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                                    <div className="text-strong">Current: {formatIDR(agingTotals.current)}</div>
                                    <div className="text-strong">1–30: {formatIDR(agingTotals.d1_30)}</div>
                                    <div className="text-strong">31–60: {formatIDR(agingTotals.d31_60)}</div>
                                    <div className="text-strong">61–90: {formatIDR(agingTotals.d61_90)}</div>
                                    <div className="text-strong">90+: {formatIDR(agingTotals.d90plus)}</div>
                                    <div className="text-strong" style={{ borderLeft: '1px solid var(--color-neutral-300)', paddingLeft: '24px' }}>
                                        Total Outstanding: {formatIDR(agingTotals.balance)}
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : <div className="module-empty-state">No open invoices found.</div>}
                </Card>
            )}

            {/* ── A/P Aging ── */}
            {activeTab === 'ap-aging' && (
                <APAging startDate={startDate} endDate={endDate} isInRange={isInRange} />
            )}

            {/* ── Cash Flow ── */}
            {activeTab === 'cash-flow' && (
                <CashFlow startDate={startDate} endDate={endDate} isInRange={isInRange} />
            )}

            <PrintPreviewModal
                isOpen={isPreviewOpen}
                onClose={() => setIsPreviewOpen(false)}
                title="Report Print Preview"
                documentTitle={activeReportData ? `Report_${activeReportData.title}` : 'Report'}
            >
                {activeReportData && (
                    <ReportPrintTemplate
                        title={activeReportData.title}
                        dateRangeLabel={compareMode && isBSOrPL ? `${labelA} vs ${labelB}` : labelA}
                        columns={activeReportData.cols}
                        data={activeReportData.data}
                        company={company}
                        totals={activeReportData.totals}
                    />
                )}
            </PrintPreviewModal>

        </ListPage>
    );
};

export default Reports;

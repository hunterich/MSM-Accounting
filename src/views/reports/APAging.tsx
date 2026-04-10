import React, { useState } from 'react';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import Button from '../../components/UI/Button';
import { Download } from 'lucide-react';
import { formatDateID, formatIDR } from '../../utils/formatters';
import { useAPReport } from '../../hooks/useAP';
import { exportToCsv } from '../../utils/exportCsv';

// ── API row shapes ─────────────────────────────────────────────────────────────

interface APAgingRow extends Record<string, unknown> {
    id: string;
    vendorName: string;
    billDate: string;
    dueDate: string;
    daysOverdue: number;
    balance: number;
    current: number;
    d1_30: number;
    d31_60: number;
    d61_90: number;
    d90plus: number;
}

interface APAgingTotals {
    current: number;
    d1_30: number;
    d31_60: number;
    d61_90: number;
    d90plus: number;
    balance: number;
}

interface APAgingData {
    rows: APAgingRow[];
    summary?: APAgingTotals;
}

// ── Component ─────────────────────────────────────────────────────────────────

const APAging: React.FC = () => {
    const [asOfDate, setAsOfDate] = useState<string>(new Date().toISOString().slice(0, 10));

    const { data, isLoading } = useAPReport({ type: 'aging', asOfDate });
    const agingData = data as APAgingData | undefined;

    const rows: APAgingRow[] = agingData?.rows ?? [];

    const totals: APAgingTotals = agingData?.summary ?? {
        current: rows.reduce((s, r) => s + r.current, 0),
        d1_30:   rows.reduce((s, r) => s + r.d1_30, 0),
        d31_60:  rows.reduce((s, r) => s + r.d31_60, 0),
        d61_90:  rows.reduce((s, r) => s + r.d61_90, 0),
        d90plus: rows.reduce((s, r) => s + r.d90plus, 0),
        balance: rows.reduce((s, r) => s + r.balance, 0),
    };

    const handleExportCsv = () => {
        const csvRows = rows.map((r) => ({
            billNo: r.id,
            vendor: r.vendorName,
            billDate: r.billDate,
            dueDate: r.dueDate,
            daysOverdue: r.daysOverdue,
            current: r.current,
            d1_30: r.d1_30,
            d31_60: r.d31_60,
            d61_90: r.d61_90,
            d90plus: r.d90plus,
            balance: r.balance,
        }));
        exportToCsv(`ap-aging-${asOfDate}.csv`, csvRows, [
            { label: 'Bill No.', key: 'billNo' },
            { label: 'Vendor', key: 'vendor' },
            { label: 'Bill Date', key: 'billDate' },
            { label: 'Due Date', key: 'dueDate' },
            { label: 'Days Overdue', key: 'daysOverdue' },
            { label: 'Current', key: 'current' },
            { label: '1-30 days', key: 'd1_30' },
            { label: '31-60 days', key: 'd31_60' },
            { label: '61-90 days', key: 'd61_90' },
            { label: '90+ days', key: 'd90plus' },
            { label: 'Balance', key: 'balance' },
        ]);
    };

    const agingColumns: TableColumn<APAgingRow>[] = [
        { key: 'id', label: 'Bill No.', sortable: true },
        { key: 'vendorName', label: 'Vendor', sortable: true },
        { key: 'billDate', label: 'Bill Date', render: (val) => formatDateID(val as string) },
        { key: 'dueDate', label: 'Due Date', render: (val) => formatDateID(val as string) },
        {
            key: 'daysOverdue', label: 'Days', align: 'right',
            render: (val) => (val as number) > 0
                ? <span className="stock-danger">{val as number}</span>
                : <span className="stock-normal">Current</span>,
        },
        { key: 'current',  label: 'Current',   align: 'right', render: (val) => (val as number) ? formatIDR(val as number) : '—' },
        { key: 'd1_30',   label: '1–30 days',  align: 'right', render: (val) => (val as number) ? <span className="stock-warning">{formatIDR(val as number)}</span> : '—' },
        { key: 'd31_60',  label: '31–60 days', align: 'right', render: (val) => (val as number) ? <span className="stock-danger">{formatIDR(val as number)}</span> : '—' },
        { key: 'd61_90',  label: '61–90 days', align: 'right', render: (val) => (val as number) ? <span className="stock-danger">{formatIDR(val as number)}</span> : '—' },
        { key: 'd90plus', label: '90+ days',   align: 'right', render: (val) => (val as number) ? <span className="stock-danger">{formatIDR(val as number)}</span> : '—' },
        { key: 'balance', label: 'Balance',    align: 'right', render: (val) => <span className="text-strong">{formatIDR(val as number)}</span> },
    ];

    return (
        <div className="print-report-module bg-white">
            {/* Date + export controls */}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <label className="text-sm text-neutral-600 font-medium whitespace-nowrap">As of date:</label>
                    <input
                        type="date"
                        className="h-9 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                        value={asOfDate}
                        onChange={(e) => setAsOfDate(e.target.value)}
                    />
                </div>
                <Button
                    text="Export CSV"
                    size="small"
                    variant="secondary"
                    icon={<Download size={14} />}
                    onClick={handleExportCsv}
                    disabled={rows.length === 0}
                />
            </div>

            <Card title="Accounts Payable Aging" padding={false} className="print:shadow-none print:border-neutral-300">
                {rows.length > 0 || isLoading ? (
                    <>
                        <Table<APAgingRow>
                            columns={agingColumns}
                            data={rows}
                            isLoading={isLoading}
                            loadingLabel="Loading AP aging..."
                            virtualize={false}
                        />
                        {!isLoading && (
                            <div className="journal-totals-bar" style={{ padding: '12px 16px', borderTop: '2px solid var(--color-neutral-300)' }}>
                                <div />
                                <div className="journal-totals-meta" style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                                    <div className="text-strong">Current: {formatIDR(totals.current)}</div>
                                    <div className="text-strong">1–30: {formatIDR(totals.d1_30)}</div>
                                    <div className="text-strong">31–60: {formatIDR(totals.d31_60)}</div>
                                    <div className="text-strong">61–90: {formatIDR(totals.d61_90)}</div>
                                    <div className="text-strong">90+: {formatIDR(totals.d90plus)}</div>
                                    <div className="text-strong" style={{ borderLeft: '1px solid var(--color-neutral-300)', paddingLeft: '24px' }}>
                                        Total Outstanding: {formatIDR(totals.balance)}
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="module-empty-state">No open bills found for the selected date.</div>
                )}
            </Card>
        </div>
    );
};

export default APAging;

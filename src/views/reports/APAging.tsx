import React, { useMemo } from 'react';
import Card from '../../components/UI/Card';
import Table, { TableColumn } from '../../components/UI/Table';
import { useBillStore } from '../../stores/useBillStore';
import { useVendorStore } from '../../stores/useVendorStore';
import { formatDateID, formatIDR } from '../../utils/formatters';

interface APAgingProps {
    startDate: string;
    endDate: string;
    isInRange: (date: string) => boolean;
}

/** Internal shape for each bill record from the legacy store */
interface BillRecord {
    id: string;
    status?: string;
    date?: string;
    due?: string;
    amount?: number;
    vendor?: string;
    [key: string]: unknown;
}

/** Vendor record from the legacy store */
interface VendorRecord {
    id: string;
    name?: string;
    [key: string]: unknown;
}

interface AgingRow extends BillRecord, Record<string, unknown> {
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

interface AgingTotals {
    current: number;
    d1_30: number;
    d31_60: number;
    d61_90: number;
    d90plus: number;
    balance: number;
}

const getAgingBucket = (daysOverdue: number): string => {
    if (daysOverdue <= 0) return 'current';
    if (daysOverdue <= 30) return '1-30';
    if (daysOverdue <= 60) return '31-60';
    if (daysOverdue <= 90) return '61-90';
    return '90+';
};

const APAging = ({ startDate, endDate, isInRange }: APAgingProps) => {
    /* These stores use loose Record types; cast for type safety within this component */
    const bills = useBillStore((s) => s.bills) as unknown as BillRecord[];
    const vendors = useVendorStore((s) => s.vendors) as unknown as VendorRecord[];

    const agingRows = useMemo<AgingRow[]>(() => {
        const today = new Date();

        return bills
            .filter((bill) => bill.status !== 'Paid' && isInRange(bill.date ?? ''))
            .map((bill) => {
                const dueDate = new Date(bill.due ?? '');
                const diffTime = today.getTime() - dueDate.getTime();
                const daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                const vendorName = vendors.find(v => v.id === bill.vendor)?.name ?? (bill.vendor ?? '');
                const billAmount = bill.amount ?? 0;

                return {
                    ...bill,
                    vendorName,
                    billDate: bill.date ?? '',
                    dueDate: bill.due ?? '',
                    daysOverdue,
                    balance: billAmount,
                    current: daysOverdue <= 0 ? billAmount : 0,
                    d1_30: daysOverdue > 0 && daysOverdue <= 30 ? billAmount : 0,
                    d31_60: daysOverdue > 30 && daysOverdue <= 60 ? billAmount : 0,
                    d61_90: daysOverdue > 60 && daysOverdue <= 90 ? billAmount : 0,
                    d90plus: daysOverdue > 90 ? billAmount : 0,
                };
            });
    }, [bills, vendors, isInRange]);

    const agingTotals = useMemo<AgingTotals>(() => ({
        current: agingRows.reduce((s, r) => s + r.current, 0),
        d1_30: agingRows.reduce((s, r) => s + r.d1_30, 0),
        d31_60: agingRows.reduce((s, r) => s + r.d31_60, 0),
        d61_90: agingRows.reduce((s, r) => s + r.d61_90, 0),
        d90plus: agingRows.reduce((s, r) => s + r.d90plus, 0),
        balance: agingRows.reduce((s, r) => s + r.balance, 0),
    }), [agingRows]);

    const agingColumns: TableColumn<AgingRow>[] = [
        { key: 'id', label: 'Bill No.', sortable: true },
        { key: 'vendorName', label: 'Vendor', sortable: true },
        { key: 'billDate', label: 'Bill Date', render: (val) => formatDateID(val as string) },
        { key: 'dueDate', label: 'Due Date', render: (val) => formatDateID(val as string) },
        { key: 'daysOverdue', label: 'Days', align: 'right', render: (val) => (val as number) > 0 ? <span className="stock-danger">{val as number}</span> : <span className="stock-normal">Current</span> },
        { key: 'current', label: 'Current', align: 'right', render: (val) => (val as number) ? formatIDR(val as number) : '—' },
        { key: 'd1_30', label: '1–30 days', align: 'right', render: (val) => (val as number) ? <span className="stock-warning">{formatIDR(val as number)}</span> : '—' },
        { key: 'd31_60', label: '31–60 days', align: 'right', render: (val) => (val as number) ? <span className="stock-danger">{formatIDR(val as number)}</span> : '—' },
        { key: 'd61_90', label: '61–90 days', align: 'right', render: (val) => (val as number) ? <span className="stock-danger">{formatIDR(val as number)}</span> : '—' },
        { key: 'd90plus', label: '90+ days', align: 'right', render: (val) => (val as number) ? <span className="stock-danger">{formatIDR(val as number)}</span> : '—' },
        { key: 'balance', label: 'Balance', align: 'right', render: (val) => <span className="text-strong">{formatIDR(val as number)}</span> },
    ];

    return (
        <div className="print-report-module bg-white">
            <Card title="Accounts Payable Aging" padding={false} className="print:shadow-none print:border-neutral-300">
                {agingRows.length > 0 ? (
                    <>
                        <Table<AgingRow> columns={agingColumns} data={agingRows} virtualize={false} />
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
                ) : (
                    <div className="module-empty-state">No open bills found.</div>
                )}
            </Card>
        </div>
    );
};

export default APAging;

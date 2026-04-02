import React, { useMemo } from 'react';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import { useBillStore } from '../../stores/useBillStore';
import { useVendorStore } from '../../stores/useVendorStore';
import { formatDateID, formatIDR } from '../../utils/formatters';

const getAgingBucket = (daysOverdue) => {
    if (daysOverdue <= 0) return 'current';
    if (daysOverdue <= 30) return '1-30';
    if (daysOverdue <= 60) return '31-60';
    if (daysOverdue <= 90) return '61-90';
    return '90+';
};

const APAging = ({ startDate, endDate, isInRange }) => {
    const bills = useBillStore((s) => s.bills);
    const vendors = useVendorStore((s) => s.vendors);

    const agingRows = useMemo(() => {
        const today = new Date();

        return bills
            .filter((bill) => bill.status !== 'Paid' && isInRange(bill.date))
            .map((bill) => {
                const dueDate = new Date(bill.due);
                const diffTime = today - dueDate;
                const daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                const vendorName = vendors.find(v => v.id === bill.vendor)?.name || bill.vendor;

                return {
                    ...bill,
                    vendorName,
                    billDate: bill.date,
                    dueDate: bill.due,
                    daysOverdue,
                    balance: bill.amount,
                    current: daysOverdue <= 0 ? bill.amount : 0,
                    d1_30: daysOverdue > 0 && daysOverdue <= 30 ? bill.amount : 0,
                    d31_60: daysOverdue > 30 && daysOverdue <= 60 ? bill.amount : 0,
                    d61_90: daysOverdue > 60 && daysOverdue <= 90 ? bill.amount : 0,
                    d90plus: daysOverdue > 90 ? bill.amount : 0,
                };
            });
    }, [bills, vendors, isInRange]);

    const agingTotals = useMemo(() => ({
        current: agingRows.reduce((s, r) => s + r.current, 0),
        d1_30: agingRows.reduce((s, r) => s + r.d1_30, 0),
        d31_60: agingRows.reduce((s, r) => s + r.d31_60, 0),
        d61_90: agingRows.reduce((s, r) => s + r.d61_90, 0),
        d90plus: agingRows.reduce((s, r) => s + r.d90plus, 0),
        balance: agingRows.reduce((s, r) => s + r.balance, 0),
    }), [agingRows]);

    const agingColumns = [
        { key: 'id', label: 'Bill No.', sortable: true },
        { key: 'vendorName', label: 'Vendor', sortable: true },
        { key: 'billDate', label: 'Bill Date', render: (val) => formatDateID(val) },
        { key: 'dueDate', label: 'Due Date', render: (val) => formatDateID(val) },
        { key: 'daysOverdue', label: 'Days', align: 'right', render: (val) => val > 0 ? <span className="stock-danger">{val}</span> : <span className="stock-normal">Current</span> },
        { key: 'current', label: 'Current', align: 'right', render: (val) => val ? formatIDR(val) : '—' },
        { key: 'd1_30', label: '1–30 days', align: 'right', render: (val) => val ? <span className="stock-warning">{formatIDR(val)}</span> : '—' },
        { key: 'd31_60', label: '31–60 days', align: 'right', render: (val) => val ? <span className="stock-danger">{formatIDR(val)}</span> : '—' },
        { key: 'd61_90', label: '61–90 days', align: 'right', render: (val) => val ? <span className="stock-danger">{formatIDR(val)}</span> : '—' },
        { key: 'd90plus', label: '90+ days', align: 'right', render: (val) => val ? <span className="stock-danger">{formatIDR(val)}</span> : '—' },
        { key: 'balance', label: 'Balance', align: 'right', render: (val) => <span className="text-strong">{formatIDR(val)}</span> },
    ];

    return (
        <div className="print-report-module bg-white">
            <Card title="Accounts Payable Aging" padding={false} className="print:shadow-none print:border-neutral-300">
                {agingRows.length > 0 ? (
                    <>
                        <Table columns={agingColumns} data={agingRows} virtualize={false} />
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

import React, { useMemo } from 'react';
import Card from '../../components/UI/Card';
import Table from '../../components/UI/Table';
import { useChartOfAccounts, useJournalEntries } from '../../hooks/useGL';
import { formatIDR } from '../../utils/formatters';

const CashFlow = ({ startDate, endDate, isInRange }) => {

    const { data: chartOfAccounts = [] } = useChartOfAccounts();
    const { data: jeData } = useJournalEntries({ limit: 1000 });
    const journalEntriesSeed = jeData?.data ?? [];

    const cashFlowData = useMemo(() => {
        // 1. Identify Cash Accounts
        const cashAccounts = new Set(
            chartOfAccounts
                .filter(a => a.type === 'Asset' && ['Cash', 'Bank'].some(keyword => a.name.includes(keyword) || a.subGroup === 'Cash & Bank'))
                .map(a => a.id)
        );

        let totalInflow = 0;
        let totalOutflow = 0;
        const inflowLines = [];
        const outflowLines = [];

        // 2. Scan Journal Entries for cash movements
        (journalEntriesSeed || []).forEach(entry => {
            if (!isInRange(entry.date)) return;

            let entryCashDebit = 0;
            let entryCashCredit = 0;

            // Find how much cash changed in this entry
            entry.lines.forEach(line => {
                if (cashAccounts.has(line.accountId)) {
                    entryCashDebit += (line.debit || 0);
                    entryCashCredit += (line.credit || 0);
                }
            });

            const netCashChange = entryCashDebit - entryCashCredit;

            if (netCashChange > 0) {
                // Cash Inflow
                totalInflow += netCashChange;
                inflowLines.push({
                    id: entry.entryNo,
                    date: entry.date,
                    description: entry.memo || 'Cash Receipt',
                    amount: netCashChange
                });
            } else if (netCashChange < 0) {
                // Cash Outflow
                const outflowAmount = Math.abs(netCashChange);
                totalOutflow += outflowAmount;
                outflowLines.push({
                    id: entry.entryNo,
                    date: entry.date,
                    description: entry.memo || 'Cash Disbursement',
                    amount: outflowAmount
                });
            }
        });

        // 3. Build Presentation Rows
        const rows = [];

        rows.push({
            id: 'inflow-header',
            description: 'Cash Inflows (Operating Activities)',
            amountValue: null,
            isHeader: true
        });

        inflowLines.forEach(line => {
            rows.push({
                id: `in-${line.id}`,
                description: `  ${line.date} - ${line.description}`,
                amountValue: line.amount,
                isData: true
            });
        });

        rows.push({
            id: 'inflow-total',
            description: 'Total Cash Inflows',
            amountValue: totalInflow,
            isSubtotal: true
        });

        rows.push({
            id: 'outflow-header',
            description: 'Cash Outflows (Operating & Investing)',
            amountValue: null,
            isHeader: true
        });

        outflowLines.forEach(line => {
            rows.push({
                id: `out-${line.id}`,
                description: `  ${line.date} - ${line.description}`,
                amountValue: line.amount,
                isData: true
            });
        });

        rows.push({
            id: 'outflow-total',
            description: 'Total Cash Outflows',
            amountValue: totalOutflow,
            isSubtotal: true
        });

        rows.push({
            id: 'net-cash-flow',
            description: 'Net Cash Flow',
            amountValue: totalInflow - totalOutflow,
            isGrandTotal: true
        });

        return rows.map(r => ({
            ...r,
            amount: r.amountValue !== null ? formatIDR(r.amountValue) : ''
        }));
    }, [chartOfAccounts, journalEntriesSeed, isInRange]);

    const columns = [
        {
            key: 'description',
            label: 'Description',
            render: (val, row) => {
                if (row.isHeader) return <span className="font-bold text-neutral-800 text-[1.05rem]">{val}</span>;
                if (row.isSubtotal) return <span className="font-semibold text-neutral-700">{val}</span>;
                if (row.isGrandTotal) return <span className="font-bold text-primary-700 text-lg">{val}</span>;
                return <span className="text-neutral-600 whitespace-pre">{val}</span>;
            }
        },
        {
            key: 'amount',
            label: 'Amount',
            align: 'right',
            render: (val, row) => {
                if (row.isHeader) return '';
                if (row.isSubtotal) return <span className="font-semibold text-neutral-800">{val}</span>;
                if (row.isGrandTotal) return <span className="font-bold text-primary-700 text-lg">{val}</span>;
                return val;
            }
        }
    ];

    return (
        <div className="print-report-module bg-white">
            <Card title="Statement of Cash Flows (Direct Method)" padding={false} className="print:shadow-none print:border-neutral-300">
                <Table columns={columns} data={cashFlowData} virtualize={false} />
            </Card>
        </div>
    );
};

export default CashFlow;

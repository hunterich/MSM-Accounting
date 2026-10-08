import React, { useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, ChevronLeft, ChevronRight, Clock, MoreVertical, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/apiClient';
import { useAuthStore } from '../../../stores/useAuthStore';
import { dashboardPeriod, jakartaToday, percentageChange, periodLabel, previousYear } from '../../../utils/dashboardPeriod';
import './financialOverview.css';

interface Sales { sales: number; paid: number; unpaid: number; current: number; overdue: number; outstanding: number }
interface Profit { income: number; cogs: number; expenditure: number; profit: number }
interface CustomerSales { rows: Array<{ customerId: string; customerName: string; total: number }>; grandTotal: number }
const money = (amount: number) => `Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(amount)}`;
const share = (amount: number, total: number) => total > 0 ? Math.min(100, Math.max(0, amount / total * 100)) : 0;

function usePeriod(kind: 'month' | 'year') {
    const [offset, setOffset] = useState(0);
    const today = jakartaToday();
    return { ...dashboardPeriod(kind, offset, today), today, offset, step: (delta: number) => setOffset(o => Math.min(0, o + delta)), reset: () => setOffset(0) };
}
type Period = ReturnType<typeof usePeriod>;

function Widget({ title, period, fetching, refresh, note, children, className = '' }: {
    title: string; period: Period; fetching: boolean; refresh: () => void; note: string; children: React.ReactNode; className?: string;
}) {
    return <section className={`financial-widget ${className}`} aria-label={title}>
        <header className="financial-widget-header">
            <h3>{title} <span className="financial-scope">(Current Company)</span></h3>
            <div className="financial-header-actions">
                <button type="button" onClick={refresh} disabled={fetching} aria-label={`Refresh ${title}`} title="Refresh"><RefreshCw size={19} className={fetching ? 'animate-spin' : ''} /></button>
                <details className="financial-menu"><summary aria-label={`Options for ${title}`}><MoreVertical size={18} /></summary><div><p>{note}</p><button type="button" onClick={period.reset}>Return to current period</button></div></details>
            </div>
        </header>
        <div className="financial-period">
            <button type="button" onClick={() => period.step(-1)} aria-label={`Previous period for ${title}`}><ChevronLeft size={15} /></button>
            <span>{periodLabel(period.dateFrom, period.dateTo)}</span>
            <button type="button" onClick={() => period.step(1)} disabled={period.offset === 0} aria-label={`Next period for ${title}`}><ChevronRight size={15} /></button>
        </div>
        {children}
    </section>;
}

function QueryState({ loading, error, retry }: { loading: boolean; error: boolean; retry: () => void }) {
    return <div className="financial-state" role={error ? 'alert' : 'status'}>{loading ? 'Loading…' : <><p>Couldn&apos;t load this widget.</p><button type="button" onClick={retry}>Try again</button></>}</div>;
}

function SplitBar({ left, right, leftColor, rightColor, label }: { left: number; right: number; leftColor: string; rightColor: string; label: string }) {
    const total = left + right;
    return <div className="financial-split-bar" role="img" aria-label={label}>
        <span style={{ width: `${share(left, total)}%`, backgroundColor: leftColor }} />
        <span style={{ width: `${share(right, total)}%`, backgroundColor: rightColor }} />
    </div>;
}

export function MonthlySalesWidget() {
    const period = usePeriod('month');
    const orgId = useAuthStore(s => s.org?.id);
    const query = useQuery({ queryKey: ['dashboard-sales', orgId, period.dateFrom, period.dateTo, period.today], queryFn: () => api.get<Sales>('/api/v1/reports/dashboard', { type: 'sales', dateFrom: period.dateFrom, dateTo: period.dateTo }) });
    const refresh = () => { void query.refetch(); };
    const d = query.data;
    return <Widget title="Penjualan Bulan ini" className="financial-sales-widget" period={period} fetching={query.isFetching} refresh={refresh} note="Sales include posted invoices in the selected period. Paid includes payments, settlement discounts, and applied credit notes. Outstanding is the current balance across all invoice dates.">
        {query.isLoading || query.isError || !d ? <QueryState loading={query.isLoading} error={query.isError} retry={refresh} /> : <div className="financial-sales-grid">
            <div>
                <div className="financial-total"><h4>Sales</h4><strong>{money(d.sales)}</strong></div>
                <div className="financial-pair financial-muted"><span>Paid Invoices</span><span>Unpaid Invoices</span></div>
                <div className="financial-pair financial-values"><span style={{ color: '#3cbd00' }}>{money(d.paid)}</span><span style={{ color: '#ed9200' }}>{money(d.unpaid)}</span></div>
                <SplitBar left={d.paid} right={d.unpaid} leftColor="#3cbd00" rightColor="#ffbe32" label={`Settled ${money(d.paid)}; unpaid ${money(d.unpaid)}`} />
            </div>
            <div>
                <div className="financial-asof">Today · {periodLabel(period.today, period.today).split(' – ')[0]}</div>
                <div className="financial-total"><h4>Outstanding</h4><strong>{money(d.outstanding)}</strong></div>
                <div className="financial-pair financial-muted"><span>Not overdue yet</span><span>Overdue</span></div>
                <div className="financial-pair financial-values"><span style={{ color: '#ed9200' }}>{money(d.current)}</span><span style={{ color: '#f04424' }}>{money(d.overdue)}</span></div>
                <SplitBar left={d.current} right={d.overdue} leftColor="#ffbe32" rightColor="#ff5130" label={`Not overdue ${money(d.current)}; overdue ${money(d.overdue)}`} />
            </div>
        </div>}
    </Widget>;
}

export function YearlyProfitLossWidget() {
    const period = usePeriod('year');
    const orgId = useAuthStore(s => s.org?.id);
    const compareFrom = previousYear(period.dateFrom), compareTo = previousYear(period.dateTo);
    const query = useQuery({ queryKey: ['dashboard-profit', orgId, period.dateFrom, period.dateTo], queryFn: async () => {
        const [current, previous] = await Promise.all([
            api.get<Profit>('/api/v1/reports/dashboard', { type: 'profit-loss', dateFrom: period.dateFrom, dateTo: period.dateTo }),
            api.get<Profit>('/api/v1/reports/dashboard', { type: 'profit-loss', dateFrom: compareFrom, dateTo: compareTo }),
        ]);
        return { current, previous };
    } });
    const refresh = () => { void query.refetch(); };
    const d = query.data;
    const metrics = [{ key: 'income', label: 'Income', color: '#26d7b0' }, { key: 'cogs', label: 'COGS Value', color: '#ffca36' }, { key: 'expenditure', label: 'Expenditure', color: '#ff5d88' }] as const;
    const weights = d ? metrics.map(m => Math.max(0, d.current[m.key])) : [0, 0, 0];
    const total = weights.reduce((sum, v) => sum + v, 0);
    const incomeEnd = share(weights[0], total), cogsEnd = incomeEnd + share(weights[1], total);
    const change = d ? percentageChange(d.current.profit, d.previous.profit) : null;
    return <Widget title="Laba/Rugi Tahun ini" period={period} fetching={query.isFetching} refresh={refresh} note="Income, COGS, and expenditure come from posted journals. Percentages compare against the same period last year. The ring shows positive amounts; signed amounts remain in the figures.">
        {query.isLoading || query.isError || !d ? <QueryState loading={query.isLoading} error={query.isError} retry={refresh} /> : <div className="financial-profit-layout">
            <div className="financial-profit-chart">
                <div className="financial-donut" role="img" aria-label={`Income ${money(d.current.income)}, COGS ${money(d.current.cogs)}, expenditure ${money(d.current.expenditure)}`} style={{ background: total ? `conic-gradient(#26d7b0 0% ${incomeEnd}%, #ffca36 ${incomeEnd}% ${cogsEnd}%, #ff5d88 ${cogsEnd}% 100%)` : '#efefef' }}>
                    <div className={change !== null && change < 0 ? 'financial-negative' : 'financial-positive'}>{change === null ? <span className="financial-no-comparison">No prior data</span> : <>{change < 0 ? <ArrowDownCircle size={17} /> : <ArrowUpCircle size={17} />} {Math.abs(change).toFixed(0)}%</>}</div>
                </div>
                <p>Compared to {periodLabel(compareFrom, compareTo)}</p>
            </div>
            <div className="financial-profit-detail">
                <div className="financial-metrics">{metrics.map(m => {
                    const delta = percentageChange(d.current[m.key], d.previous[m.key]);
                    const favorable = delta === null || (m.key === 'income' ? delta >= 0 : delta <= 0);
                    return <div className="financial-metric" key={m.key}><span className="financial-dot" style={{ backgroundColor: m.color }} /><span>{m.label}</span><strong>{money(d.current[m.key])}</strong><span className={`financial-pill ${favorable ? '' : 'financial-pill-negative'}`} title="Change compared to the same period last year">{delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`}</span></div>;
                })}</div>
                <div className="financial-profit-total"><strong>{d.current.profit < 0 ? 'Loss' : 'Profit'}</strong><strong className={d.current.profit < 0 ? 'financial-negative' : 'financial-positive'}>{money(d.current.profit)}</strong></div>
                <div className="financial-updated"><Clock size={14} /> Updated at {new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(query.dataUpdatedAt)}</div>
            </div>
        </div>}
    </Widget>;
}

export function CustomerSalesWidget() {
    const period = usePeriod('month');
    const orgId = useAuthStore(s => s.org?.id);
    const query = useQuery({ queryKey: ['dashboard-customer-sales', orgId, period.dateFrom, period.dateTo], queryFn: () => api.get<CustomerSales>('/api/v1/reports/dashboard', { type: 'customers', dateFrom: period.dateFrom, dateTo: period.dateTo }) });
    const refresh = () => { void query.refetch(); };
    const d = query.data;
    return <Widget title="Penjualan Pelanggan" period={period} fetching={query.isFetching} refresh={refresh} note="Customers ranked by posted invoice sales. Percentages use total sales across all customers in the selected period.">
        {query.isLoading || query.isError || !d ? <QueryState loading={query.isLoading} error={query.isError} retry={refresh} /> : d.rows.length === 0 ? <div className="financial-state">No customer sales in this period.</div> : <ol className="financial-customers">{d.rows.slice(0, 10).map((customer, i) => {
            const pct = share(customer.total, d.grandTotal);
            return <li key={customer.customerId}><span className={`financial-medal financial-medal-${i + 1}`}>{i + 1}</span><div className="financial-customer-detail"><div className="financial-customer-line"><span>{customer.customerName}</span><strong>{money(customer.total)}</strong><span className="financial-pill">{pct.toFixed(0)}%</span></div><div className="financial-customer-bar" role="img" aria-label={`${customer.customerName}: ${pct.toFixed(1)}% of sales`}><span style={{ width: `${pct}%` }} /></div></div></li>;
        })}</ol>}
    </Widget>;
}

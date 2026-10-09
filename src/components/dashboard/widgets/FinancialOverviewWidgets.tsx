import React, { useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, ChevronLeft, ChevronRight, Clock, MoreVertical, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/apiClient';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useLanguageStore } from '../../../stores/useLanguageStore';
import { translate } from '../../../i18n/language';
import { dashboardPeriod, jakartaToday, percentageChange, periodLabel, previousYear, profitRing } from '../../../utils/dashboardPeriod';
import './financialOverview.css';

interface Sales { sales: number; grossSales: number; returns: number; paid: number; unpaid: number; current: number; overdue: number; outstanding: number }
interface Profit { income: number; cogs: number; expenditure: number; profit: number }
interface CustomerSales { rows: Array<{ customerId: string; customerName: string; total: number }>; grandTotal: number }
const money = (amount: number) => `Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(amount)}`;
const share = (amount: number, total: number) => total > 0 ? Math.min(100, Math.max(0, amount / total * 100)) : 0;

const RING_LABELS = { cogs: 'COGS Value', expenditure: 'Expenditure', profit: 'Profit' } as const;

function useT() {
    const language = useLanguageStore(s => s.language) ?? 'en';
    return { language, t: (english: string) => translate(language, english) };
}

function usePeriod(kind: 'month' | 'year') {
    const [offset, setOffset] = useState(0);
    const today = jakartaToday();
    return { ...dashboardPeriod(kind, offset, today), today, offset, step: (delta: number) => setOffset(o => Math.min(0, o + delta)), reset: () => setOffset(0) };
}
type Period = ReturnType<typeof usePeriod>;

function Widget({ title, period, fetching, refresh, note, children, className = '', taxLabel }: {
    title: string; period: Period; fetching: boolean; refresh: () => void; note: string; children: React.ReactNode; className?: string; taxLabel?: string;
}) {
    const { language, t } = useT();
    return <section className={`financial-widget ${className}`} aria-label={title}>
        <header className="financial-widget-header">
            <h3>{title} {taxLabel && <span className="financial-scope">{taxLabel}</span>} <span className="financial-scope">({t('Current Company')})</span></h3>
            <div className="financial-header-actions">
                <button type="button" onClick={refresh} disabled={fetching} aria-label={`${t('Refresh')} ${title}`} title={t('Refresh')}><RefreshCw size={19} className={fetching ? 'animate-spin' : ''} /></button>
                <details className="financial-menu"><summary aria-label={`${t('Options for')} ${title}`}><MoreVertical size={18} /></summary><div><p>{note}</p><button type="button" onClick={period.reset}>{t('Return to current period')}</button></div></details>
            </div>
        </header>
        <div className="financial-period">
            <button type="button" onClick={() => period.step(-1)} aria-label={`${t('Previous period for')} ${title}`}><ChevronLeft size={15} /></button>
            <span>{periodLabel(period.dateFrom, period.dateTo, language)}</span>
            <button type="button" onClick={() => period.step(1)} disabled={period.offset === 0} aria-label={`${t('Next period for')} ${title}`}><ChevronRight size={15} /></button>
        </div>
        {children}
    </section>;
}

function QueryState({ loading, error, retry }: { loading: boolean; error: boolean; retry: () => void }) {
    const { t } = useT();
    return <div className="financial-state" role={error ? 'alert' : 'status'}>{loading ? t('Loading…') : <><p>{t('Couldn’t load this widget.')}</p><button type="button" onClick={retry}>{t('Try again')}</button></>}</div>;
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
    const { language, t } = useT();
    const orgId = useAuthStore(s => s.org?.id);
    const query = useQuery({ queryKey: ['dashboard-sales', orgId, period.dateFrom, period.dateTo, period.today], queryFn: () => api.get<Sales>('/api/v1/reports/dashboard', { type: 'sales', dateFrom: period.dateFrom, dateTo: period.dateTo }) });
    const refresh = () => { void query.refetch(); };
    const d = query.data;
    return <Widget title={t('Sales This Month')} taxLabel={t('(incl. PPN)')} className="financial-sales-widget" period={period} fetching={query.isFetching} refresh={refresh} note={t('Net sales include PPN and deduct all applied credit notes in the credit note period, including refunds, goodwill discounts and price adjustments. Paid and unpaid show the current settlement of invoices issued in the selected period; returns are not payments. Outstanding covers all invoice dates.')}>
        {query.isLoading || query.isError || !d ? <QueryState loading={query.isLoading} error={query.isError} retry={refresh} /> : <div className="financial-sales-grid">
            <div>
                <div className="financial-total"><h4>{t('Net Sales')}</h4><strong>{money(d.sales)}</strong></div>
                <div className="financial-pair financial-muted"><span>{t('Gross Invoices')}</span><span>{t('Credit Notes')}</span></div>
                <div className="financial-pair financial-values"><span>{money(d.grossSales)}</span><span>{money(d.returns)}</span></div>
                <div className="financial-pair financial-muted"><span>{t('Paid Invoices')}</span><span>{t('Unpaid Invoices')}</span></div>
                <div className="financial-pair financial-values"><span style={{ color: '#3cbd00' }}>{money(d.paid)}</span><span style={{ color: '#ed9200' }}>{money(d.unpaid)}</span></div>
                <SplitBar left={d.paid} right={d.unpaid} leftColor="#3cbd00" rightColor="#ffbe32" label={`${t('Paid Invoices')} ${money(d.paid)}; ${t('Unpaid Invoices')} ${money(d.unpaid)}`} />
            </div>
            <div>
                <div className="financial-asof">{t('Today')} · {periodLabel(period.today, period.today, language).split(' – ')[0]}</div>
                <div className="financial-total"><h4>{t('Outstanding')}</h4><strong>{money(d.outstanding)}</strong></div>
                <div className="financial-pair financial-muted"><span>{t('Not overdue yet')}</span><span>{t('Overdue')}</span></div>
                <div className="financial-pair financial-values"><span style={{ color: '#ed9200' }}>{money(d.current)}</span><span style={{ color: '#f04424' }}>{money(d.overdue)}</span></div>
                <SplitBar left={d.current} right={d.overdue} leftColor="#ffbe32" rightColor="#ff5130" label={`${t('Not overdue yet')} ${money(d.current)}; ${t('Overdue')} ${money(d.overdue)}`} />
            </div>
        </div>}
    </Widget>;
}

export function YearlyProfitLossWidget() {
    const period = usePeriod('year');
    const { language, t } = useT();
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
    const metrics = [{ key: 'income', label: 'Income' }, { key: 'cogs', label: 'COGS Value' }, { key: 'expenditure', label: 'Expenditure' }] as const;
    const ring = d ? profitRing(d.current) : { segments: [], gradient: '' };
    const colorOf = (key: string) => ring.segments.find(segment => segment.key === key)?.color;
    const change = d ? percentageChange(d.current.profit, d.previous.profit) : null;
    return <Widget title={t('Profit/Loss This Year')} period={period} fetching={query.isFetching} refresh={refresh} note={t('Income excludes PPN. Income, COGS, and expenditure come from posted journals. The ring shows how income was used: COGS, expenditure, and the profit left over. Percentages compare against the same period last year.')}>
        {query.isLoading || query.isError || !d ? <QueryState loading={query.isLoading} error={query.isError} retry={refresh} /> : <div className="financial-profit-layout">
            <div className="financial-profit-chart">
                <div className="financial-donut" role="img" aria-label={ring.segments.map(segment => `${t(RING_LABELS[segment.key])} ${money(segment.value)}`).join(', ')} style={{ background: ring.gradient || '#efefef' }}>
                    <div className={change !== null && change < 0 ? 'financial-negative' : 'financial-positive'}>{change === null ? <span className="financial-no-comparison">{t('No prior data')}</span> : <>{change < 0 ? <ArrowDownCircle size={17} /> : <ArrowUpCircle size={17} />} {Math.abs(change).toFixed(0)}%</>}</div>
                </div>
                <p>{t('Profit compared to')} {periodLabel(compareFrom, compareTo, language)}</p>
            </div>
            <div className="financial-profit-detail">
                <div className="financial-metrics">{metrics.map(m => {
                    const delta = percentageChange(d.current[m.key], d.previous[m.key]);
                    const favorable = delta === null || (m.key === 'income' ? delta >= 0 : delta <= 0);
                    const color = colorOf(m.key);
                    return <div className="financial-metric" key={m.key}><span className={`financial-dot ${color ? '' : 'financial-dot-empty'}`} style={color ? { backgroundColor: color } : undefined} /><span>{t(m.label)}</span><strong>{money(d.current[m.key])}</strong><span className={`financial-pill ${favorable ? '' : 'financial-pill-negative'}`} title={t('Change compared to the same period last year')}>{delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`}</span></div>;
                })}</div>
                <div className="financial-profit-total"><strong className="financial-profit-label">{colorOf('profit') && <span className="financial-dot" style={{ backgroundColor: colorOf('profit') }} />}{t(d.current.profit < 0 ? 'Loss' : 'Profit')}</strong><strong className={d.current.profit < 0 ? 'financial-negative' : 'financial-positive'}>{money(d.current.profit)}</strong></div>
                <div className="financial-updated"><Clock size={14} /> {t('Updated at')} {new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(query.dataUpdatedAt)}</div>
            </div>
        </div>}
    </Widget>;
}

export function CustomerSalesWidget() {
    const period = usePeriod('month');
    const { t } = useT();
    const orgId = useAuthStore(s => s.org?.id);
    const query = useQuery({ queryKey: ['dashboard-customer-sales', orgId, period.dateFrom, period.dateTo], queryFn: () => api.get<CustomerSales>('/api/v1/reports/dashboard', { type: 'customers', dateFrom: period.dateFrom, dateTo: period.dateTo }) });
    const refresh = () => { void query.refetch(); };
    const d = query.data;
    return <Widget title={t('Customer Sales')} taxLabel={t('(incl. PPN)')} period={period} fetching={query.isFetching} refresh={refresh} note={t('Customers ranked by net sales including PPN. All applied credit notes, including refunds, goodwill discounts and price adjustments, reduce sales in the credit note period. Percentages use net sales across all customers.')}>
        {query.isLoading || query.isError || !d ? <QueryState loading={query.isLoading} error={query.isError} retry={refresh} /> : d.rows.length === 0 ? <div className="financial-state">{t('No customer sales in this period.')}</div> : <ol className="financial-customers">{d.rows.slice(0, 10).map((customer, i) => {
            const pct = d.grandTotal > 0 ? customer.total / d.grandTotal * 100 : null;
            return <li key={customer.customerId}><span className={`financial-medal financial-medal-${i + 1}`}>{i + 1}</span><div className="financial-customer-detail"><div className="financial-customer-line"><span>{customer.customerName}</span><strong>{money(customer.total)}</strong><span className="financial-pill">{pct === null ? '—' : `${pct.toFixed(0)}%`}</span></div><div className="financial-customer-bar" role="img" aria-label={`${customer.customerName}: ${pct === null ? t('Share unavailable') : `${pct.toFixed(1)}% ${t('of sales')}`}`}><span style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} /></div></div></li>;
        })}</ol>}
    </Widget>;
}

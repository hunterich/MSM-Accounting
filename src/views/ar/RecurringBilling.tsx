import React from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/Layout/PageHeader';
import RecurringInvoices from './RecurringInvoices';
import SubscriptionsPage from './Subscriptions';

type BillingTab = 'templates' | 'subscriptions' | 'plans';

const TABS: Array<{ id: BillingTab; label: string }> = [
    { id: 'templates', label: 'Invoice Templates' },
    { id: 'subscriptions', label: 'Subscriptions' },
    { id: 'plans', label: 'Plans' },
];

/**
 * Single home for everything that bills customers automatically:
 * recurring invoice templates, plan-based subscriptions, and the plans
 * themselves. Replaces the separate /ar/recurring and /ar/subscriptions
 * sidebar entries; the old subscriptions URL redirects here.
 */
const RecurringBilling = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const rawTab = searchParams.get('tab') as BillingTab | null;
    const activeTab: BillingTab = TABS.some((t) => t.id === rawTab) ? (rawTab as BillingTab) : 'templates';

    const setTab = (tab: BillingTab) => {
        setSearchParams(tab === 'templates' ? {} : { tab }, { replace: true });
    };

    return (
        <div className="container ar-module container-full-width">
            <PageHeader
                title="Recurring Billing"
                subtitle="Invoice templates, subscriptions, and plans that bill customers automatically."
            />

            <div className="invoice-tabs module-tabs module-tabs-spaced">
                {TABS.map((tabDef) => (
                    <button
                        key={tabDef.id}
                        className={`invoice-tab ${activeTab === tabDef.id ? 'active' : ''}`}
                        onClick={() => setTab(tabDef.id)}
                    >
                        {tabDef.label}
                    </button>
                ))}
            </div>

            {activeTab === 'templates' && <RecurringInvoices />}
            {activeTab !== 'templates' && <SubscriptionsPage tab={activeTab} />}
        </div>
    );
};

export default RecurringBilling;

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error This project does not ship @types/react-dom.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const mutation = { mutateAsync: vi.fn(), isPending: false };
vi.mock('../../../hooks/useBanking', () => ({
    useBankAccounts: () => ({
        data: [{ id: 'bca', name: 'BCA Operational', code: 'BCA', bankName: 'BCA', accountNumber: '4589', balance: 5_000_000, currency: 'IDR', isActive: true, transactionCount: 0 }],
        isLoading: false,
    }),
    useBankTransactions: () => ({ data: { data: [] } }),
    useCreateBankAccount: () => mutation,
    useCreateBankTransaction: () => mutation,
}));
vi.mock('../../../hooks/useGL', () => ({
    useChartOfAccounts: () => ({
        data: [
            { id: 'exp', code: '6100', name: 'Utilities', type: 'Expense', isActive: true, isPostable: true },
            { id: 'rev', code: '4100', name: 'Sales', type: 'Revenue', isActive: true, isPostable: true },
        ],
        isLoading: false,
    }),
}));
vi.mock('../../../components/UI/ClosedPeriodBanner', () => ({ default: () => null }));

import BankingActionForm from '../BankingActionForm';

const render = (action: 'expense' | 'income' | 'transfer' | 'account') =>
    renderToStaticMarkup(
        <MemoryRouter>
            <BankingActionForm action={action} workspaceTabId="tab-1" />
        </MemoryRouter>,
    );

describe('BankingActionForm on the shared document layout', () => {
    it('renders Payment with the document action bar, summary rail and account context', () => {
        const html = render('expense');
        expect(html).toContain('← Cash &amp; Bank');
        expect(html).toContain('>Payment</h1>');
        expect(html).toContain('Paid from');
        expect(html).toContain('Expense account');
        expect(html).toContain('Summary');
        expect(html).toContain('Terbilang');
        expect(html).toContain('lg:grid-cols-[minmax(0,1fr)_320px]');
    });

    it('renders Receive and Bank Transfer with their own fields', () => {
        const receive = render('income');
        expect(receive).toContain('>Receive</h1>');
        expect(receive).toContain('Deposit to');
        expect(receive).toContain('Revenue account');

        const transfer = render('transfer');
        expect(transfer).toContain('>Bank Transfer</h1>');
        expect(transfer).toContain('From account');
        expect(transfer).toContain('To account');
        expect(transfer).toContain('Transfer amount');
        expect(transfer).not.toContain('Tax / VAT');
    });

    it('renders Add Bank Account without transaction-only fields', () => {
        const html = render('account');
        expect(html).toContain('>Add Bank Account</h1>');
        expect(html).toContain('Account nickname');
        expect(html).toContain('Opening balance');
        expect(html).not.toContain('Terbilang');
    });
});

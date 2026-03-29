import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { bankAccounts as seed } from '../data/mockData';

type E = { id: string } & Record<string, unknown>;

interface BankingStore {
    bankAccounts:       E[];
    transactions:       E[];
    isLoading:          boolean;
    error:              string | null;
    addBankAccount:     (account: E) => Promise<void>;
    updateBankAccount:  (id: string, updates: Partial<E>) => Promise<void>;
    deleteBankAccount:  (id: string) => Promise<void>;
    getBankAccountById: (id: string) => E | undefined;
    addTransaction:     (txn: E) => Promise<void>;
    updateTransaction:  (id: string, updates: Partial<E>) => Promise<void>;
    deleteTransaction:  (id: string) => Promise<void>;
    getTransactionById: (id: string) => E | undefined;
}

const INITIAL_TRANSACTIONS = [
    { id: 'TXN-001', date: '2026-02-18', description: 'Payment received — Acme Corp INV-1001', amount: 1200000, type: 'income', accountId: 'BANK-001', status: 'Matched' },
    { id: 'TXN-002', date: '2026-02-17', description: 'AWS Monthly Subscription', amount: -120000, type: 'expense', accountId: 'BANK-001', status: 'Matched' },
    { id: 'TXN-003', date: '2026-02-16', description: 'Office Supplies — Ace Hardware', amount: -450000, type: 'expense', accountId: 'BANK-001', status: 'Unmatched' },
    { id: 'TXN-004', date: '2026-02-14', description: 'Transfer from BCA to Petty Cash', amount: -500000, type: 'transfer', accountId: 'BANK-001', status: 'Matched' },
    { id: 'TXN-005', date: '2026-02-12', description: 'Client Retainer — Globex Inc', amount: 3000000, type: 'income', accountId: 'BANK-002', status: 'Unmatched' },
    { id: 'TXN-006', date: '2026-02-10', description: 'Internet Bill — Telkom', amount: -350000, type: 'expense', accountId: 'BANK-002', status: 'Unmatched' },
];

export const useBankingStore = create<BankingStore>()(
    persist(
        (set, get) => ({
            bankAccounts: seed,
            transactions: INITIAL_TRANSACTIONS,
            isLoading: false,
            error: null,

            // Bank Accounts
            addBankAccount: async (account) => {
                set((state) => ({ bankAccounts: [...state.bankAccounts, account] }));
            },
            updateBankAccount: async (id, updates) => {
                set((state) => ({
                    bankAccounts: state.bankAccounts.map((a) =>
                        a.id === id ? { ...a, ...updates } : a
                    ),
                }));
            },
            deleteBankAccount: async (id) => {
                set((state) => ({
                    bankAccounts: state.bankAccounts.filter((a) => a.id !== id),
                }));
            },
            getBankAccountById: (id) => get().bankAccounts.find((a) => a.id === id),

            // Transactions
            addTransaction: async (txn) => {
                set((state) => ({ transactions: [...state.transactions, txn] }));
            },
            updateTransaction: async (id, updates) => {
                set((state) => ({
                    transactions: state.transactions.map((t) =>
                        t.id === id ? { ...t, ...updates } : t
                    ),
                }));
            },
            deleteTransaction: async (id) => {
                set((state) => ({
                    transactions: state.transactions.filter((t) => t.id !== id),
                }));
            },
            getTransactionById: (id) => get().transactions.find((t) => t.id === id),
        }),
        {
            name: 'msm-banking',
            version: 2,
        }
    )
);

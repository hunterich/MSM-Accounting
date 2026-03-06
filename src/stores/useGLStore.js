import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
    chartOfAccounts as coaSeed,
    accountBalancesById as balancesSeed,
    journalEntries as journalSeed,
} from '../data/mockData';

export const useGLStore = create(
    persist(
        (set, get) => ({
            chartOfAccounts: coaSeed,
            accountBalancesById: balancesSeed,
            journalEntries: journalSeed,
            isLoading: false,
            error: null,

            // Chart of Accounts
            addAccount: async (account) => {
                set((state) => ({
                    chartOfAccounts: [...state.chartOfAccounts, account],
                }));
            },
            updateAccount: async (id, updates) => {
                set((state) => ({
                    chartOfAccounts: state.chartOfAccounts.map((a) =>
                        a.id === id ? { ...a, ...updates } : a
                    ),
                }));
            },
            deleteAccount: async (id) => {
                set((state) => ({
                    chartOfAccounts: state.chartOfAccounts.filter((a) => a.id !== id),
                }));
            },

            // Account Balances
            setAccountBalance: async (accountId, balance) => {
                set((state) => ({
                    accountBalancesById: {
                        ...state.accountBalancesById,
                        [accountId]: balance,
                    },
                }));
            },

            // Journal Entries
            addJournalEntry: async (entry) => {
                set((state) => ({
                    journalEntries: [...state.journalEntries, entry],
                }));
            },
            updateJournalEntry: async (entryNo, updates) => {
                set((state) => ({
                    journalEntries: state.journalEntries.map((e) =>
                        e.entryNo === entryNo ? { ...e, ...updates } : e
                    ),
                }));
            },
            deleteJournalEntry: async (entryNo) => {
                set((state) => ({
                    journalEntries: state.journalEntries.filter((e) => e.entryNo !== entryNo),
                }));
            },

            getAccountById: (id) => get().chartOfAccounts.find((a) => a.id === id),
        }),
        {
            name: 'msm-gl',
            version: 1,
        }
    )
);

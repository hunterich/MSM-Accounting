/**
 * Regression: bank INCOME, TRANSFER, and opening balances must post to the GL
 * (and move cached balances), not just EXPENSE.
 *
 * Finding 3 — `postBankTransactionIfNeeded` only posted EXPENSE; INCOME moved
 * the cached balance with no GL entry, TRANSFER did nothing (delta = 0), and a
 * bank account's openingBalance set the cached balance with no opening journal.
 * The fix posts a balanced entry for each flow and moves every affected bank
 * account's cached balance in lockstep with the ledger.
 *
 * Drives the real bank-transactions / bank-accounts routes against the test DB.
 * Run with:  npm run test:int -- bank-transaction-posting
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as postBankTransaction } from '@/src/app/api/v1/bank-transactions/route';
import { POST as postBankAccount } from '@/src/app/api/v1/bank-accounts/route';
import {
  prisma,
  createTestOrg,
  assertTrialBalanced,
  accountBalance,
  journalEntryCount,
  cleanupOrg,
  disconnect,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = '2026-03-15';

function makeTxnPost(orgId: string, body: unknown): NextRequest {
  return new NextRequest(new URL('/api/v1/bank-transactions', 'http://localhost'), {
    method: 'POST',
    headers: new Headers({
      'x-org-id': orgId,
      'x-user-id': `bank-poster-${randomUUID()}`,
      'x-role-type': 'ADMIN',
      'content-type': 'application/json',
    }),
    body: JSON.stringify(body),
  });
}

function makeAccountPost(orgId: string, body: unknown): NextRequest {
  return new NextRequest(new URL('/api/v1/bank-accounts', 'http://localhost'), {
    method: 'POST',
    headers: new Headers({
      'x-org-id': orgId,
      'x-user-id': `bank-acct-${randomUUID()}`,
      'x-role-type': 'ADMIN',
      'content-type': 'application/json',
    }),
    body: JSON.stringify(body),
  });
}

async function makeBankAccount(orgId: string, name: string, code?: string) {
  const acct = await prisma.bankAccount.create({
    data: { organizationId: orgId, name, code: code ?? null, currentBalance: 0, openingBalance: 0 },
    select: { id: true },
  });
  return acct.id;
}

async function currentBalance(id: string): Promise<number> {
  const a = await prisma.bankAccount.findUnique({ where: { id }, select: { currentBalance: true } });
  return Number(a?.currentBalance ?? 0);
}

describe('bank INCOME posts to the GL', () => {
  it('posts Dr Bank / Cr Income and moves the cached balance up', async () => {
    const org = await createTestOrg();
    const bankId = await makeBankAccount(org.orgId, 'Income Bank');

    const res = await postBankTransaction(
      makeTxnPost(org.orgId, {
        bankAccountId: bankId, type: 'INCOME', amount: 3000, date: DATE,
        description: 'Customer cash sale', incomeAccountId: org.accounts.salesRevenue,
      }),
    );
    expect(res.status).toBe(201);

    expect(await journalEntryCount(org.orgId)).toBe(1);
    expect(await accountBalance(org.orgId, org.accounts.bankAsset)).toBeCloseTo(3000, 2);
    expect(await accountBalance(org.orgId, org.accounts.salesRevenue)).toBeCloseTo(-3000, 2); // credit
    expect(await currentBalance(bankId)).toBeCloseTo(3000, 2);
    await assertTrialBalanced(org.orgId, 'bank income');

    await cleanupOrg(org.orgId);
  });
});

describe('bank TRANSFER posts to the GL and moves both balances', () => {
  it('posts Dr destination / Cr source and moves both cached balances', async () => {
    const org = await createTestOrg();
    // Two distinct bank GL accounts so the transfer legs land on different accounts.
    const glOperating = (
      await prisma.account.create({
        data: { organizationId: org.orgId, code: '1111', name: 'Cash Operating', type: 'ASSET', normalSide: 'DEBIT', isActive: true, isPostable: true },
        select: { id: true },
      })
    ).id;
    const glSavings = (
      await prisma.account.create({
        data: { organizationId: org.orgId, code: '1112', name: 'Cash Savings', type: 'ASSET', normalSide: 'DEBIT', isActive: true, isPostable: true },
        select: { id: true },
      })
    ).id;
    const srcBank = await makeBankAccount(org.orgId, 'Operating', '1111');
    const destBank = await makeBankAccount(org.orgId, 'Savings', '1112');

    const res = await postBankTransaction(
      makeTxnPost(org.orgId, {
        bankAccountId: srcBank, toBankAccountId: destBank, type: 'TRANSFER', amount: 5000, date: DATE,
        description: 'Move to savings',
      }),
    );
    expect(res.status).toBe(201);

    expect(await journalEntryCount(org.orgId)).toBe(1);
    expect(await accountBalance(org.orgId, glSavings)).toBeCloseTo(5000, 2); // debited (in)
    expect(await accountBalance(org.orgId, glOperating)).toBeCloseTo(-5000, 2); // credited (out)
    expect(await currentBalance(srcBank)).toBeCloseTo(-5000, 2);
    expect(await currentBalance(destBank)).toBeCloseTo(5000, 2);
    await assertTrialBalanced(org.orgId, 'bank transfer');

    await cleanupOrg(org.orgId);
  });
});

describe('bank account opening balance posts an opening journal', () => {
  it('posts Dr Bank / Cr Opening Balance Equity for a non-zero opening balance', async () => {
    const org = await createTestOrg();

    const res = await postBankAccount(
      makeAccountPost(org.orgId, { name: 'Opening Bank', openingBalance: 50000 }),
    );
    expect(res.status).toBe(201);
    const account = await res.json();

    expect(await journalEntryCount(org.orgId)).toBe(1);
    expect(await accountBalance(org.orgId, org.accounts.bankAsset)).toBeCloseTo(50000, 2);
    expect(await accountBalance(org.orgId, org.accounts.openingBalanceEquity)).toBeCloseTo(-50000, 2);
    expect(await currentBalance(account.id)).toBeCloseTo(50000, 2);
    await assertTrialBalanced(org.orgId, 'bank opening balance');

    await cleanupOrg(org.orgId);
  });

  it('posts no journal for a zero opening balance', async () => {
    const org = await createTestOrg();
    const res = await postBankAccount(makeAccountPost(org.orgId, { name: 'Empty Bank', openingBalance: 0 }));
    expect(res.status).toBe(201);
    expect(await journalEntryCount(org.orgId)).toBe(0);

    await cleanupOrg(org.orgId);
  });
});

describe('bank EXPENSE still posts to the GL (regression)', () => {
  it('posts Dr Expense / Cr Bank and moves the cached balance down', async () => {
    const org = await createTestOrg();
    const bankId = await makeBankAccount(org.orgId, 'Expense Bank');

    const res = await postBankTransaction(
      makeTxnPost(org.orgId, {
        bankAccountId: bankId, type: 'EXPENSE', amount: 2000, date: DATE,
        description: 'Office supplies', expenseAccountId: org.accounts.cogsExpense,
      }),
    );
    expect(res.status).toBe(201);

    expect(await journalEntryCount(org.orgId)).toBe(1);
    expect(await accountBalance(org.orgId, org.accounts.cogsExpense)).toBeCloseTo(2000, 2);
    expect(await accountBalance(org.orgId, org.accounts.bankAsset)).toBeCloseTo(-2000, 2);
    expect(await currentBalance(bankId)).toBeCloseTo(-2000, 2);
    await assertTrialBalanced(org.orgId, 'bank expense');

    await cleanupOrg(org.orgId);
  });
});

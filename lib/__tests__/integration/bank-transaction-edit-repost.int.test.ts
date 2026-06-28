/**
 * Regression: editing a posted bank transaction must reverse its original journal
 * entry and re-post from the edited data, keeping the GL balanced and every
 * affected bank account's cached `currentBalance` in lockstep with the ledger.
 *
 * The edit path (`PUT /bank-transactions/[id]`) used to adjust the cached balance
 * with its own delta math and never touch the GL — so editing an INCOME left a
 * stale journal at the old amount, and editing a TRANSFER (delta = 0) desynced
 * the destination account entirely. The fix mirrors the create route: storno the
 * old entry, re-post via `postBankTransactionIfNeeded`, and apply the returned
 * `moves` to the cached balances.
 *
 * Drives the real bank-transactions routes against the test DB. Run with:
 *   npm run test:int -- bank-transaction-edit-repost
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as postBankTransaction } from '@/src/app/api/v1/bank-transactions/route';
import { PUT as putBankTransaction } from '@/src/app/api/v1/bank-transactions/[id]/route';
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

function makeTxnPut(orgId: string, id: string, body: unknown): NextRequest {
  return new NextRequest(new URL(`/api/v1/bank-transactions/${id}`, 'http://localhost'), {
    method: 'PUT',
    headers: new Headers({
      'x-org-id': orgId,
      'x-user-id': `bank-editor-${randomUUID()}`,
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

describe('editing a posted bank INCOME re-posts the GL at the new amount', () => {
  it('storno the old entry and re-posts, leaving GL + cached balance at the new amount', async () => {
    const org = await createTestOrg();
    const bankId = await makeBankAccount(org.orgId, 'Income Bank');

    const created = await postBankTransaction(
      makeTxnPost(org.orgId, {
        bankAccountId: bankId, type: 'INCOME', amount: 3000, date: DATE,
        description: 'Customer cash sale', incomeAccountId: org.accounts.salesRevenue,
      }),
    );
    expect(created.status).toBe(201);
    const txn = await created.json();

    // Posted once; cached balance and GL both at 3000.
    expect(await journalEntryCount(org.orgId)).toBe(1);
    expect(await currentBalance(bankId)).toBeCloseTo(3000, 2);

    // Edit the amount up to 4000.
    const edited = await putBankTransaction(
      makeTxnPut(org.orgId, txn.id, { amount: 4000 }),
      { params: Promise.resolve({ id: txn.id }) },
    );
    expect(edited.status).toBe(200);

    // Original post (1) + storno reversal (2) + re-post (3) = three entries.
    expect(await journalEntryCount(org.orgId)).toBe(3);
    // Net of original(3000) − reversal(3000) + re-post(4000) = 4000 exactly.
    expect(await accountBalance(org.orgId, org.accounts.bankAsset)).toBeCloseTo(4000, 2);
    expect(await accountBalance(org.orgId, org.accounts.salesRevenue)).toBeCloseTo(-4000, 2); // credit
    // Cached balance moves in lockstep with the ledger.
    expect(await currentBalance(bankId)).toBeCloseTo(4000, 2);
    await assertTrialBalanced(org.orgId, 'after income edit');

    await cleanupOrg(org.orgId);
  });
});

describe('editing a posted bank TRANSFER re-posts the GL and moves both balances', () => {
  it('storno the old transfer and re-posts, keeping both cached balances in lockstep', async () => {
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

    const created = await postBankTransaction(
      makeTxnPost(org.orgId, {
        bankAccountId: srcBank, toBankAccountId: destBank, type: 'TRANSFER', amount: 5000, date: DATE,
        description: 'Move to savings',
      }),
    );
    expect(created.status).toBe(201);
    const txn = await created.json();

    expect(await journalEntryCount(org.orgId)).toBe(1);
    expect(await currentBalance(srcBank)).toBeCloseTo(-5000, 2);
    expect(await currentBalance(destBank)).toBeCloseTo(5000, 2);

    // Edit the transfer amount up to 8000.
    const edited = await putBankTransaction(
      makeTxnPut(org.orgId, txn.id, { amount: 8000 }),
      { params: Promise.resolve({ id: txn.id }) },
    );
    expect(edited.status).toBe(200);

    // Original post (1) + storno reversal (2) + re-post (3) = three entries.
    expect(await journalEntryCount(org.orgId)).toBe(3);
    // Net of original(5000) − reversal(5000) + re-post(8000) = 8000 on each leg.
    expect(await accountBalance(org.orgId, glSavings)).toBeCloseTo(8000, 2); // debited (in)
    expect(await accountBalance(org.orgId, glOperating)).toBeCloseTo(-8000, 2); // credited (out)
    // Both cached balances move in lockstep with the ledger (the old bug left dest stale).
    expect(await currentBalance(srcBank)).toBeCloseTo(-8000, 2);
    expect(await currentBalance(destBank)).toBeCloseTo(8000, 2);
    await assertTrialBalanced(org.orgId, 'after transfer edit');

    await cleanupOrg(org.orgId);
  });
});

import { afterAll, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { calculateBankAmounts } from '../../bank-amounts';
import { postJournalEntry } from '../../journal-posting';
import { POST as createTransaction } from '@/src/app/api/v1/bank-transactions/route';
import { PUT as editTransaction } from '@/src/app/api/v1/bank-transactions/[id]/route';
import { POST as autoMatch } from '@/src/app/api/v1/bank-statements/match/route';
import { PUT as editStatementLine } from '@/src/app/api/v1/bank-statements/[lineId]/route';
import { GET as bankReport } from '@/src/app/api/v1/reports/banking/route';
import { accountBalance, assertTrialBalanced, cleanupOrg, createTestOrg, disconnect, prisma } from './harness';

afterAll(disconnect);
const day = '2026-06-01';
const date = new Date(day);

function request(orgId: string, path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown) {
  return new NextRequest(`http://localhost/api/v1/${path}`, {
    method,
    headers: { 'x-org-id': orgId, 'x-user-id': 'bank-rounding-test', 'x-role-type': 'ADMIN', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createStatement(orgId: string, bankAccountId: string, amount: string) {
  return prisma.bankStatement.create({
    data: { organizationId: orgId, bankAccountId, filename: 'statement.csv',
      lines: { create: [{ date, amount, description: 'Bank statement movement' }] } },
    include: { lines: true },
  });
}

const automatic = (orgId: string, statementId: string) =>
  autoMatch(request(orgId, `bank-statements/match?statementId=${statementId}`, 'POST'));
const manual = (orgId: string, lineId: string, transactionId: string) =>
  editStatementLine(request(orgId, `bank-statements/${lineId}`, 'PUT', { action: 'match', matchedTxId: transactionId }),
    { params: Promise.resolve({ lineId }) });
const balance = async (id: string) => (await prisma.bankAccount.findUniqueOrThrow({ where: { id } })).currentBalance.toFixed(2);

async function clean(orgId: string) {
  await prisma.bankStatement.deleteMany({ where: { organizationId: orgId } });
  await prisma.bankTransaction.deleteMany({ where: { organizationId: orgId } });
  await prisma.journalEntry.deleteMany({ where: { organizationId: orgId } });
  await cleanupOrg(orgId);
}

it('uses Rp40.52 for the PPN preview, saved cash, GL, report and signed statement match', async () => {
  const org = await createTestOrg();
  try {
    const bank = await prisma.bankAccount.create({ data: { organizationId: org.orgId, name: 'Cash & Bank', code: '1110' } });
    const input = { amount: '36.50', taxRate: '11.00', taxType: 'PPN', type: 'EXPENSE' };
    const preview = calculateBankAmounts(input);
    expect(preview.tax.toFixed(2)).toBe('4.02');
    expect(preview.cash.toFixed(2)).toBe('40.52');
    const created = await createTransaction(request(org.orgId, 'bank-transactions', 'POST', {
      ...input, bankAccountId: bank.id, date: day, description: 'PPN bank expense', expenseAccountId: org.accounts.cogsExpense,
    }));
    expect(created.status, await created.clone().text()).toBe(201);
    const result = await created.json();
    expect(result.cashAmount).toBe('40.52');
    const saved = await prisma.bankTransaction.findUniqueOrThrow({
      where: { id: result.id }, include: { journalEntry: { include: { lines: true } } },
    });
    expect(saved.amount.toFixed(2)).toBe('36.50');
    expect(saved.cashAmount?.toFixed(2)).toBe('40.52');
    expect(saved.journalEntry?.lines.find(line => line.accountId === org.accounts.apTax)?.debit.toFixed(2)).toBe('4.02');
    expect(saved.journalEntry?.lines.find(line => line.accountId === org.accounts.bankAsset)?.credit.toFixed(2)).toBe('40.52');
    expect(await balance(bank.id)).toBe('-40.52');
    const report = await bankReport(request(org.orgId, `reports/banking?type=bank-payment&bankAccountId=${bank.id}`, 'GET'));
    expect(await report.json()).toMatchObject({ rows: [{ bankTransactionId: saved.id, amount: 40.52 }], summary: { totalPaid: 40.52 } });

    const wrong = await createStatement(org.orgId, bank.id, '-40.51');
    const wrongSign = await createStatement(org.orgId, bank.id, '40.52');
    expect(await (await automatic(org.orgId, wrong.id)).json()).toEqual({ matched: 0, unmatched: 1 });
    expect(await (await automatic(org.orgId, wrongSign.id)).json()).toEqual({ matched: 0, unmatched: 1 });
    expect((await manual(org.orgId, wrong.lines[0].id, saved.id)).status).toBe(422);
    const correct = await createStatement(org.orgId, bank.id, '-40.52');
    expect(await (await automatic(org.orgId, correct.id)).json()).toEqual({ matched: 1, unmatched: 0 });
    expect((await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: correct.lines[0].id } })).matchedTxId).toBe(saved.id);
    const edit = await editTransaction(request(org.orgId, `bank-transactions/${saved.id}`, 'PUT', { amount: '28.50' }), { params: Promise.resolve({ id: saved.id }) });
    expect(edit.status).toBe(409);
    await assertTrialBalanced(org.orgId, 'bank expense rounding');
  } finally { await clean(org.orgId); }
});

it('keeps a Rp6.66 statement open for a Rp6.67 transfer and matches each exact signed leg', async () => {
  const org = await createTestOrg();
  try {
    const source = await prisma.bankAccount.create({ data: { organizationId: org.orgId, name: 'Cash & Bank', code: '1110' } });
    const savingsGl = await prisma.account.create({ data: { organizationId: org.orgId, code: '1112', name: 'Savings', type: 'ASSET', normalSide: 'DEBIT' } });
    const target = await prisma.bankAccount.create({ data: { organizationId: org.orgId, name: 'Savings', code: savingsGl.code } });
    const created = await createTransaction(request(org.orgId, 'bank-transactions', 'POST', {
      bankAccountId: source.id, toBankAccountId: target.id, amount: '6.67', type: 'TRANSFER', date: day, description: 'Transfer',
    }));
    expect(created.status, await created.clone().text()).toBe(201);
    const result = await created.json();
    expect(result.cashAmount).toBe('6.67');
    expect(await balance(source.id)).toBe('-6.67');
    expect(await balance(target.id)).toBe('6.67');
    expect(await accountBalance(org.orgId, savingsGl.id)).toBe(6.67);
    const near = await createStatement(org.orgId, target.id, '6.66');
    expect(await (await automatic(org.orgId, near.id)).json()).toEqual({ matched: 0, unmatched: 1 });
    expect((await manual(org.orgId, near.lines[0].id, result.id)).status).toBe(422);
    const inbound = await createStatement(org.orgId, target.id, '6.67');
    const outbound = await createStatement(org.orgId, source.id, '-6.67');
    expect(await (await automatic(org.orgId, inbound.id)).json()).toEqual({ matched: 1, unmatched: 0 });
    expect((await manual(org.orgId, outbound.lines[0].id, result.id)).status).toBe(200);
    await assertTrialBalanced(org.orgId, 'transfer rounding');
  } finally { await clean(org.orgId); }
});

it('uses the original Rp40.51 cash movement when reconciling and editing a legacy transaction', async () => {
  const org = await createTestOrg();
  try {
    const bank = await prisma.bankAccount.create({ data: {
      organizationId: org.orgId, name: 'Cash & Bank', code: '1110', currentBalance: '-40.51',
    } });
    const journal = await prisma.$transaction(tx => postJournalEntry(tx, {
      organizationId: org.orgId, date, memo: 'Legacy bank expense',
      lines: [
        { accountId: org.accounts.cogsExpense, description: 'Expense', debit: '36.50', credit: 0 },
        { accountId: org.accounts.apTax, description: 'Input PPN', debit: '4.01', credit: 0 },
        { accountId: org.accounts.bankAsset, description: 'Cash paid', debit: 0, credit: '40.51' },
      ],
    }));
    const legacy = await prisma.bankTransaction.create({ data: {
      organizationId: org.orgId, bankAccountId: bank.id, amount: '36.50', taxRate: 11, taxType: 'PPN',
      description: 'Legacy expense', date, type: 'EXPENSE', journalEntryId: journal.id,
    } });
    const statement = await createStatement(org.orgId, bank.id, '-40.51');
    expect(await (await automatic(org.orgId, statement.id)).json()).toEqual({ matched: 1, unmatched: 0 });
    const lineId = statement.lines[0].id;
    expect((await editStatementLine(request(org.orgId, `bank-statements/${lineId}`, 'PUT', { action: 'unmatch' }),
      { params: Promise.resolve({ lineId }) })).status).toBe(200);
    const repost = await editTransaction(request(org.orgId, `bank-transactions/${legacy.id}`, 'PUT', { amount: '36.50' }),
      { params: Promise.resolve({ id: legacy.id }) });
    expect(repost.status, await repost.clone().text()).toBe(200);
    expect((await repost.json()).cashAmount).toBe('40.52');
    expect(await balance(bank.id)).toBe('-40.52');
    expect(await accountBalance(org.orgId, org.accounts.bankAsset)).toBe(-40.52);
    await assertTrialBalanced(org.orgId, 'legacy bank expense edit');
  } finally { await clean(org.orgId); }
});

import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as autoMatch } from '@/src/app/api/v1/bank-statements/match/route';
import { PUT as updateLine } from '@/src/app/api/v1/bank-statements/[lineId]/route';
import { PUT as editTransaction } from '@/src/app/api/v1/bank-transactions/[id]/route';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';

afterAll(disconnect);
const date = new Date('2026-06-01T00:00:00Z');
const headers = (orgId: string) => ({ 'x-org-id': orgId, 'x-user-id': 'test', 'x-role-type': 'ADMIN', 'content-type': 'application/json' });
const match = (orgId: string, id: string) => autoMatch(new NextRequest(`http://localhost/api/v1/bank-statements/match?statementId=${id}`, { method: 'POST', headers: headers(orgId) }));
const manual = (orgId: string, lineId: string, body: unknown) => updateLine(new NextRequest(`http://localhost/api/v1/bank-statements/${lineId}`, { method: 'PUT', headers: headers(orgId), body: JSON.stringify(body) }), { params: Promise.resolve({ lineId }) });

describe('transfer bank statement matching', () => {
  it('matches each account independently, preserves the other side on unmatch, and prevents replay or wrong sign', async () => {
    const org = await createTestOrg();
    try {
      const source = await prisma.bankAccount.create({ data: { organizationId: org.orgId, name: 'Wallet' } });
      const destination = await prisma.bankAccount.create({ data: { organizationId: org.orgId, name: 'Bank' } });
      const transfer = await prisma.bankTransaction.create({ data: { organizationId: org.orgId, bankAccountId: source.id, toBankAccountId: destination.id, type: 'TRANSFER', amount: 100, date, description: 'Payout' } });
      const statement = async (bankAccountId: string, amount: number) => prisma.bankStatement.create({ data: { organizationId: org.orgId, bankAccountId, filename: 'test.csv', lines: { create: [{ date, description: 'Payout', amount }] } }, include: { lines: true } });
      const debit = await statement(source.id, -100);
      const credit = await statement(destination.id, 100);
      const wrong = await statement(destination.id, -100);
      expect(await (await match(org.orgId, wrong.id)).json()).toMatchObject({ matched: 0 });
      expect(await (await match(org.orgId, credit.id)).json()).toMatchObject({ matched: 1 });
      const edit = await editTransaction(new NextRequest(`http://localhost/api/v1/bank-transactions/${transfer.id}`, { method: 'PUT', headers: headers(org.orgId), body: JSON.stringify({ amount: 90 }) }), { params: Promise.resolve({ id: transfer.id }) });
      expect(edit.status).toBe(409);
      expect(await (await match(org.orgId, debit.id)).json()).toMatchObject({ matched: 1 });
      const duplicate = await statement(destination.id, 100);
      expect(await (await match(org.orgId, duplicate.id)).json()).toMatchObject({ matched: 0 });
      const unrelatedAccount = await prisma.bankAccount.create({ data: { organizationId: org.orgId, name: 'Other bank' } });
      const unrelated = await statement(unrelatedAccount.id, 100);
      expect((await manual(org.orgId, unrelated.lines[0].id, { action: 'match', matchedTxId: transfer.id })).status).toBe(422);
      expect((await manual(org.orgId, debit.lines[0].id, { action: 'unmatch' })).status).toBe(200);
      expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: transfer.id } })).status).toBe('MATCHED');
      expect((await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: credit.lines[0].id } })).matchedTxId).toBe(transfer.id);
      expect((await manual(org.orgId, credit.lines[0].id, { action: 'unmatch' })).status).toBe(200);
      expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: transfer.id } })).status).toBe('UNMATCHED');
      expect((await manual(org.orgId, wrong.lines[0].id, { action: 'match', matchedTxId: transfer.id })).status).toBe(422);
      const [a, b] = await Promise.all([match(org.orgId, credit.id), match(org.orgId, duplicate.id)]);
      const results = await Promise.all([a.json(), b.json()]);
      expect(results.reduce((sum, r) => sum + r.matched, 0)).toBe(1);
    } finally { await cleanupOrg(org.orgId); }
  });
  it('does not guess when two transfers could match the same statement line', async () => {
    const org = await createTestOrg();
    try {
      const source = await prisma.bankAccount.create({ data: { organizationId: org.orgId, name: 'Wallet' } });
      const destination = await prisma.bankAccount.create({ data: { organizationId: org.orgId, name: 'Bank' } });
      for (let i = 0; i < 2; i++) await prisma.bankTransaction.create({ data: { organizationId: org.orgId, bankAccountId: source.id, toBankAccountId: destination.id, type: 'TRANSFER', amount: 100, date, description: `Payout ${i}` } });
      const statement = await prisma.bankStatement.create({ data: { organizationId: org.orgId, bankAccountId: destination.id, filename: 'ambiguous.csv', lines: { create: [{ date, description: 'Payout', amount: 100 }] } }, include: { lines: true } });
      expect(await (await match(org.orgId, statement.id)).json()).toMatchObject({ matched: 0, unmatched: 1 });
      expect((await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: statement.lines[0].id } })).matchedTxId).toBeNull();
    } finally { await cleanupOrg(org.orgId); }
  });
  it('ignores transfers already matched on this account when selecting a new candidate', async () => {
    const org = await createTestOrg();
    try {
      const source = await prisma.bankAccount.create({ data: { organizationId: org.orgId, name: 'Wallet' } });
      const destination = await prisma.bankAccount.create({ data: { organizationId: org.orgId, name: 'Bank' } });
      const transfer = async (amount: number) => prisma.bankTransaction.create({ data: { organizationId: org.orgId, bankAccountId: source.id, toBankAccountId: destination.id, type: 'TRANSFER', amount, date, description: 'Payout' } });
      const statement = async (amount: number) => prisma.bankStatement.create({ data: { organizationId: org.orgId, bankAccountId: destination.id, filename: 'test.csv', lines: { create: [{ date, description: 'Receipt', amount }] } }, include: { lines: true } });

      const first = await transfer(100);
      const firstStatement = await statement(100);
      expect(await (await match(org.orgId, firstStatement.id)).json()).toMatchObject({ matched: 1 });
      const second = await transfer(100);
      const secondStatement = await statement(100);
      expect(await (await match(org.orgId, secondStatement.id)).json()).toMatchObject({ matched: 1 });
      expect((await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: secondStatement.lines[0].id } })).matchedTxId).toBe(second.id);
      expect((await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: firstStatement.lines[0].id } })).matchedTxId).toBe(first.id);

      const ordinary = await prisma.bankTransaction.create({ data: { organizationId: org.orgId, bankAccountId: destination.id, type: 'INCOME', amount: 100, date, description: 'Other receipt' } });
      const thirdStatement = await statement(100);
      expect(await (await match(org.orgId, thirdStatement.id)).json()).toMatchObject({ matched: 1 });
      expect((await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: thirdStatement.lines[0].id } })).matchedTxId).toBe(ordinary.id);
    } finally { await cleanupOrg(org.orgId); }
  });
});

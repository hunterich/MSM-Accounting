import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as autoMatch } from '@/src/app/api/v1/bank-statements/match/route';
import { PUT as updateLine } from '@/src/app/api/v1/bank-statements/[lineId]/route';
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
      expect(await (await match(org.orgId, debit.id)).json()).toMatchObject({ matched: 1 });
      const duplicate = await statement(destination.id, 100);
      expect(await (await match(org.orgId, duplicate.id)).json()).toMatchObject({ matched: 0 });
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
});

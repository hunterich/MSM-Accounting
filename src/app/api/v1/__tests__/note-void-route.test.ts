import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    auditLog: { create: vi.fn(async () => undefined) },
  },
}));
vi.mock('@/lib/cors', () => ({ withCors: (r: Response) => r, corsPreflightResponse: () => new Response(null, { status: 204 }) }));
vi.mock('@/lib/note-void', () => ({ voidCreditNote: vi.fn(), voidDebitNote: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { voidCreditNote, voidDebitNote } from '@/lib/note-void';
import { ApiError } from '@/lib/errors';
import { POST as voidCredit } from '../credit-notes/[id]/void/route';
import { POST as voidDebit } from '../debit-notes/[id]/void/route';
import { PUT as putCredit } from '../credit-notes/[id]/route';
import { PUT as putDebit } from '../debit-notes/[id]/route';

function post(path: string) {
  return new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1' } });
}
const cnParams = { params: Promise.resolve({ id: 'cn-1' }) };
const dnParams = { params: Promise.resolve({ id: 'dn-1' }) };

beforeEach(() => vi.clearAllMocks());

it('credit-note void route reverses and returns the note', async () => {
  const tx = { creditNote: { findFirst: vi.fn(async () => ({ id: 'cn-1', status: 'VOID' })) } };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));

  const res = await voidCredit(post('/api/v1/credit-notes/cn-1/void'), cnParams);
  expect(res.status).toBe(200);
  expect(voidCreditNote).toHaveBeenCalledWith(tx, 'org-a', 'cn-1', expect.objectContaining({ date: expect.any(Date) }));
});

it('credit-note void route maps a guard failure to its status', async () => {
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb({ creditNote: { findFirst: vi.fn() } }));
  vi.mocked(voidCreditNote).mockRejectedValueOnce(new ApiError('credit note is already voided', 422));
  const res = await voidCredit(post('/api/v1/credit-notes/cn-1/void'), cnParams);
  expect(res.status).toBe(422);
});

it('debit-note void route reverses and returns the note', async () => {
  const tx = { debitNote: { findFirst: vi.fn(async () => ({ id: 'dn-1', status: 'VOID' })) } };
  vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb(tx));

  const res = await voidDebit(post('/api/v1/debit-notes/dn-1/void'), dnParams);
  expect(res.status).toBe(200);
  expect(voidDebitNote).toHaveBeenCalledWith(tx, 'org-a', 'dn-1', expect.objectContaining({ date: expect.any(Date) }));
});

function putVoid(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'PUT',
    headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'VOID' }),
  });
}

it('PUT status:VOID is rejected on a credit note (422, directs to /void)', async () => {
  const res = await putCredit(putVoid('/api/v1/credit-notes/cn-1'), cnParams);
  expect(res.status).toBe(422);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it('PUT status:VOID is rejected on a debit note (422, directs to /void)', async () => {
  const res = await putDebit(putVoid('/api/v1/debit-notes/dn-1'), dnParams);
  expect(res.status).toBe(422);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it('PUT rejects a mixed-case void status too (case-insensitive guard)', async () => {
  const req = new NextRequest('http://localhost/api/v1/credit-notes/cn-1', {
    method: 'PUT',
    headers: { 'x-org-id': 'org-a', 'x-user-id': 'u1', 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'Void' }),
  });
  const res = await putCredit(req, cnParams);
  expect(res.status).toBe(422);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

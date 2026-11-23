import { afterAll, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { postJournalEntry } from '../../journal-posting';
import { POST as createJournal } from '@/src/app/api/v1/journal-entries/route';
import { PUT as updateJournal } from '@/src/app/api/v1/journal-entries/[id]/route';
import { POST as createBill } from '@/src/app/api/v1/bills/route';
import { PUT as updateBill } from '@/src/app/api/v1/bills/[id]/route';
import { cleanupOrg, createTestOrg, createVendor, disconnect, prisma, type TestOrg } from './harness';

afterAll(disconnect);

const day = '2026-06-15';

function request(org: TestOrg, path: string, method: 'POST' | 'PUT', body: object) {
  return new NextRequest(`http://localhost/api/v1/${path}`, {
    method,
    headers: { 'x-org-id': org.orgId, 'x-user-id': 'rounding-test', 'x-role-type': 'ADMIN', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function journalLines(org: TestOrg, credit: string) {
  return [
    { accountId: org.accounts.bankAsset, description: 'First debit', debit: '0.005', credit: 0 },
    { accountId: org.accounts.bankAsset, description: 'Second debit', debit: '0.005', credit: 0 },
    { accountId: org.accounts.salesRevenue, description: 'Offset', debit: 0, credit },
  ];
}

async function readJournal(id: string) {
  const journal = await prisma.journalEntry.findUniqueOrThrow({
    where: { id },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
  });
  return {
    status: journal.status,
    totals: [journal.totalDebit.toFixed(2), journal.totalCredit.toFixed(2)],
    lines: journal.lines.map(line => ({
      accountId: line.accountId,
      debit: line.debit.toFixed(2),
      credit: line.credit.toFixed(2),
    })),
  };
}

it('rejects a system journal that only balances before rounding and saves a corrected journal exactly', async () => {
  const org = await createTestOrg();
  try {
    const post = (credit: string) => prisma.$transaction(tx => postJournalEntry(tx, {
      organizationId: org.orgId, date: new Date(day), memo: 'System rounding', lines: journalLines(org, credit),
    }));
    await expect(post('0.01')).rejects.toThrow(/unbalanced.*debit=0.02 credit=0.01/);
    expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId } })).toBe(0);

    const { id } = await post('0.02');
    expect(await readJournal(id)).toEqual({
      status: 'POSTED',
      totals: ['0.02', '0.02'],
      lines: [
        { accountId: org.accounts.bankAsset, debit: '0.01', credit: '0.00' },
        { accountId: org.accounts.bankAsset, debit: '0.01', credit: '0.00' },
        { accountId: org.accounts.salesRevenue, debit: '0.00', credit: '0.02' },
      ],
    });
  } finally {
    await cleanupOrg(org.orgId);
  }
});

it('leaves a saved draft journal intact when an unbalanced edit tries to post it', async () => {
  const org = await createTestOrg();
  try {
    const draft = await createJournal(request(org, 'journal-entries', 'POST', {
      date: day, memo: 'Draft rounding', status: 'DRAFT', lines: journalLines(org, '0.02'),
    }));
    expect(draft.status).toBe(201);
    const { id } = await draft.json();
    const before = await readJournal(id);
    const params = { params: Promise.resolve({ id }) };
    const post = (credit: string) => updateJournal(request(org, `journal-entries/${id}`, 'PUT', {
      date: day, memo: 'Draft rounding', status: 'POSTED', lines: journalLines(org, credit),
    }), params);

    expect((await post('0.01')).status).toBe(422);
    expect(await readJournal(id)).toEqual(before);
    expect((await post('0.02')).status).toBe(200);
    expect(await readJournal(id)).toEqual({ ...before, status: 'POSTED' });
  } finally {
    await cleanupOrg(org.orgId);
  }
});

it('matches the saved bill, input PPN and AP credit for two Rp100.05 lines at 11%', async () => {
  const org = await createTestOrg();
  try {
    const vendorId = await createVendor(org.orgId);
    const draft = await createBill(request(org, 'bills', 'POST', {
      vendorId, vendorInvoiceNo: 'ROUND-01', issueDate: day, status: 'DRAFT',
      taxable: true, taxRate: 11, taxAmount: 22, totalAmount: 222,
      lines: ['First item', 'Second item'].map(description => ({
        description, quantity: 1, price: 100.05, accountId: org.accounts.cogsExpense,
      })),
    }));
    expect(draft.status).toBe(201);
    const { id } = await draft.json();
    const bill = () => prisma.bill.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    const savedDraft = await bill();
    expect(savedDraft.lines.map(line => line.lineTotal.toFixed(2))).toEqual(['100.05', '100.05']);
    expect(savedDraft.subtotal.toFixed(2)).toBe('200.10');
    expect(savedDraft.taxAmount.toFixed(2)).toBe('22.02');
    expect(savedDraft.totalAmount.toFixed(2)).toBe('222.12');
    expect(savedDraft.journalEntryId).toBeNull();

    const result = await updateBill(request(org, `bills/${id}`, 'PUT', {
      status: 'OPEN', taxAmount: 22, totalAmount: 222,
    }), { params: Promise.resolve({ id }) });
    expect(result.status).toBe(200);
    const saved = await bill();
    expect(saved.status).toBe('OPEN');
    expect(saved.totalAmount.toFixed(2)).toBe('222.12');
    expect(saved.taxAmount.toFixed(2)).toBe('22.02');
    expect(saved.journalEntryId).toBeTruthy();
    expect(await readJournal(saved.journalEntryId!)).toEqual({
      status: 'POSTED',
      totals: ['222.12', '222.12'],
      lines: [
        { accountId: org.accounts.cogsExpense, debit: '200.10', credit: '0.00' },
        { accountId: org.accounts.apTax, debit: '22.02', credit: '0.00' },
        { accountId: org.accounts.apControl, debit: '0.00', credit: '222.12' },
      ],
    });
  } finally {
    await cleanupOrg(org.orgId);
  }
});

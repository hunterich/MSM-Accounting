/**
 * Regression: manual journal entries must not post into a CLOSED/locked period.
 *
 * Finding 1 — the create route only checked the period when an explicit
 * `periodId` was supplied, and the update route never checked at all, so a
 * POSTED manual journal (or a draft flipped to POSTED) could mutate a
 * signed-off period by simply omitting the periodId. The fix resolves the
 * period by the entry DATE whenever status is POSTED (mirroring the automatic
 * posting paths via `assertPeriodOpen`) and rejects a supplied periodId that
 * does not contain the entry date.
 *
 * These tests drive the real route handlers against the test DB.
 * Run with:  npm run test:int -- journal-period-guard
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as postJournal } from '@/src/app/api/v1/journal-entries/route';
import { PUT as putJournal } from '@/src/app/api/v1/journal-entries/[id]/route';
import { prisma, createTestOrg, cleanupOrg, disconnect, type TestOrg } from './harness';

afterAll(async () => {
  await disconnect();
});

const CLOSED_DAY = '2026-01-15';
const OPEN_DAY = '2026-02-15';

function makePost(orgId: string, body: unknown): NextRequest {
  return new NextRequest(new URL('/api/v1/journal-entries', 'http://localhost'), {
    method: 'POST',
    headers: new Headers({
      'x-org-id': orgId,
      'x-user-id': `je-poster-${randomUUID()}`,
      'x-role-type': 'ADMIN',
      'content-type': 'application/json',
    }),
    body: JSON.stringify({ ...(body as object), organizationId: orgId }),
  });
}

function makePut(orgId: string, id: string, body: unknown): NextRequest {
  return new NextRequest(new URL(`/api/v1/journal-entries/${id}`, 'http://localhost'), {
    method: 'PUT',
    headers: new Headers({
      'x-org-id': orgId,
      'x-user-id': `je-editor-${randomUUID()}`,
      'x-role-type': 'ADMIN',
      'content-type': 'application/json',
    }),
    body: JSON.stringify({ ...(body as object), organizationId: orgId }),
  });
}

const callPut = (orgId: string, id: string, body: unknown) =>
  putJournal(makePut(orgId, id, body), { params: Promise.resolve({ id }) });

/** A balanced two-line journal payload (Dr bank / Cr revenue) for `org`. */
function journalPayload(org: TestOrg, date: string, extra: Record<string, unknown> = {}) {
  return {
    date,
    memo: `Test JE ${date}`,
    source: 'MANUAL',
    status: 'POSTED',
    lines: [
      { accountId: org.accounts.bankAsset, description: 'debit', debit: 1000, credit: 0 },
      { accountId: org.accounts.salesRevenue, description: 'credit', debit: 0, credit: 1000 },
    ],
    ...extra,
  };
}

/** Seed CLOSED Jan-2026 and OPEN Feb-2026 periods; return their ids. */
async function seedPeriods(orgId: string) {
  const closed = await prisma.accountingPeriod.create({
    data: {
      organizationId: orgId,
      name: `Jan-2026-${randomUUID().slice(0, 6)}`,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-01-31T23:59:59.999Z'),
      status: 'CLOSED',
    },
    select: { id: true },
  });
  const open = await prisma.accountingPeriod.create({
    data: {
      organizationId: orgId,
      name: `Feb-2026-${randomUUID().slice(0, 6)}`,
      startDate: new Date('2026-02-01T00:00:00.000Z'),
      endDate: new Date('2026-02-28T23:59:59.999Z'),
      status: 'OPEN',
    },
    select: { id: true },
  });
  return { closedId: closed.id, openId: open.id };
}

async function postedJeCount(orgId: string): Promise<number> {
  return prisma.journalEntry.count({ where: { organizationId: orgId, status: 'POSTED' } });
}

describe('journal period guard: create (POST)', () => {
  it('rejects a POSTED entry dated in a CLOSED period even when no periodId is supplied', async () => {
    const org = await createTestOrg();
    await seedPeriods(org.orgId);

    const res = await postJournal(makePost(org.orgId, journalPayload(org, CLOSED_DAY)));

    expect(res.status).toBe(422);
    expect(await postedJeCount(org.orgId)).toBe(0); // nothing posted into the closed period

    await cleanupOrg(org.orgId);
  });

  it('allows a POSTED entry dated in an OPEN period', async () => {
    const org = await createTestOrg();
    await seedPeriods(org.orgId);

    const res = await postJournal(makePost(org.orgId, journalPayload(org, OPEN_DAY)));

    expect(res.status).toBe(201);
    expect(await postedJeCount(org.orgId)).toBe(1);

    await cleanupOrg(org.orgId);
  });

  it('allows a DRAFT entry dated in a CLOSED period (a draft posts nothing)', async () => {
    const org = await createTestOrg();
    await seedPeriods(org.orgId);

    const res = await postJournal(makePost(org.orgId, journalPayload(org, CLOSED_DAY, { status: 'DRAFT' })));

    expect(res.status).toBe(201);
    expect(await postedJeCount(org.orgId)).toBe(0); // draft is not posted
    expect(await prisma.journalEntry.count({ where: { organizationId: org.orgId, status: 'DRAFT' } })).toBe(1);

    await cleanupOrg(org.orgId);
  });

  it('rejects a supplied periodId that does not contain the entry date', async () => {
    const org = await createTestOrg();
    const { openId } = await seedPeriods(org.orgId);

    // Entry dated in January but tagged with the OPEN February period.
    const res = await postJournal(makePost(org.orgId, journalPayload(org, CLOSED_DAY, { periodId: openId })));

    expect(res.status).toBe(422);
    expect(await postedJeCount(org.orgId)).toBe(0);

    await cleanupOrg(org.orgId);
  });
});

describe('journal period guard: update (PUT)', () => {
  it('rejects flipping a DRAFT to POSTED when the entry date is in a CLOSED period', async () => {
    const org = await createTestOrg();
    await seedPeriods(org.orgId);

    // Seed a DRAFT entry dated in the closed period (drafts are allowed).
    const created = await postJournal(makePost(org.orgId, journalPayload(org, CLOSED_DAY, { status: 'DRAFT' })));
    expect(created.status).toBe(201);
    const draft = await prisma.journalEntry.findFirst({
      where: { organizationId: org.orgId, status: 'DRAFT' },
      select: { id: true },
    });

    const res = await callPut(org.orgId, draft!.id, journalPayload(org, CLOSED_DAY, { status: 'POSTED' }));

    expect(res.status).toBe(422);
    const after = await prisma.journalEntry.findUnique({ where: { id: draft!.id }, select: { status: true } });
    expect(after?.status).toBe('DRAFT'); // not flipped to POSTED
    expect(await postedJeCount(org.orgId)).toBe(0);

    await cleanupOrg(org.orgId);
  });

  it('allows flipping a DRAFT to POSTED when the entry date is in an OPEN period', async () => {
    const org = await createTestOrg();
    await seedPeriods(org.orgId);

    const created = await postJournal(makePost(org.orgId, journalPayload(org, OPEN_DAY, { status: 'DRAFT' })));
    expect(created.status).toBe(201);
    const draft = await prisma.journalEntry.findFirst({
      where: { organizationId: org.orgId, status: 'DRAFT' },
      select: { id: true },
    });

    const res = await callPut(org.orgId, draft!.id, journalPayload(org, OPEN_DAY, { status: 'POSTED' }));

    expect(res.status).toBe(200);
    const after = await prisma.journalEntry.findUnique({ where: { id: draft!.id }, select: { status: true } });
    expect(after?.status).toBe('POSTED');

    await cleanupOrg(org.orgId);
  });
});

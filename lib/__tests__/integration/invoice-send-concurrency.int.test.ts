/**
 * Concurrency invariant for the DRAFT → SENT "send" transition (bug C-1).
 *
 * The invoice PUT handler historically read `existing.status` via an unlocked
 * `findFirst` (READ COMMITTED) and then, near the end of its `$transaction`, ran
 * `if (existing.status === 'DRAFT' && header.status === 'SENT') postInvoiceSend`.
 * Two concurrent sends (or a double-click) both read DRAFT and both posted →
 * TWO `Sales recognition` journal entries, doubling A/R and revenue.
 *
 * The fix gates the transition behind an ATOMIC STATUS CLAIM, mirroring
 * `lib/invoice-void.ts`: a guarded `updateMany({ where: { status: 'DRAFT' } })`
 * flips the row and only the winner (`count === 1`) posts. The loser blocks on
 * the row lock, then sees status ≠ DRAFT → count 0 → skips posting and returns
 * the already-SENT invoice (a harmless no-op, HTTP 200).
 *
 * This test drives the REAL PUT route handler (constructing a `NextRequest` with
 * the auth headers the route reads) so the actual wiring is exercised.
 *
 * Run with:  npm run test:int -- invoice-send-concurrency
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { PUT as putInvoiceRoute } from '@/src/app/api/v1/invoices/[id]/route';
import {
  prisma,
  createTestOrg,
  createCustomer,
  assertTrialBalanced,
  accountBalance,
  journalEntryCount,
  cleanupOrg,
  disconnect,
} from './harness';

afterAll(async () => {
  await disconnect();
});

const DATE = new Date('2026-06-23T00:00:00.000Z');

/**
 * Seed a real User + ADMIN Role + membership. The route bypasses `requirePermission`
 * via the `x-role-type: ADMIN` header, but `getInvoiceAccessContext` still requires
 * a live `userOrganization` membership row, so we create one here.
 */
async function seedActor(orgId: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `u-${randomUUID()}@test.local`,
      fullName: 'Send Tester',
      passwordHash: 'x',
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  const role = await prisma.role.create({
    data: { organizationId: orgId, name: `Admin-${randomUUID().slice(0, 8)}`, roleType: 'ADMIN' },
    select: { id: true },
  });
  await prisma.userOrganization.create({
    data: { userId: user.id, organizationId: orgId, roleId: role.id, isActive: true },
  });
  return user.id;
}

/** Build a NextRequest carrying the identity headers the route reads (actor is ADMIN). */
function authedPut(url: string, orgId: string, userId: string, body: unknown): NextRequest {
  const h = new Headers({
    'x-org-id': orgId,
    'x-user-id': userId,
    'x-role-type': 'ADMIN',
    'content-type': 'application/json',
  });
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: 'PUT',
    headers: h,
    body: JSON.stringify(body),
  });
}

describe('invoice send concurrency: two concurrent DRAFT → SENT post the GL exactly once', () => {
  it('fires two concurrent SENDs → one Sales-recognition JE, A/R + revenue posted once, invoice ends SENT', async () => {
    const org = await createTestOrg();
    const userId = await seedActor(org.orgId);
    const customerId = await createCustomer(org.orgId);

    // A non-inventory DRAFT invoice (no lines → no COGS): sending it should post a
    // single AR-recognition entry (DR AR 1000 / CR Sales 1000).
    const inv = await prisma.salesInvoice.create({
      data: {
        organizationId: org.orgId,
        createdById: userId,
        number: 'INV-SEND-CONC-1',
        customerId,
        issueDate: DATE,
        status: 'DRAFT',
        taxEnabled: false,
        subtotal: 1000,
        totalAmount: 1000,
        taxAmount: 0,
      },
      select: { id: true, number: true },
    });

    expect(await journalEntryCount(org.orgId)).toBe(0);

    // Fire two concurrent sends. Each runs in its own request/transaction, so the
    // row lock taken by the atomic claim is what serializes them. The handlers
    // resolve to a NextResponse (never reject); the loser is a harmless 200 no-op.
    const url = `/api/v1/invoices/${inv.id}`;
    const [res1, res2] = await Promise.all([
      putInvoiceRoute(authedPut(url, org.orgId, userId, { status: 'SENT' }), {
        params: Promise.resolve({ id: inv.id }),
      }),
      putInvoiceRoute(authedPut(url, org.orgId, userId, { status: 'SENT' }), {
        params: Promise.resolve({ id: inv.id }),
      }),
    ]);

    // Neither request errors: the winner posts, the loser no-ops — both return 200.
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // THE load-bearing assertion: exactly ONE `Sales recognition` JE — never two.
    const salesRecognitionJEs = await prisma.journalEntry.count({
      where: { organizationId: org.orgId, memo: `Sales recognition: ${inv.number}` },
    });
    expect(salesRecognitionJEs).toBe(1);

    // No COGS on a lineless invoice → exactly one JE total (a double-post would be 2).
    expect(await journalEntryCount(org.orgId)).toBe(1);

    // A/R and revenue are each posted exactly once (not doubled to 2000).
    expect(await accountBalance(org.orgId, org.accounts.arControl)).toBeCloseTo(1000, 2);
    expect(await accountBalance(org.orgId, org.accounts.salesRevenue)).toBeCloseTo(-1000, 2);

    await assertTrialBalanced(org.orgId, 'invoice send concurrency');

    // The invoice ends SENT (the claim's terminal state).
    const after = await prisma.salesInvoice.findUnique({
      where: { id: inv.id },
      select: { status: true },
    });
    expect(after?.status).toBe('SENT');

    await cleanupOrg(org.orgId);
  });
});

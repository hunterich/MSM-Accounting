/**
 * The transaction-date policy survives the round trip through the settings API.
 *
 * The e2e spec drives the same path through the browser, but a save that
 * quietly writes nothing looks identical from out there — `window.alert` is
 * auto-dismissed and the screen keeps the value it already has in local state.
 * This asserts against the column.
 *
 * Run with:  npm run test:int -- transaction-date-settings
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { PUT as putSettings, GET as getSettings } from '@/src/app/api/v1/organization/settings/route';
import { prisma, createTestOrg, cleanupOrg, disconnect } from './harness';

afterAll(async () => {
  await disconnect();
});

async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `settings-${randomUUID()}@example.test`, fullName: 'Settings Editor' },
    select: { id: true },
  });
  return user.id;
}

function req(orgId: string, userId: string, method: 'GET' | 'PUT', body?: unknown): NextRequest {
  return new NextRequest(new URL('/api/v1/organization/settings', 'http://localhost'), {
    method,
    headers: new Headers({
      'x-org-id': orgId,
      'x-user-id': userId,
      'x-role-type': 'ADMIN',
      'content-type': 'application/json',
    }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('transaction-date policy through the settings API', () => {
  it('persists what was sent, and reads it back through the same parser the guard uses', async () => {
    const org = await createTestOrg();
    const userId = await makeUser();
    try {
      const res = await putSettings(
        req(org.orgId, userId, 'PUT', {
          transactionDatePolicy: { enabled: true, mode: 'BLOCK', daysBefore: 30, daysAfter: 0 },
        }),
      );
      expect(res.status).toBe(200);

      const stored = await prisma.organization.findUnique({
        where: { id: org.orgId },
        select: { transactionDatePolicy: true },
      });
      expect(stored?.transactionDatePolicy).toEqual({
        enabled: true,
        mode: 'BLOCK',
        daysBefore: 30,
        daysAfter: 0,
      });

      const body = await (await getSettings(req(org.orgId, userId, 'GET'))).json();
      // The route wraps in `{ data }`; the client's api.get unwraps it.
      expect((body.data ?? body).transactionDatePolicy).toEqual({
        enabled: true,
        mode: 'BLOCK',
        daysBefore: 30,
        daysAfter: 0,
      });
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('normalizes on the way in, so nothing can be stored that the guard would read differently', async () => {
    const org = await createTestOrg();
    const userId = await makeUser();
    try {
      await putSettings(
        req(org.orgId, userId, 'PUT', {
          // Enabled, but with no bound at all — which restricts nothing.
          transactionDatePolicy: { enabled: true, daysBefore: null, daysAfter: null },
        }),
      );
      const stored = await prisma.organization.findUnique({
        where: { id: org.orgId },
        select: { transactionDatePolicy: true },
      });
      expect((stored?.transactionDatePolicy as { enabled: boolean }).enabled).toBe(false);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });

  it('leaves the policy alone when the request does not mention it', async () => {
    const org = await createTestOrg();
    const userId = await makeUser();
    try {
      await putSettings(
        req(org.orgId, userId, 'PUT', {
          transactionDatePolicy: { enabled: true, mode: 'BLOCK', daysBefore: 10 },
        }),
      );
      await putSettings(req(org.orgId, userId, 'PUT', { displayName: 'Renamed Co' }));

      const stored = await prisma.organization.findUnique({
        where: { id: org.orgId },
        select: { transactionDatePolicy: true },
      });
      expect((stored?.transactionDatePolicy as { daysBefore: number }).daysBefore).toBe(10);
    } finally {
      await cleanupOrg(org.orgId);
    }
  });
});

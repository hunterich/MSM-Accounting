/**
 * The stock-count /journal route resolves the count's generated adjustment's
 * variance JE. Once that adjustment is VOID, the original JE has been reversed
 * (append-only storno) and there is no live posted journal — the route must
 * return null rather than the superseded entry.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    stockCount: { findFirst: vi.fn() },
    stockAdjustment: { findFirst: vi.fn() },
    journalEntry: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/cors', () => ({ withCors: (r: Response) => r, corsPreflightResponse: () => new Response(null, { status: 204 }) }));

import { prisma } from '@/lib/prisma';
import { GET as journalRoute } from '../stock-counts/[id]/journal/route';

const params = { params: Promise.resolve({ id: 'sc-1' }) };
function get() {
  return new NextRequest('http://localhost/api/v1/stock-counts/sc-1/journal', { headers: { 'x-org-id': 'org-a' } });
}

const POSTED_ENTRY = {
  id: 'je-1', entryNo: 'JE-1', date: new Date('2026-06-20'), memo: 'Stock adjustment: ADJ-1',
  status: 'POSTED', totalDebit: 100, totalCredit: 100, lines: [],
};

beforeEach(() => vi.clearAllMocks());

it('returns null when the generated adjustment is VOID (JE was reversed)', async () => {
  vi.mocked(prisma.stockCount.findFirst).mockResolvedValueOnce({ generatedAdjustmentId: 'adj-1' } as any);
  vi.mocked(prisma.stockAdjustment.findFirst).mockResolvedValueOnce({ number: 'ADJ-1', status: 'VOID' } as any);
  // Even if a POSTED variance JE still exists by memo, a voided adjustment has no live journal.
  vi.mocked(prisma.journalEntry.findFirst).mockResolvedValueOnce(POSTED_ENTRY as any);

  const res = await journalRoute(get(), params);
  expect(res.status).toBe(200);
  expect(await res.json()).toBeNull();
});

it('returns the entry for a live (non-voided) generated adjustment', async () => {
  vi.mocked(prisma.stockCount.findFirst).mockResolvedValueOnce({ generatedAdjustmentId: 'adj-1' } as any);
  vi.mocked(prisma.stockAdjustment.findFirst).mockResolvedValueOnce({ number: 'ADJ-1', status: 'APPROVED' } as any);
  vi.mocked(prisma.journalEntry.findFirst).mockResolvedValueOnce(POSTED_ENTRY as any);

  const res = await journalRoute(get(), params);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ id: 'je-1', entryNo: 'JE-1' });
});

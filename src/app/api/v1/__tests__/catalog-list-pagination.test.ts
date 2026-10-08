import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
    aRPayment: { findMany: vi.fn(), count: vi.fn() },
    aPPayment: { findMany: vi.fn(), count: vi.fn() },
    bankTransaction: { findMany: vi.fn(), count: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/cors', () => ({ withCors: (response: Response) => response, CORS_HEADERS: {}, corsPreflightResponse: () => new Response(null) }));
import { GET as getARPayments } from '../ar-payments/route';
import { GET as getAPPayments } from '../ap-payments/route';
import { GET as getBankTransactions } from '../bank-transactions/route';

beforeEach(() => {
    vi.clearAllMocks();
    for (const model of Object.values(mocks)) {
        model.findMany.mockResolvedValue([{ id: 'later-page-record' }]);
        model.count.mockResolvedValue(65);
    }
});

describe('catalog queries paginate matching records in the organization', () => {
    for (const [name, handler, model] of [
        ['receivables payments', getARPayments, mocks.aRPayment],
        ['payables payments', getAPPayments, mocks.aPPayment],
        ['bank transactions', getBankTransactions, mocks.bankTransaction],
    ] as const) {
        it(`${name}: applies search, status and full end date before pagination and count`, async () => {
            const status = name === 'bank transactions' ? 'MATCHED' : 'COMPLETED';
            const request = new NextRequest(`http://localhost/api/v1/list?page=3&limit=20&search=PAGE-065&status=${status}&dateFrom=2026-09-01&dateTo=2026-09-30`, {
                headers: { 'x-org-id': 'org-1', 'x-user-id': 'user-1', 'x-role-type': 'ADMIN' },
            });
            const response = await handler(request);
            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({ total: 65, page: 3, limit: 20 });
            const query = model.findMany.mock.calls[0][0];
            expect(query).toMatchObject({ skip: 40, take: 20, where: { organizationId: 'org-1', status, date: { gte: new Date('2026-09-01'), lt: new Date('2026-10-01') } } });
            expect(query.where.OR).toContainEqual({ number: { contains: 'PAGE-065', mode: 'insensitive' } });
            expect(model.count).toHaveBeenCalledWith({ where: query.where });
            expect(query.orderBy).toEqual([{ date: 'desc' }, { id: 'desc' }]);
        });
    }
});

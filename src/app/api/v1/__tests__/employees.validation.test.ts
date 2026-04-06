import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => {
  const prisma = {
    employee: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    department: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    position: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    employeeCompensationItem: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
  };

  return { prisma };
});

vi.mock('@/lib/cors', () => ({
  withCors: (res: Response) => res,
  corsPreflightResponse: () => new Response(null, { status: 204 }),
  CORS_HEADERS: {},
}));

vi.mock('@/lib/api-utils', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }

  return {
    ApiError,
    ok: (data: unknown, status = 200) => Response.json(data, { status }),
    err: (msg: string, status: number) => Response.json({ error: msg }, { status }),
    listResponse: (data: unknown, total: number, page: number, limit: number) =>
      Response.json({ data, total, page, limit }),
    parsePaginationParams: (req: NextRequest, defaults: { page?: number; limit?: number; maxLimit?: number } = {}) => {
      const { searchParams } = new URL(req.url);
      return {
        searchParams,
        page: defaults.page ?? 1,
        limit: defaults.limit ?? 20,
      };
    },
    nextNumber: vi.fn(async () => 'EMP-0001'),
    logAudit: vi.fn(),
    softDelete: vi.fn(),
    validateForeignKey: async (
      delegate: { findFirst: (args: { where: Record<string, unknown>; select: { id: true } }) => Promise<{ id: string } | null> },
      where: Record<string, unknown>,
      message: string,
    ) => {
      const record = await delegate.findFirst({ where, select: { id: true } });
      if (!record) throw new ApiError(message, 404);
      return record;
    },
  };
});

import { prisma } from '@/lib/prisma';
import { POST as createEmployee } from '../employees/route';
import { PUT as updateEmployee } from '../employees/[id]/route';

function makeReq(orgId: string, method = 'GET', body?: unknown) {
  const init = { method, headers: { 'x-org-id': orgId, 'x-user-id': 'u1' } } as any;
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new NextRequest('http://localhost/api/v1/employees', init);
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('employees route validation', () => {
  it('creates department and position by name and maps allowances/deductions into compensation items', async () => {
    vi.mocked(prisma.department.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.department.create).mockResolvedValue({ id: 'dep-1' } as never);
    vi.mocked(prisma.position.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.position.create).mockResolvedValue({ id: 'pos-1' } as never);
    vi.mocked(prisma.employee.create).mockResolvedValue({
      id: 'emp-1',
      employeeNo: 'EMP-0001',
      name: 'Rina',
    } as never);

    const res = await createEmployee(makeReq('org-a', 'POST', {
      name: 'Rina',
      joinDate: '2026-04-06',
      department: 'Finance',
      position: 'Accounting Staff',
      status: 'Active',
      type: 'Full-time',
      basicSalary: 5000000,
      allowances: [{ name: 'Transport', amount: 200000 }],
      deductions: [{ name: 'BPJS', amount: 50000 }],
    }));

    expect(res.status).toBe(201);
    expect(prisma.department.create).toHaveBeenCalled();
    expect(prisma.position.create).toHaveBeenCalled();
    expect(prisma.employee.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          departmentId: 'dep-1',
          positionId: 'pos-1',
          status: 'ACTIVE',
          type: 'FULL_TIME',
          compensationItems: {
            create: expect.arrayContaining([
              expect.objectContaining({ type: 'ALLOWANCE', name: 'Transport', amount: 200000 }),
              expect.objectContaining({ type: 'DEDUCTION', name: 'BPJS', amount: 50000 }),
            ]),
          },
        }),
      }),
    );
  });

  it('rejects invalid employee payloads before writing', async () => {
    const res = await createEmployee(makeReq('org-a', 'POST', {
      name: '',
      joinDate: 'not-a-date',
    }));

    expect(res.status).toBe(400);
    expect(prisma.employee.create).not.toHaveBeenCalled();
  });

  it('replaces compensation items during update when allowances/deductions are provided', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: 'emp-1' } as never);
    vi.mocked(prisma.department.findFirst).mockResolvedValue({ id: 'dep-existing' } as never);
    vi.mocked(prisma.position.findFirst).mockResolvedValue({ id: 'pos-existing' } as never);
    vi.mocked(prisma.employee.update).mockResolvedValue({ id: 'emp-1' } as never);
    vi.mocked(prisma.employeeCompensationItem.deleteMany).mockResolvedValue({ count: 2 } as never);
    vi.mocked(prisma.employeeCompensationItem.createMany).mockResolvedValue({ count: 2 } as never);
    vi.mocked(prisma.employee.findFirst)
      .mockResolvedValueOnce({ id: 'emp-1' } as never)
      .mockResolvedValueOnce({ id: 'emp-1', name: 'Rina' } as never);

    const res = await updateEmployee(makeReq('org-a', 'PUT', {
      departmentId: 'dep-existing',
      positionId: 'pos-existing',
      allowances: [{ name: 'Meal', amount: 100000 }],
      deductions: [{ name: 'Tax', amount: 25000 }],
    }), params('emp-1'));

    expect(res.status).toBe(200);
    expect(prisma.employeeCompensationItem.deleteMany).toHaveBeenCalledWith({
      where: { employeeId: 'emp-1' },
    });
    expect(prisma.employeeCompensationItem.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ employeeId: 'emp-1', type: 'ALLOWANCE', name: 'Meal' }),
          expect.objectContaining({ employeeId: 'emp-1', type: 'DEDUCTION', name: 'Tax' }),
        ]),
      }),
    );
  });
});

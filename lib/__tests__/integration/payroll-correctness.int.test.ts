import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import {
  prisma,
  createTestOrg,
  cleanupOrg,
  disconnect,
  assertTrialBalanced,
  type TestOrg,
} from './harness';
import { POST as createRun } from '@/src/app/api/v1/payroll-runs/route';
import { POST as calculate } from '@/src/app/api/v1/payroll-runs/[id]/calculate/route';
import { POST as post } from '@/src/app/api/v1/payroll-runs/[id]/post/route';
import { POST as savePolicy } from '@/src/app/api/v1/payroll-settings/route';
import { POST as createEmployee } from '@/src/app/api/v1/employees/route';
import {
  DELETE as deletePayroll,
  PUT as reviewPayroll,
} from '@/src/app/api/v1/payroll-runs/[id]/route';
import { PUT as editEmployee } from '@/src/app/api/v1/employees/[id]/route';
import { POST as approve } from '@/src/app/api/v1/approvals/[id]/approve/route';
import { postJournalEntry } from '../../journal-posting';
import { TEST_BPJS } from '../payroll-fixtures';
import { GET as precheck } from '@/src/app/api/v1/payroll-runs/precheck/route';
import { POST as createLeaveType } from '@/src/app/api/v1/leave-types/route';
import { PUT as updateLeaveType } from '@/src/app/api/v1/leave-types/[id]/route';
afterAll(disconnect);
const day = (s: string) => new Date(s + 'T00:00:00Z');
type F = {
  org: TestOrg;
  user: string;
  employee: string;
  advance: string;
  tax: string;
  bpjs: string;
};
function req(f: F, body: unknown = {}, method = 'POST') {
  return new NextRequest('http://localhost/api/v1/payroll-runs', {
    method,
    headers: {
      'x-org-id': f.org.orgId,
      'x-user-id': f.user,
      'x-role-type': 'ADMIN',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function body(response: Response, status = 200) {
  const b = await response.json();
  expect(response.status, JSON.stringify(b)).toBe(status);
  return b;
}
async function setup(salary = 10_000_000): Promise<F> {
  const org = await createTestOrg({ fiscalYearStart: day('2026-01-01') });
  const role = await prisma.role.create({
    data: { organizationId: org.orgId, name: 'Payroll QA', roleType: 'ADMIN' },
  });
  const user = await prisma.user.create({
    data: {
      email: `payroll-${randomUUID()}@test.local`,
      passwordHash: 'qa',
      fullName: 'Payroll QA',
    },
  });
  await prisma.userOrganization.create({
    data: { userId: user.id, organizationId: org.orgId, roleId: role.id },
  });
  await prisma.account.update({
    where: { id: org.accounts.cogsExpense },
    data: { name: 'Salary Expense' },
  });
  const tax = await prisma.account.create({
    data: {
      organizationId: org.orgId,
      code: '2300',
      name: 'PPh 21 Payable',
      type: 'LIABILITY',
      normalSide: 'CREDIT',
    },
  });
  const bpjs = await prisma.account.create({
    data: {
      organizationId: org.orgId,
      code: '2310',
      name: 'BPJS Payable',
      type: 'LIABILITY',
      normalSide: 'CREDIT',
    },
  });
  const advance = await prisma.account.create({
    data: {
      organizationId: org.orgId,
      code: '1410',
      name: 'Employee Advances',
      type: 'ASSET',
      normalSide: 'DEBIT',
    },
  });
  const f = {
    org,
    user: user.id,
    employee: '',
    tax: tax.id,
    bpjs: bpjs.id,
    advance: advance.id,
  };
  for (const [from, until] of [
    ['2025-03-01', '2026-02-28'],
    ['2026-03-01', '2027-02-28'],
  ])
    await body(
      await savePolicy(
        req(f, {
          effectiveFrom: from,
          validUntil: until,
          rules: {
            bpjs: {
              ...TEST_BPJS,
              jp: {
                ...TEST_BPJS.jp,
                ceiling: from.startsWith('2025') ? 10_547_400 : 11_086_300,
              },
            },
            holidays: [],
            shortWorkday: 6,
          },
        }),
      ),
      201,
    );
  const emp = await body(
    await createEmployee(
      req(f, {
        name: 'Payroll employee',
        joinDate: '2026-01-01',
        basicSalary: salary,
        ptkpStatus: 'TK/0',
        ptkpYear: 2026,
        allowances: [],
        deductions: [],
      }),
    ),
    201,
  );
  f.employee = emp.id ?? emp.data?.id;
  expect(f.employee).toBeTruthy();
  return f;
}
async function attendance(f: F, month = 10) {
  const data = [];
  for (
    let d = new Date(Date.UTC(2026, month - 1, 1));
    d.getUTCMonth() === month - 1;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6)
      data.push({
        organizationId: f.org.orgId,
        employeeId: f.employee,
        date: new Date(d),
        status: 'PRESENT' as const,
      });
  await prisma.attendanceRecord.createMany({ data });
}
async function run(f: F, month = 10, extra: Record<string, unknown> = {}) {
  const start = new Date(Date.UTC(2026, month - 1, 1))
      .toISOString()
      .slice(0, 10),
    end = new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10);
  const b = await body(
    await createRun(
      req(f, {
        month,
        year: 2026,
        periodStart: start,
        periodEnd: end,
        ...extra,
      }),
    ),
    201,
  );
  return b.id ?? b.data?.id;
}
async function calc(f: F, id: string) {
  await body(await calculate(req(f), params(id)));
  return prisma.payrollRun.findUniqueOrThrow({
    where: { id },
    include: { lines: true },
  });
}
async function posted(f: F, id: string) {
  await body(await post(req(f), params(id)));
  return prisma.payrollRun.findUniqueOrThrow({
    where: { id },
    include: { lines: true },
  });
}
async function snapshot(f: F, id: string) {
  return {
    run: await prisma.payrollRun.findUniqueOrThrow({
      where: { id },
      include: { lines: { orderBy: { id: 'asc' } } },
    }),
    journals: await prisma.journalEntry.findMany({
      where: { organizationId: f.org.orgId },
      orderBy: { id: 'asc' },
      include: { lines: { orderBy: { id: 'asc' } } },
    }),
    requests: await prisma.approvalRequest.findMany({
      where: { organizationId: f.org.orgId },
      orderBy: { id: 'asc' },
    }),
  };
}
async function credit(f: F, accountId: string) {
  const x = await prisma.journalLine.aggregate({
    where: {
      accountId,
      entry: { organizationId: f.org.orgId, status: 'POSTED' },
    },
    _sum: { debit: true, credit: true },
  });
  return Number(x._sum.credit) - Number(x._sum.debit);
}

async function clean(f: F) {
  await prisma.journalLine.deleteMany({
    where: { entry: { organizationId: f.org.orgId } },
  });
  await prisma.payrollLine.deleteMany({
    where: { payrollRun: { organizationId: f.org.orgId } },
  });
  await prisma.journalEntry.deleteMany({
    where: { organizationId: f.org.orgId },
  });
  await cleanupOrg(f.org.orgId);
  await prisma.user.delete({ where: { id: f.user } }).catch(() => {});
}
describe('payroll correctness through real routes and PostgreSQL', () => {
  it('pre-check lists all missing PTKP/year and inactive end dates within this company, without guessing them', async () => {
    const f = await setup(),
      other = await setup();
    try {
      await prisma.employee.update({
        where: { id: f.employee },
        data: { ptkpYear: 2026 },
      });
      const inactive = await prisma.employee.create({
        data: {
          organizationId: f.org.orgId,
          employeeNo: 'QA-LEGACY',
          name: 'Undated inactive',
          status: 'INACTIVE',
          joinDate: day('2026-01-01'),
        },
      });
      const request = (query: string) =>
        new NextRequest(
          'http://localhost/api/v1/payroll-runs/precheck?' + query,
          { headers: req(f).headers },
        );
      const result = await body(await precheck(request('month=1&year=2027')));
      expect(
        result.inactiveWithoutEndDate.map((e: { id: string }) => e.id),
      ).toEqual([inactive.id]);
      expect(
        result.ptkpNeedsConfirmation.map((e: { id: string }) => e.id),
      ).toEqual([f.employee]);
      expect(JSON.stringify(result)).not.toContain(other.employee);
      expect(
        (await prisma.employee.findUniqueOrThrow({ where: { id: f.employee } }))
          .ptkpYear,
      ).toBe(2026);
      expect((await precheck(request('month=13&year=2027'))).status).toBe(400);
    } finally {
      await clean(f);
      await clean(other);
    }
  });
  it('OTHER leave paid flag survives create/update and controls posted payroll without attendance fabrication', async () => {
    const f = await setup();
    try {
      expect(
        (
          await createLeaveType(
            req(f, { name: 'Unclassified', category: 'OTHER' }),
          )
        ).status,
      ).toBe(422);
      const lt = await body(
        await createLeaveType(
          req(f, { name: 'Marriage', category: 'OTHER', isPaid: false }),
        ),
        201,
      );
      expect(lt.isPaid).toBe(false);
      const updated = await body(
        await updateLeaveType(req(f, { isPaid: true }, 'PUT'), params(lt.id)),
      );
      expect(updated.isPaid).toBe(true);
      await prisma.leaveRequest.create({
        data: {
          organizationId: f.org.orgId,
          employeeId: f.employee,
          leaveTypeId: lt.id,
          startDate: day('2026-10-01'),
          endDate: day('2026-10-31'),
          totalDays: 22,
          status: 'APPROVED',
        },
      });
      const id = await run(f),
        result = await calc(f, id);
      expect(result.reviewIssues).toEqual([]);
      expect(Number(result.lines[0].paidDays)).toBe(22);
      expect(result.lines[0].calculationSnapshot).toMatchObject({
        attendance: {
          leaveDays: 22,
          approvedLeaves: [
            expect.objectContaining({ category: 'OTHER', isPaid: true }),
          ],
        },
      });
      await posted(f, id);
      expect(await credit(f, f.org.accounts.bankAsset)).toBe(9_338_650);
      await assertTrialBalanced(f.org.orgId, 'OTHER paid leave');
    } finally {
      await clean(f);
    }
  });

  for (const calculateRegularFirst of [false, true])
    it(
      'FINAL pays a leaver once and REGULAR pays the remaining employee (' +
        (calculateRegularFirst ? 'recalculate stale regular' : 'final first') +
        ')',
      async () => {
        const f = await setup();
        try {
          await body(
            await editEmployee(
              req(
                f,
                {
                  joinDate: '2026-10-01',
                  employmentEndDate: '2026-10-15',
                  status: 'INACTIVE',
                },
                'PUT',
              ),
              params(f.employee),
            ),
          );
          const b = await body(
            await createEmployee(
              req(f, {
                name: 'Continuing employee',
                joinDate: '2026-10-01',
                basicSalary: 10_000_000,
                ptkpStatus: 'TK/0',
                ptkpYear: 2026,
              }),
            ),
            201,
          );
          const employeeB = b.id ?? b.data?.id;
          await attendance(f);
          await attendance({ ...f, employee: employeeB });
          let regular: string;
          if (calculateRegularFirst) {
            regular = await run(f);
            expect((await calc(f, regular)).lines).toHaveLength(2);
          }
          const final = await run(f, 10, {
            runType: 'FINAL',
            requestKey: randomUUID(),
          });
          const finalCalc = await calc(f, final);
          expect(finalCalc.lines.map((l) => l.employeeId)).toEqual([
            f.employee,
          ]);
          expect(Number(finalCalc.totalGross)).toBe(5_000_000);
          expect(Number(finalCalc.totalNet)).toBe(4_600_000);
          await posted(f, final);
          if (calculateRegularFirst) {
            const before = await snapshot(f, regular!);
            expect((await post(req(f), params(regular!))).status).toBe(409);
            expect(await snapshot(f, regular!)).toEqual(before);
          } else regular = await run(f);
          const result = await calc(f, regular!);
          expect(result.lines.map((l) => l.employeeId)).toEqual([employeeB]);
          expect(Number(result.totalGross)).toBe(10_000_000);
          expect(Number(result.totalNet)).toBe(9_338_650);
          await posted(f, regular!);
          const aLines = await prisma.payrollLine.findMany({
            where: { employeeId: f.employee, payrollRun: { status: 'POSTED' } },
          });
          expect(aLines).toHaveLength(1);
          expect(Number(aLines[0].basicSalary)).toBe(5_000_000);
          expect(Number(aLines[0].totalBpjsEmployee)).toBe(400_000);
          expect(Number(aLines[0].totalBpjsEmployer)).toBe(1_024_000);
          expect(await credit(f, f.org.accounts.cogsExpense)).toBe(-17_048_000);
          expect(await credit(f, f.org.accounts.bankAsset)).toBe(13_938_650);
          expect(await credit(f, f.tax)).toBe(261_350);
          expect(await credit(f, f.bpjs)).toBe(2_848_000);
          for (const account of [
            f.advance,
            f.org.accounts.arControl,
            f.org.accounts.apControl,
            f.org.accounts.inventoryAsset,
          ])
            expect(await credit(f, account)).toBe(0);
          expect(
            await prisma.payrollRun.count({
              where: { organizationId: f.org.orgId, runType: 'REGULAR' },
            }),
          ).toBe(1);
          expect(
            (
              await createRun(
                req(f, {
                  month: 10,
                  year: 2026,
                  periodStart: '2026-10-01',
                  periodEnd: '2026-10-31',
                }),
              )
            ).status,
          ).toBe(409);
          await assertTrialBalanced(
            f.org.orgId,
            'final then remaining regular',
          );
        } finally {
          await clean(f);
        }
      },
    );
  it('REGULAR refuses without mutations when every salary was already included in FINAL', async () => {
    const f = await setup();
    try {
      await body(
        await editEmployee(
          req(
            f,
            { joinDate: '2026-10-01', employmentEndDate: '2026-10-15' },
            'PUT',
          ),
          params(f.employee),
        ),
      );
      await attendance(f);
      const final = await run(f, 10, {
        runType: 'FINAL',
        requestKey: randomUUID(),
      });
      await calc(f, final);
      await posted(f, final);
      const regular = await run(f),
        before = await snapshot(f, regular);
      const response = await calculate(req(f), params(regular));
      expect(response.status).toBe(422);
      expect(await response.text()).toContain('No employees eligible');
      expect(await snapshot(f, regular)).toEqual(before);
    } finally {
      await clean(f);
    }
  });
  it('approved maternity leave for the whole month posts full salary with paid-leave snapshots and no fake attendance', async () => {
    const f = await setup();
    try {
      const lt = await prisma.leaveType.create({
        data: {
          organizationId: f.org.orgId,
          name: 'Maternity',
          category: 'MATERNITY',
        },
      });
      await prisma.leaveRequest.create({
        data: {
          organizationId: f.org.orgId,
          employeeId: f.employee,
          leaveTypeId: lt.id,
          startDate: day('2026-10-01'),
          endDate: day('2026-10-31'),
          totalDays: 22,
          status: 'APPROVED',
        },
      });
      const id = await run(f),
        result = await calc(f, id),
        line = result.lines[0];
      expect(result.reviewIssues).toEqual([]);
      expect(Number(line.presentDays)).toBe(0);
      expect(Number(line.paidDays)).toBe(22);
      expect(line.calculationSnapshot).toMatchObject({
        attendance: {
          presentDays: 0,
          leaveDays: 22,
          sickDays: 0,
          paidDays: 22,
          approvedLeaves: [expect.objectContaining({ category: 'MATERNITY' })],
        },
      });
      expect(
        await prisma.attendanceRecord.count({
          where: { employeeId: f.employee },
        }),
      ).toBe(0);
      await posted(f, id);
      expect(await credit(f, f.org.accounts.cogsExpense)).toBe(-11_024_000);
      expect(await credit(f, f.org.accounts.bankAsset)).toBe(9_338_650);
      expect(await credit(f, f.tax)).toBe(261_350);
      expect(await credit(f, f.bpjs)).toBe(1_424_000);
      await assertTrialBalanced(f.org.orgId, 'paid maternity');
    } finally {
      await clean(f);
    }
  });

  it('fully unpaid salary recovers employee BPJS as a receivable without a fictitious bank receipt', async () => {
    const f = await setup();
    try {
      const lt = await prisma.leaveType.create({
        data: {
          organizationId: f.org.orgId,
          name: 'Unpaid',
          category: 'UNPAID',
        },
      });
      await prisma.leaveRequest.create({
        data: {
          organizationId: f.org.orgId,
          employeeId: f.employee,
          leaveTypeId: lt.id,
          startDate: day('2026-10-01'),
          endDate: day('2026-10-31'),
          totalDays: 22,
          status: 'APPROVED',
        },
      });
      const id = await run(f, 10, {
          adjustments: [
            {
              employeeId: f.employee,
              amount: 0,
              description: 'Employee BPJS recovery',
              recoveryAccountId: f.advance,
            },
          ],
        }),
        c = await calc(f, id);
      expect(c.reviewIssues).toEqual([]);
      expect(Number(c.totalGross)).toBe(0);
      expect(Number(c.totalTax)).toBe(0);
      expect(Number(c.totalNet)).toBe(-400_000);
      await posted(f, id);
      expect(await credit(f, f.org.accounts.bankAsset)).toBe(0);
      expect(await credit(f, f.advance)).toBe(-400_000);
      expect(await credit(f, f.bpjs)).toBe(1_424_000);
      await assertTrialBalanced(f.org.orgId, 'unpaid BPJS recovery');
    } finally {
      await clean(f);
    }
  });
  it('deduction mapping survives calculation and cash falls only by exact net salary', async () => {
    const f = await setup();
    try {
      await body(
        await editEmployee(
          req(
            f,
            {
              allowances: [{ name: 'Fixed', amount: 1_000_000, isFixed: true }],
              deductions: [
                {
                  name: 'Advance',
                  amount: 100_000,
                  postingAccountId: f.advance,
                },
              ],
            },
            'PUT',
          ),
          params(f.employee),
        ),
      );
      await prisma.$transaction((tx) =>
        postJournalEntry(tx, {
          organizationId: f.org.orgId,
          date: day('2026-10-01'),
          memo: 'QA opening cash and employee advance',
          source: 'SYSTEM',
          lines: [
            {
              description: 'QA opening',
              accountId: f.org.accounts.bankAsset,
              debit: 20_000_000,
              credit: 0,
            },
            {
              description: 'QA opening',
              accountId: f.org.accounts.openingBalanceEquity,
              debit: 0,
              credit: 20_000_000,
            },
            {
              description: 'QA opening',
              accountId: f.advance,
              debit: 100_000,
              credit: 0,
            },
            {
              description: 'QA opening',
              accountId: f.org.accounts.bankAsset,
              debit: 0,
              credit: 100_000,
            },
          ],
        }),
      );
      const cashBefore = await credit(f, f.org.accounts.bankAsset);
      expect(await credit(f, f.advance)).toBe(-100_000);
      await attendance(f);
      const id = await run(f),
        c = await calc(f, id);
      expect(Number(c.totalGross)).toBe(11_000_000);
      expect(Number(c.totalTax)).toBe(402_479);
      expect(Number(c.totalNet)).toBe(10_057_521);
      // Later master-data edits cannot redirect the saved deduction snapshot.
      await prisma.employeeCompensationItem.updateMany({
        where: { employeeId: f.employee, type: 'DEDUCTION' },
        data: { postingAccountId: f.org.accounts.apControl },
      });
      await posted(f, id);
      expect((await credit(f, f.org.accounts.bankAsset)) - cashBefore).toBe(
        10_057_521,
      );
      expect(await credit(f, f.advance)).toBe(0);
      expect(await credit(f, f.tax)).toBe(402_479);
      expect(await credit(f, f.bpjs)).toBe(1_566_400);
      for (const a of [
        f.org.accounts.apControl,
        f.org.accounts.arControl,
        f.org.accounts.inventoryAsset,
      ])
        expect(await credit(f, a)).toBe(0);
      await assertTrialBalanced(f.org.orgId, 'payroll deductions');
    } finally {
      await clean(f);
    }
  });
  for (const code of ['5100', '2300', '2310'])
    it(`missing required ${code} refuses with complete rollback instead of choosing another account`, async () => {
      const f = await setup();
      try {
        await attendance(f);
        const id = await run(f);
        await calc(f, id);
        await prisma.account.updateMany({
          where: { organizationId: f.org.orgId, code },
          data: { isActive: false },
        });
        const before = await snapshot(f, id);
        const r = await post(req(f), params(id));
        expect(r.status).toBe(422);
        expect(await r.text()).toContain(code);
        expect(await snapshot(f, id)).toEqual(before);
      } finally {
        await clean(f);
      }
    });
  it('rejects AR/AP deduction mappings with no journal or approval mutation', async () => {
    const f = await setup();
    try {
      await body(
        await editEmployee(
          req(
            f,
            {
              deductions: [
                {
                  name: 'Unsafe',
                  amount: 100_000,
                  postingAccountId: f.org.accounts.apControl,
                },
              ],
            },
            'PUT',
          ),
          params(f.employee),
        ),
      );
      await attendance(f);
      const id = await run(f);
      await calc(f, id);
      const before = await snapshot(f, id);
      const r = await post(req(f), params(id));
      expect(r.status).toBe(422);
      expect(await snapshot(f, id)).toEqual(before);
    } finally {
      await clean(f);
    }
  });
  it('paid annual/sick leave and half-days are exact; missing attendance blocks posting', async () => {
    const f = await setup(2_200_000);
    try {
      await attendance(f);
      await prisma.attendanceRecord.deleteMany({
        where: {
          employeeId: f.employee,
          date: { in: [day('2026-10-05'), day('2026-10-06')] },
        },
      });
      await prisma.attendanceRecord.update({
        where: {
          employeeId_date: { employeeId: f.employee, date: day('2026-10-07') },
        },
        data: { status: 'SICK', sickCertified: true },
      });
      await prisma.attendanceRecord.update({
        where: {
          employeeId_date: { employeeId: f.employee, date: day('2026-10-08') },
        },
        data: { status: 'HALF_DAY' },
      });
      const lt = await prisma.leaveType.create({
        data: {
          organizationId: f.org.orgId,
          name: 'Annual',
          category: 'ANNUAL',
        },
      });
      await prisma.leaveRequest.create({
        data: {
          organizationId: f.org.orgId,
          employeeId: f.employee,
          leaveTypeId: lt.id,
          startDate: day('2026-10-05'),
          endDate: day('2026-10-05'),
          totalDays: 1,
          status: 'APPROVED',
        },
      });
      const id = await run(f),
        c = await calc(f, id);
      expect(Number(c.lines[0].paidDays)).toBe(20.5);
      expect(Number(c.lines[0].basicSalary)).toBe(2_050_000);
      expect(c.reviewIssues).toEqual([
        expect.stringContaining('2026-10-06: missing attendance'),
      ]);
      const before = await snapshot(f, id);
      expect((await post(req(f), params(id))).status).toBe(422);
      expect(await snapshot(f, id)).toEqual(before);
    } finally {
      await clean(f);
    }
  });
  it('THR is an off-cycle earning, combines monthly TER, charges BPJS once and retries creation once', async () => {
    const f = await setup();
    try {
      await attendance(f);
      const regular = await run(f);
      await calc(f, regular);
      await posted(f, regular);
      const input = {
        month: 10,
        year: 2026,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        runType: 'THR',
        requestKey: randomUUID(),
        adjustments: [
          { employeeId: f.employee, amount: 5_000_000, description: 'THR' },
        ],
      };
      const responses = await Promise.all([
        createRun(req(f, input)),
        createRun(req(f, input)),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
      const rows = await Promise.all(responses.map((r) => r.json()));
      const id = rows[0].id ?? rows[0].data?.id;
      expect(rows[1].id ?? rows[1].data?.id).toBe(id);
      const c = await calc(f, id);
      expect(Number(c.totalGross)).toBe(5_000_000);
      expect(Number(c.totalBpjs)).toBe(0);
      expect(Number(c.totalTax)).toBe(820_430);
      await posted(f, id);
      expect(await credit(f, f.tax)).toBe(1_081_780);
      expect(
        await prisma.payrollRun.count({
          where: { organizationId: f.org.orgId },
        }),
      ).toBe(2);
      await assertTrialBalanced(f.org.orgId, 'regular plus THR');
      expect(
        (
          await createRun(
            req(f, {
              ...input,
              runType: 'REGULAR',
              requestKey: randomUUID(),
              adjustments: [],
            }),
          )
        ).status,
      ).toBe(409);
    } finally {
      await clean(f);
    }
  });
  it('stale off-cycle tax basis refuses atomically and succeeds after recalculation', async () => {
    const f = await setup();
    try {
      await attendance(f);
      const regular = await run(f);
      await calc(f, regular);
      await posted(f, regular);
      const a = await run(f, 10, {
        runType: 'CORRECTION',
        requestKey: randomUUID(),
        notes: 'Correction A',
        adjustments: [
          {
            employeeId: f.employee,
            amount: 100_000,
            description: 'Adjustment A',
          },
        ],
      });
      const b = await run(f, 10, {
        runType: 'CORRECTION',
        requestKey: randomUUID(),
        notes: 'Correction B',
        adjustments: [
          {
            employeeId: f.employee,
            amount: 200_000,
            description: 'Adjustment B',
          },
        ],
      });
      await calc(f, a);
      await calc(f, b);
      await posted(f, a);
      const before = await snapshot(f, b);
      expect((await post(req(f), params(b))).status).toBe(409);
      expect(await snapshot(f, b)).toEqual(before);
      await calc(f, b);
      await posted(f, b);
      await assertTrialBalanced(f.org.orgId, 'corrected YTD');
    } finally {
      await clean(f);
    }
  });
  it('December recalculates full-year Article 17 and subtracts actual TER withheld', async () => {
    const f = await setup();
    try {
      for (let month = 1; month <= 12; month++) {
        await attendance(f, month);
        const id = await run(f, month),
          c = await calc(f, id);
        if (month < 12) expect(Number(c.totalTax)).toBe(261_350);
        else {
          expect(Number(c.totalTax)).toBe(402_350);
          expect(Number(c.totalNet)).toBe(9_197_650);
        }
        await posted(f, id);
      }
      expect(await credit(f, f.tax)).toBe(3_277_200);
      await assertTrialBalanced(f.org.orgId, 'annual payroll');
    } finally {
      await clean(f);
    }
  }, 60000);
  it('inactive employee receives prorated final October pay and tax refund; November excludes them', async () => {
    const f = await setup();
    try {
      for (let month = 1; month <= 9; month++) {
        await attendance(f, month);
        const id = await run(f, month);
        await calc(f, id);
        await posted(f, id);
      }
      await body(
        await editEmployee(
          req(
            f,
            {
              status: 'INACTIVE',
              employmentEndDate: '2026-10-15',
              leavingReason: 'Contract ended',
            },
            'PUT',
          ),
          params(f.employee),
        ),
      );
      await attendance(f);
      const id = await run(f, 10, {
          runType: 'FINAL',
          requestKey: randomUUID(),
        }),
        c = await calc(f, id);
      expect(Number(c.lines[0].paidDays)).toBe(11);
      expect(Number(c.totalGross)).toBe(5_000_000);
      expect(Number(c.totalTax)).toBe(-474_000);
      expect(Number(c.totalNet)).toBe(5_074_000);
      await posted(f, id);
      expect(await credit(f, f.tax)).toBe(1_878_150);
      const november = await run(f, 11);
      expect((await calculate(req(f), params(november))).status).toBe(422);
      expect(
        await prisma.payrollLine.count({ where: { payrollRunId: november } }),
      ).toBe(0);
    } finally {
      await clean(f);
    }
  }, 60000);
  it('pending payroll cannot be recalculated and account checks run again during approval', async () => {
    const f = await setup();
    try {
      await prisma.organization.update({
        where: { id: f.org.orgId },
        data: {
          approvalRequirements: { hr_payroll: true },
          requireDistinctApproverForAdmins: false,
        },
      });
      await attendance(f);
      const id = await run(f);
      await calc(f, id);
      await body(await post(req(f), params(id)));
      expect(
        (await prisma.payrollRun.findUniqueOrThrow({ where: { id } })).status,
      ).toBe('PENDING_APPROVAL');
      const before = await snapshot(f, id);
      expect((await calculate(req(f), params(id))).status).toBe(409);
      expect(
        (
          await reviewPayroll(
            req(f, { notes: 'Change pending' }, 'PUT'),
            params(id),
          )
        ).status,
      ).toBe(409);
      expect(
        (await deletePayroll(req(f, {}, 'DELETE'), params(id))).status,
      ).toBe(409);
      expect((await post(req(f), params(id))).status).toBe(409);
      expect(await snapshot(f, id)).toEqual(before);
      await prisma.account.update({
        where: { id: f.bpjs },
        data: { isActive: false },
      });
      const locked = await snapshot(f, id);
      const request = await prisma.approvalRequest.findFirstOrThrow({
        where: {
          organizationId: f.org.orgId,
          documentId: id,
          status: 'PENDING',
        },
      });
      expect((await approve(req(f), params(request.id))).status).toBe(422);
      expect(await snapshot(f, id)).toEqual(locked);
    } finally {
      await clean(f);
    }
  });
  it('negative correction debits an employee receivable and never fabricates a bank receipt', async () => {
    const f = await setup();
    try {
      await attendance(f);
      const regular = await run(f);
      await calc(f, regular);
      await posted(f, regular);
      const beforeCash = await credit(f, f.org.accounts.bankAsset),
        beforeTax = await credit(f, f.tax);
      const id = await run(f, 10, {
        runType: 'CORRECTION',
        requestKey: randomUUID(),
        notes: 'Recover salary overpayment',
        adjustments: [
          {
            employeeId: f.employee,
            amount: -100_000,
            description: 'Salary correction',
            recoveryAccountId: f.advance,
          },
        ],
      });
      const c = await calc(f, id);
      expect(Number(c.totalTax)).toBe(-2_500);
      expect(Number(c.totalNet)).toBe(-97_500);
      expect(c.reviewIssues).toEqual([]);
      await posted(f, id);
      expect(await credit(f, f.org.accounts.bankAsset)).toBe(beforeCash);
      expect(await credit(f, f.advance)).toBe(-97_500);
      expect(await credit(f, f.tax)).toBe(beforeTax - 2_500);
      await assertTrialBalanced(f.org.orgId, 'negative correction');
    } finally {
      await clean(f);
    }
  });
  it('concurrent posting of two calculated off-cycle runs admits one, refuses the stale one with no partial journal', async () => {
    const f = await setup();
    try {
      await attendance(f);
      const regular = await run(f);
      await calc(f, regular);
      await posted(f, regular);
      const ids = [];
      for (const amount of [100_000, 200_000]) {
        const id = await run(f, 10, {
          runType: 'THR',
          requestKey: randomUUID(),
          adjustments: [
            {
              employeeId: f.employee,
              amount,
              description: 'Additional salary',
            },
          ],
        });
        await calc(f, id);
        ids.push(id);
      }
      const count = await prisma.journalEntry.count({
        where: { organizationId: f.org.orgId },
      });
      const responses = await Promise.all(
        ids.map((id) => post(req(f), params(id))),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await prisma.journalEntry.count({
          where: { organizationId: f.org.orgId },
        }),
      ).toBe(count + 1);
      const loser = ids[responses.findIndex((r) => r.status === 409)];
      expect(
        (await prisma.payrollRun.findUniqueOrThrow({ where: { id: loser } }))
          .journalEntryId,
      ).toBeNull();
      await calc(f, loser);
      await posted(f, loser);
      expect(await credit(f, f.tax)).toBe(322_620);
      await assertTrialBalanced(f.org.orgId, 'parallel payroll');
    } finally {
      await clean(f);
    }
  });
  it('cannot mark draft payroll reviewed or edit/delete posted history', async () => {
    const f = await setup();
    try {
      const id = await run(f);
      expect(
        (await reviewPayroll(req(f, { status: 'REVIEWED' }, 'PUT'), params(id)))
          .status,
      ).toBe(422);
      await attendance(f);
      await calc(f, id);
      await posted(f, id);
      const before = await snapshot(f, id);
      expect(
        (await reviewPayroll(req(f, { notes: 'Overwrite' }, 'PUT'), params(id)))
          .status,
      ).toBe(409);
      expect(
        (await deletePayroll(req(f, {}, 'DELETE'), params(id))).status,
      ).toBe(409);
      expect(await snapshot(f, id)).toEqual(before);
    } finally {
      await clean(f);
    }
  });
  it('final month refuses incomplete YTD history instead of assuming missing months had no income', async () => {
    const f = await setup();
    try {
      await body(
        await editEmployee(
          req(f, { employmentEndDate: '2026-10-31' }, 'PUT'),
          params(f.employee),
        ),
      );
      await attendance(f);
      const id = await run(f, 10, {
        runType: 'FINAL',
        requestKey: randomUUID(),
      });
      const before = await snapshot(f, id);
      const r = await calculate(req(f), params(id));
      expect(r.status).toBe(422);
      expect(await r.text()).toContain('complete posted YTD');
      expect(await snapshot(f, id)).toEqual(before);
    } finally {
      await clean(f);
    }
  });
  it('selects the policy either side of March and refuses stale/overlapping policies', async () => {
    const f = await setup(20_000_000);
    try {
      await attendance(f, 1);
      const jan = await run(f, 1);
      const j = await calc(f, jan);
      expect(Number(j.lines[0].bpjsJpEmployee)).toBe(105_474);
      await posted(f, jan);
      await attendance(f, 3);
      const mar = await run(f, 3);
      const m = await calc(f, mar);
      expect(Number(m.lines[0].bpjsJpEmployee)).toBe(110_863);
      const r = await savePolicy(
        req(f, {
          effectiveFrom: '2026-04-01',
          validUntil: '2026-12-31',
          rules: { bpjs: TEST_BPJS },
        }),
      );
      expect(r.status).toBe(409);
      const next = await run(f, 3, {
        year: 2027,
        periodStart: '2027-03-01',
        periodEnd: '2027-03-31',
        runType: 'THR',
        requestKey: randomUUID(),
        adjustments: [
          { employeeId: f.employee, amount: 1_000, description: 'New year' },
        ],
      });
      expect((await calculate(req(f), params(next))).status).toBe(422);
    } finally {
      await clean(f);
    }
  });
});

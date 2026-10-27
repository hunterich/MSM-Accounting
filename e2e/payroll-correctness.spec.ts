import { test, expect, type Page } from '@playwright/test';
import {
  accountingCompany,
  cleanupAccountingCompany,
  api,
  db,
} from './accounting-helpers';
import { selectCashAccounts } from '../lib/cash-accounts';
test.setTimeout(180_000);
test.afterEach(cleanupAccountingCompany);
test.afterAll(async () => db.$disconnect());
async function fixture(page: Page) {
  page.setDefaultTimeout(30_000);
  const { orgId } = await accountingCompany(page);
  const all = await db.account.findMany({ where: { organizationId: orgId } }),
    cash = selectCashAccounts(all).find((a) => a.isActive)!;
  expect(cash).toBeTruthy();
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({
    where: { id: orgId },
    data: {
      accountDefaults: {
        ...(org.accountDefaults as Record<string, string>),
        bankAsset: cash.id,
      },
    },
  });
  for (const [code, name, type, normalSide] of [
    ['5100', 'Salary Expense', 'EXPENSE', 'DEBIT'],
    ['2300', 'PPh 21 Payable', 'LIABILITY', 'CREDIT'],
    ['2310', 'BPJS Payable', 'LIABILITY', 'CREDIT'],
  ] as const)
    await db.account.upsert({
      where: { organizationId_code: { organizationId: orgId, code } },
      create: { organizationId: orgId, code, name, type, normalSide },
      update: { isActive: true, isPostable: true, name, type },
    });
  const advance = await db.account.create({
    data: {
      organizationId: orgId,
      code: 'QA-ADVANCE',
      name: 'Employee Advances QA',
      type: 'ASSET',
      normalSide: 'DEBIT',
    },
  });
  return { orgId, cash: cash.id, advance: advance.id };
}
async function seedAttendance(orgId: string, employeeId: string, lastDay = 31) {
  const data = [];
  for (
    let d = new Date('2026-10-01T00:00:00Z');
    d.getUTCDate() <= lastDay && d.getUTCMonth() === 9;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6)
      data.push({
        organizationId: orgId,
        employeeId,
        date: new Date(d),
        status: 'PRESENT' as const,
      });
  await db.attendanceRecord.createMany({ data });
}
const rules = {
  bpjs: {
    kesehatan: {
      employee: 0.01,
      employer: 0.04,
      ceiling: 12_000_000,
      floor: 0,
    },
    jht: { employee: 0.02, employer: 0.037 },
    jp: { employee: 0.01, employer: 0.02, ceiling: 11_086_300 },
    jkk: { employer: 0.0024 },
    jkm: { employer: 0.003 },
  },
  holidays: [],
  shortWorkday: 6,
};
async function createThroughScreen(
  page: Page,
  kind = 'REGULAR',
  employeeId = '',
  amount = 0,
  recovery = '',
) {
  await page.goto('/hr/payroll-run');
  await page
    .getByRole('button', { name: 'Create Payroll', exact: true })
    .click();
  await page.getByLabel('Payroll run type').selectOption(kind);
  await page.getByLabel('Payroll month').selectOption('10');
  await page.getByLabel('Payroll year').selectOption('2026');
  if (employeeId) {
    await page
      .getByRole('button', {
        name: 'Add employee earning adjustment',
        exact: true,
      })
      .click();
    await expect(
      page
        .getByLabel('Adjustment employee')
        .locator(`option[value="${employeeId}"]`),
    ).toHaveCount(1);
    await page.getByLabel('Adjustment employee').selectOption(employeeId);
    await page.getByLabel('Earning adjustment amount').fill(String(amount));
    await page
      .getByLabel('Earning adjustment description')
      .fill(kind === 'THR' ? 'THR payment' : 'Salary correction');
    if (recovery)
      await page
        .getByLabel('Employee recovery receivable')
        .selectOption(recovery);
  }
  if (kind === 'CORRECTION')
    await page.getByLabel('Payroll notes').fill('Recover salary overpayment');
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/v1/payroll-runs') &&
      r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const r = await response;
  expect(r.status(), await r.text()).toBe(201);
  const b = await r.json();
  await expect(
    page.getByRole('button', { name: 'Calculate', exact: true }),
  ).toBeVisible();
  return b.id ?? b.data?.id;
}
async function calculateScreen(page: Page, id: string) {
  page.once('dialog', (d) => d.accept());
  const response = page.waitForResponse((r) =>
    r.url().endsWith(`/payroll-runs/${id}/calculate`),
  );
  await page.getByRole('button', { name: 'Calculate', exact: true }).click();
  const r = await response;
  expect(r.status(), await r.text()).toBe(200);
  return db.payrollRun.findUniqueOrThrow({
    where: { id },
    include: { lines: true },
  });
}
async function postScreen(page: Page, id: string) {
  page.once('dialog', (d) => d.accept());
  const response = page.waitForResponse((r) =>
    r.url().endsWith(`/payroll-runs/${id}/post`),
  );
  await page.getByRole('button', { name: 'Post to GL', exact: true }).click();
  const r = await response;
  expect(r.status(), await r.text()).toBe(200);
}
async function credit(orgId: string, accountId: string) {
  const a = await db.journalLine.aggregate({
    where: { accountId, entry: { organizationId: orgId, status: 'POSTED' } },
    _sum: { credit: true, debit: true },
  });
  return Number(a._sum.credit) - Number(a._sum.debit);
}

test('employee end-date/PTKP and deduction form, dated settings, certified sick day and exact final payroll', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto('/hr/employees/new?mode=create');
  await page.locator('input[name="name"]').fill('Final Pay QA');
  await page.locator('input[name="department"]').fill('Finance');
  await page.locator('input[name="position"]').fill('Staff');
  await page.locator('input[name="joinDate"]').fill('2026-10-01');
  await page.locator('input[name="basicSalary"]').fill('2200000');
  await page.getByLabel('PTKP status', { exact: true }).selectOption('K/1');
  await page.locator('input[name="ptkpYear"]').fill('2026');
  await page
    .getByRole('checkbox', {
      name: 'End employment / employee leaving the company',
    })
    .check();
  await page.locator('input[name="employmentEndDate"]').fill('2026-10-15');
  await page.locator('input[name="leavingReason"]').fill('Resigned');
  await page.getByPlaceholder('Deduction name').fill('Advance repayment');
  await page
    .getByPlaceholder('Deduction name')
    .locator('..')
    .locator('input[type="number"]')
    .fill('100000');
  await page.getByLabel('Deduction posting account').selectOption(f.advance);
  const save = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/v1/employees') && r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Save Employee', exact: true })
    .click();
  const res = await save;
  expect(res.status(), await res.text()).toBe(201);
  const b = await res.json(),
    employee = b.id ?? b.data?.id;
  const stored = await db.employee.findUniqueOrThrow({
    where: { id: employee },
    include: { compensationItems: true },
  });
  expect(stored.ptkpStatus).toBe('K/1');
  expect(stored.employmentEndDate?.toISOString().slice(0, 10)).toBe(
    '2026-10-15',
  );
  expect(
    stored.compensationItems.find((c) => c.type === 'DEDUCTION')
      ?.postingAccountId,
  ).toBe(f.advance);
  await page.goto('/hr/payroll-run');
  await page
    .getByText('Payroll settings — effective-dated BPJS and holiday calendar', {
      exact: true,
    })
    .click();
  await page.getByLabel('Payroll policy effective from').fill('2026-03-01');
  await page.getByLabel('Payroll policy valid until').fill('2027-02-28');
  await page.getByLabel('JP wage ceiling').fill('11086300');
  await page
    .getByLabel('JKK risk rate', { exact: true })
    .selectOption('0.0024');
  const settings = page.waitForResponse(
    (r) =>
      r.url().endsWith('/payroll-settings') && r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Save dated payroll settings' })
    .click();
  const policy = await settings;
  expect(policy.status(), await policy.text()).toBe(201);
  await seedAttendance(f.orgId, employee, 15);
  await db.attendanceRecord.delete({
    where: {
      employeeId_date: { employeeId: employee, date: new Date('2026-10-06') },
    },
  });
  await db.attendanceRecord.update({
    where: {
      employeeId_date: { employeeId: employee, date: new Date('2026-10-08') },
    },
    data: { status: 'HALF_DAY' },
  });
  const id = await createThroughScreen(page);
  await calculateScreen(page, id);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Payroll review required' }),
  ).toContainText('2026-10-06: missing attendance');
  await expect(page.getByRole('button', { name: 'Post to GL' })).toBeDisabled();
  // Resolve the actual missing day through the attendance screen and its doctor-certification control.
  await page.goto('/hr/attendance');
  await page
    .getByRole('button', { name: 'Entri Massal', exact: true })
    .first()
    .click();
  await page.getByLabel('Attendance entry date').fill('2026-10-06');
  await page.getByLabel('Attendance entry status').selectOption('SICK');
  await page
    .getByRole('checkbox', { name: 'Doctor-certified sick leave' })
    .check();
  await page.getByText('Final Pay QA', { exact: true }).click();
  const record = page.waitForResponse(
    (r) => r.url().endsWith('/attendance') && r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Simpan Kehadiran', exact: true })
    .click();
  const r = await record;
  expect(r.status(), await r.text()).toBe(201);
  await page.goto('/hr/payroll-run');
  const run = await db.payrollRun.findUniqueOrThrow({ where: { id } });
  await page.getByRole('row').filter({ hasText: run.number }).click();
  const result = await calculateScreen(page, id);
  expect(result.reviewIssues).toEqual([]);
  expect(Number(result.lines[0].paidDays)).toBe(10.5);
  expect(Number(result.totalGross)).toBe(1_050_000);
  expect(Number(result.totalTax)).toBe(0);
  expect(Number(result.totalNet)).toBe(862_000);
  await postScreen(page, id);
  expect(await credit(f.orgId, f.cash)).toBe(862_000);
  expect(await credit(f.orgId, f.advance)).toBe(100_000);
});

test('THR and a negative correction through payroll screens preserve one salary/BPJS charge and recover a receivable', async ({
  page,
}) => {
  const f = await fixture(page);
  await api(
    page,
    '/payroll-settings',
    { effectiveFrom: '2026-03-01', validUntil: '2027-02-28', rules },
    'POST',
  );
  const employee = await api(
    page,
    '/employees',
    {
      name: 'THR Payroll QA',
      joinDate: '2026-10-01',
      basicSalary: 10_000_000,
      ptkpStatus: 'TK/0',
      ptkpYear: 2026,
      allowances: [],
      deductions: [],
    },
    'POST',
  );
  await seedAttendance(f.orgId, employee.id);
  const regular = await createThroughScreen(page);
  await calculateScreen(page, regular);
  await postScreen(page, regular);
  const thr = await createThroughScreen(page, 'THR', employee.id, 5_000_000);
  const t = await calculateScreen(page, thr);
  expect(Number(t.totalGross)).toBe(5_000_000);
  expect(Number(t.totalBpjs)).toBe(0);
  expect(Number(t.totalTax)).toBe(820_430);
  await postScreen(page, thr);
  const cash = await credit(f.orgId, f.cash);
  expect(cash).toBe(13_518_220);
  const correction = await createThroughScreen(
    page,
    'CORRECTION',
    employee.id,
    -100_000,
    f.advance,
  );
  const c = await calculateScreen(page, correction);
  expect(c.reviewIssues).toEqual([]);
  expect(Number(c.totalTax)).toBe(-7_000);
  expect(Number(c.totalNet)).toBe(-93_000);
  await postScreen(page, correction);
  expect(await credit(f.orgId, f.cash)).toBe(cash);
  expect(await credit(f.orgId, f.advance)).toBe(-93_000);
});

test('employee setup pre-check lists PTKP rollover/inactive dates and OTHER leave requires explicit payment treatment', async ({
  page,
}) => {
  const f = await fixture(page);
  const employee = await api(
    page,
    '/employees',
    {
      name: 'PTKP rollover QA',
      joinDate: '2026-01-01',
      basicSalary: 10_000_000,
      ptkpStatus: 'K/1',
      ptkpYear: 2026,
    },
    'POST',
  );
  await db.employee.create({
    data: {
      organizationId: f.orgId,
      employeeNo: 'QA-LEGACY',
      name: 'Missing end date QA',
      status: 'INACTIVE',
      joinDate: new Date('2026-01-01'),
    },
  });
  await page.goto('/hr/payroll-run');
  await page
    .getByText('Payroll employee setup pre-check', { exact: true })
    .click();
  await page.getByLabel('Payroll pre-check month').fill('1');
  await page.getByLabel('Payroll pre-check year').fill('2027');
  await expect(
    page.getByRole('link', { name: /PTKP rollover QA/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Missing end date QA/ }),
  ).toBeVisible();
  await expect(
    page.getByText('Employees needing PTKP confirmation for 2027: 1', {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await db.employee.findUniqueOrThrow({ where: { id: employee.id } }))
      .ptkpYear,
  ).toBe(2026);
  await page.goto('/hr/leave');
  await page.getByRole('button', { name: 'Leave Types', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add Leave Type', exact: true })
    .click();
  await page.getByLabel('Leave type name').fill('Marriage QA');
  await page.getByLabel('Leave type category').selectOption('OTHER');
  await expect(
    page.getByRole('button', { name: 'Add', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Other leave payroll treatment').selectOption('true');
  const save = page.waitForResponse(
    (r) => r.url().endsWith('/leave-types') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const response = await save;
  expect(response.status(), await response.text()).toBe(201);
  expect(
    await db.leaveType.findFirstOrThrow({
      where: { organizationId: f.orgId, name: 'Marriage QA' },
    }),
  ).toMatchObject({ category: 'OTHER', isPaid: true });
  await expect(
    page.getByRole('row').filter({ hasText: 'Marriage QA' }),
  ).toContainText('Paid');
});

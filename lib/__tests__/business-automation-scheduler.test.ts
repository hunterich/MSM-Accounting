import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  organizations: vi.fn(), invoices: vi.fn(), bills: vi.fn(), subscriptions: vi.fn(), queue: vi.fn(), deliver: vi.fn(), schedule: vi.fn(),
}));
vi.mock('../prisma', () => ({ prisma: { organization: { findMany: mocks.organizations } } }));
vi.mock('../recurring-invoices', () => ({ runDueRecurringInvoices: mocks.invoices }));
vi.mock('../recurring-bills', () => ({ runDueRecurringBills: mocks.bills }));
vi.mock('../subscription-billing', () => ({ runDueSubscriptions: mocks.subscriptions }));
vi.mock('../finance-notifications', () => ({ queueFinanceNotifications: mocks.queue, deliverFinanceNotifications: mocks.deliver }));
vi.mock('node-cron', () => ({ default: { schedule: mocks.schedule } }));
import { initBusinessAutomationScheduler, runBusinessAutomation } from '../business-automation-scheduler';

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [mocks.invoices, mocks.bills, mocks.subscriptions]) mock.mockResolvedValue({ errors: [] });
  mocks.queue.mockResolvedValue(undefined); mocks.deliver.mockResolvedValue(undefined);
});

it('does not initialize jobs during builds or without explicit enablement', async () => {
  vi.stubEnv('BUSINESS_AUTOMATION_ENABLED', 'false');
  await initBusinessAutomationScheduler();
  vi.stubEnv('BUSINESS_AUTOMATION_ENABLED', 'true');
  vi.stubEnv('NEXT_PHASE', 'phase-production-build');
  await initBusinessAutomationScheduler();
  expect(mocks.schedule).not.toHaveBeenCalled();
  expect(mocks.organizations).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});

it('respects feature switches and isolates failures between jobs and companies', async () => {
  mocks.organizations.mockResolvedValue([{ id: 'A', features: { recurringInvoices: false } }, { id: 'B', features: {} }]);
  mocks.bills.mockRejectedValueOnce(new Error('locked period'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await runBusinessAutomation(new Date('2026-10-08'));
  expect(mocks.invoices).toHaveBeenCalledTimes(1);
  expect(mocks.invoices.mock.calls[0][0]).toBe('B');
  expect(mocks.bills).toHaveBeenCalledTimes(2);
  expect(mocks.subscriptions).toHaveBeenCalledTimes(2);
  expect(mocks.queue).toHaveBeenCalledTimes(2);
  expect(mocks.deliver).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});

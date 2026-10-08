import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from './prisma';
import { runDueRecurringInvoices } from './recurring-invoices';
import { runDueRecurringBills } from './recurring-bills';
import { runDueSubscriptions } from './subscription-billing';
import { normalizeFeatures } from './organization/settings-config';
import { queueFinanceNotifications, deliverFinanceNotifications } from './finance-notifications';

const state = globalThis as typeof globalThis & { businessAutomationTask?: ScheduledTask; businessAutomationRunning?: boolean };

export async function runBusinessAutomation(now = new Date()): Promise<void> {
  const orgs = await prisma.organization.findMany();
  for (const org of orgs) {
    const features = normalizeFeatures(org.features);
    for (const [name, enabled, run] of [
      ['recurring-invoices', features.recurringInvoices, () => runDueRecurringInvoices(org.id, null, now)],
      ['recurring-bills', features.recurringExpenses, () => runDueRecurringBills(org.id, null, now)],
      ['subscriptions', features.subscriptions, () => runDueSubscriptions(org.id, null, now)],
    ] as const) {
      if (!enabled) continue;
      try {
        const result = await run();
        if (result.errors.length) console.error(`[business-automation] ${org.id}/${name}:`, result.errors);
      } catch (error) { console.error(`[business-automation] ${org.id}/${name} failed:`, error); }
    }
    try { await queueFinanceNotifications(org, now); }
    catch (error) { console.error(`[business-automation] ${org.id}/notifications failed:`, error); }
  }
  await deliverFinanceNotifications(now);
}

export async function initBusinessAutomationScheduler(): Promise<void> {
  // Explicit opt-in on a long-lived API container; imports during dev/build/tests must not create documents.
  if (process.env.BUSINESS_AUTOMATION_ENABLED !== 'true' || process.env.NEXT_PHASE === 'phase-production-build') return;
  if (state.businessAutomationTask) return;
  const run = async () => {
    if (state.businessAutomationRunning) return;
    state.businessAutomationRunning = true;
    try { await runBusinessAutomation(); }
    catch (error) { console.error('[business-automation] sweep failed:', error); }
    finally { state.businessAutomationRunning = false; }
  };
  state.businessAutomationTask = cron.schedule('*/15 * * * *', () => { void run(); }, { timezone: 'Asia/Jakarta' });
  void run();
}

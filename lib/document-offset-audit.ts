import type { Prisma } from '@prisma/client';
import { listPartyControlAccountIds } from './control-account-guard';
import { loadOrgAccountDefaults, resolveAccountDefaultId } from './account-defaults';

/** Stored selections plus recorded GL evidence for review, never a balancing calculation. */
export async function auditDocumentOffsets(tx: Prisma.TransactionClient, organizationId: string) {
  const controls = await listPartyControlAccountIds(tx, organizationId);
  const accounts = await tx.account.findMany({ where: { organizationId } });
  const byId = new Map(accounts.map(account => [account.id, account]));
  const findings: Array<{ documentType: string; documentId: string; number: string; status: string; field: string; accountId: string; reason: string; journalIds: string[] }> = [];
  function inspect(doc: { id: string; number: string; status: string }, documentType: string, field: string, accountId: string | null, journalIds: string[]) {
    if (!accountId) return;
    const account = byId.get(accountId);
    const reason = !account ? 'not owned by company or missing' : controls.has(accountId) ? 'designated AR/AP control'
      : !account.isActive ? 'inactive' : !account.isPostable ? 'not postable' : null;
    if (reason) findings.push({ documentType, documentId: doc.id, number: doc.number, status: doc.status, field, accountId, reason, journalIds });
  }
  const bills = await tx.bill.findMany({ where: { organizationId }, include: { lines: true, charges: true }, orderBy: { id: 'asc' } });
  for (const doc of bills) {
    const ids = doc.journalEntryId ? [doc.journalEntryId] : [];
    for (const line of doc.lines) inspect(doc, 'BILL', `line:${line.lineNo}`, line.accountId, ids);
    for (const charge of doc.charges) inspect(doc, 'BILL', `charge:${charge.lineNo}`, charge.accountId, ids);
  }
  const invoices = await tx.salesInvoice.findMany({ where: { organizationId }, include: { charges: true }, orderBy: { id: 'asc' } });
  for (const doc of invoices) for (const charge of doc.charges) inspect(doc, 'INVOICE', `charge:${charge.lineNo}`, charge.accountId, doc.postingJournalIds);
  const adjustments = await tx.stockAdjustment.findMany({ where: { organizationId }, include: { lines: true }, orderBy: { id: 'asc' } });
  for (const doc of adjustments) {
    // This legacy document family identifies GL through its exact existing memo.
    const journals = await tx.journalEntry.findMany({ where: { organizationId, memo: `Stock adjustment: ${doc.number}` }, select: { id: true } });
    for (const line of doc.lines) inspect(doc, 'STOCK_ADJUSTMENT', `line:${line.lineNo}`, line.accountId, journals.map(row => row.id));
  }
  const journalIds = [...new Set(findings.flatMap(row => row.journalIds))];
  const recordedControlLines = journalIds.length ? await tx.journalLine.findMany({ where: { entryId: { in: journalIds }, accountId: { in: [...controls] }, entry: { organizationId } },
    select: { entryId: true, accountId: true, description: true, debit: true, credit: true }, orderBy: [{ entryId: 'asc' }, { id: 'asc' }] }) : [];
  const settings = await loadOrgAccountDefaults(tx, organizationId);
  const variance = resolveAccountDefaultId(accounts, settings, 'inventoryAdjustment') || resolveAccountDefaultId(accounts, settings, 'cogsExpense');
  return { organizationId, documentsReviewed: bills.length + invoices.length + adjustments.length, findings, recordedControlLines,
    defaultVarianceIsPartyControl: !!variance && controls.has(variance),
    limitations: ['Selections identify review candidates, not a quantified reconciliation difference.', 'Stock adjustment line selections are currently stored; posting uses the configured variance default.', 'Legacy invoice journals without recorded posting IDs require separate historical review.', 'Independent per-control reconciliation remains issue #167.'] };
}

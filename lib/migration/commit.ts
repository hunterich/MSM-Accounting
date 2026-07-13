/**
 * Migration commit writer.
 *
 * A migration seeds a company from Accurate Online as a clean cutover. The
 * opening (trial-balance) journal sets ALL GL account balances ONCE. Open AR
 * invoices, open AP bills, and opening stock are created as DETAIL ONLY — they
 * must NOT post additional GL, or the control accounts double-count against the
 * opening journal.
 *
 * The commit is reconcile-gated: `reconcileMigration` runs BEFORE any write, and
 * a failing reconcile writes nothing. Every created record is stamped with
 * `migrationBatchId`, and all writes happen inside a single `prisma.$transaction`.
 * After commit, the live Trial Balance as-of the cutover date equals the
 * imported trial balance.
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  loadOrgAccountDefaults,
  resolveAccountDefaultId,
  type AccountDefaultKey,
} from '@/lib/account-defaults';
import { postOpeningStockIfNeeded } from '@/lib/inventory-opening';
import { asMoney } from '@/lib/money';
import { getBatch } from './batch-service';
import { reconcileMigration, type ReconcileResult, type ReconcileInput } from './reconcile';
import {
  AccountRow,
  CustomerRow,
  VendorRow,
  ItemRow,
  OpeningJournalRow,
  OpeningInvoiceRow,
  OpeningBillRow,
} from './schemas';

type Tx = Prisma.TransactionClient;

type AccountRowT = z.infer<typeof AccountRow>;
type CustomerRowT = z.infer<typeof CustomerRow>;
type VendorRowT = z.infer<typeof VendorRow>;
type ItemRowT = z.infer<typeof ItemRow>;
type OpeningJournalRowT = z.infer<typeof OpeningJournalRow>;
type OpeningInvoiceRowT = z.infer<typeof OpeningInvoiceRow>;
type OpeningBillRowT = z.infer<typeof OpeningBillRow>;

interface StagedData {
  accounts?: AccountRowT[];
  customers?: CustomerRowT[];
  vendors?: VendorRowT[];
  items?: ItemRowT[];
  'opening-journal'?: OpeningJournalRowT[];
  'opening-invoices'?: OpeningInvoiceRowT[];
  'opening-bills'?: OpeningBillRowT[];
}

export interface ControlCodes {
  AR: string;
  AP: string;
  INVENTORY: string;
  OPENING_EQUITY: string;
}

/**
 * Resolve the org's control-account CODES (the reconcile engine works in codes).
 * Uses the real `account-defaults` API; throws if any required default is unset,
 * because a migration cannot reconcile without them.
 */
export async function resolveControlCodes(orgId: string): Promise<ControlCodes> {
  const accounts = await prisma.account.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
  });
  const settings = await loadOrgAccountDefaults(prisma, orgId);

  const codeFor = (key: AccountDefaultKey, label: string): string => {
    const id = resolveAccountDefaultId(accounts, settings, key);
    const account = accounts.find((a) => a.id === id);
    if (!account?.code) {
      throw new Error(
        `Migration requires a ${label} account. Configure the "${key}" account default in Settings before committing.`,
      );
    }
    return account.code;
  };

  return {
    AR: codeFor('arControl', 'Accounts Receivable control'),
    AP: codeFor('apControl', 'Accounts Payable control'),
    INVENTORY: codeFor('inventoryAsset', 'Inventory Asset'),
    OPENING_EQUITY: codeFor('openingBalanceEquity', 'Opening Balance Equity'),
  };
}

const round2 = (n: number) => asMoney(n);

// Only these item types carry inventory value (mirrors STOCKED_TYPES in
// lib/inventory-opening.ts). A non-stocked item with opening stock/value would
// let reconcile count inventory value that no cost layer ever backs.
const STOCKED_ITEM_TYPES = new Set(['PRODUCT', 'RAW_MATERIAL']);

/**
 * Commit a DRAFT migration batch: reconcile first, then write everything in one
 * transaction with every record stamped. Returns `{ committed:false }` without
 * writing when reconciliation fails.
 */
export async function commitBatch(
  orgId: string,
  batchId: string,
  _userId: string | null,
): Promise<{ committed: boolean; reconcile: ReconcileResult }> {
  const batch = await getBatch(orgId, batchId);
  if (!batch) throw new Error('Migration batch not found');
  if (batch.status !== 'DRAFT') {
    throw new Error(`Migration batch is not committable (status: ${batch.status})`);
  }

  const staged = (batch.stagedData ?? {}) as StagedData;
  const accountsRows = staged.accounts ?? [];
  const customerRows = staged.customers ?? [];
  const vendorRows = staged.vendors ?? [];
  const itemRows = staged.items ?? [];
  const journalRows = staged['opening-journal'] ?? [];
  const invoiceRows = staged['opening-invoices'] ?? [];
  const billRows = staged['opening-bills'] ?? [];

  const cutoverDate = batch.cutoverDate;

  // ── Guard: non-stocked items must not carry opening stock/value ──────────────
  // A SERVICE (or other non-stocked) item writes no cost layer, so reconcile
  // would count inventory value that on-hand stock never backs — inventory GL
  // says X while on-hand says 0, yet reconcile passes. Reject before any write.
  const badItems = itemRows.filter(
    (i) =>
      !STOCKED_ITEM_TYPES.has(i.type) && ((i.openingStock ?? 0) > 0 || (i.openingValue ?? 0) > 0),
  );
  if (badItems.length > 0) {
    const names = badItems.map((i) => `${i.name} (${i.type})`).join(', ');
    throw new Error(
      `Non-stocked items cannot carry opening stock or value: ${names}. ` +
        `Only PRODUCT and RAW_MATERIAL items hold inventory.`,
    );
  }

  // ── Reconcile BEFORE any write ──────────────────────────────────────────────
  const codes = await resolveControlCodes(orgId);
  const reconcileInput: ReconcileInput = {
    controlCodes: { ar: codes.AR, ap: codes.AP, inventory: codes.INVENTORY },
    trialBalance: journalRows.map((l) => ({
      accountCode: l.accountCode,
      debit: l.debit ?? 0,
      credit: l.credit ?? 0,
    })),
    openAr: invoiceRows.map((i) => ({ amount: i.amount })),
    openAp: billRows.map((b) => ({ amount: b.amount })),
    openingStock: itemRows.map((i) => ({ value: i.openingValue ?? 0 })),
  };
  const reconcile = reconcileMigration(reconcileInput);
  if (!reconcile.ok) {
    return { committed: false, reconcile };
  }

  // ── All-or-nothing write ────────────────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    // Re-check status inside the transaction so a concurrent double-commit loses
    // cleanly here instead of blowing up on a journal-number unique violation.
    const fresh = await tx.migrationBatch.findUnique({
      where: { id: batchId },
      select: { status: true },
    });
    if (!fresh || fresh.status !== 'DRAFT') {
      throw new Error(
        `Migration batch is no longer committable (status: ${fresh?.status ?? 'MISSING'})`,
      );
    }

    const summary: Record<string, number> = {
      accounts: 0,
      customers: 0,
      vendors: 0,
      items: 0,
      openingJournalLines: 0,
      openingInvoices: 0,
      openingBills: 0,
    };

    // Accounts — flat (parent linking is Task 7), stamped, skip existing codes.
    for (const row of accountsRows) {
      const existing = await tx.account.findFirst({
        where: { organizationId: orgId, code: row.code },
        select: { id: true },
      });
      if (existing) continue;
      const normalSide = row.type === 'ASSET' || row.type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
      await tx.account.create({
        data: {
          organizationId: orgId,
          code: row.code,
          name: row.name,
          type: row.type,
          normalSide,
          isActive: true,
          isPostable: true,
          migrationBatchId: batchId,
        },
      });
      summary.accounts += 1;
    }

    // Customers — stamped.
    const customerSeq = await tx.customer.count({ where: { organizationId: orgId } });
    let custIdx = 0;
    for (const row of customerRows) {
      await tx.customer.create({
        data: {
          organizationId: orgId,
          code: `CUST-${String(customerSeq + (++custIdx)).padStart(6, '0')}`,
          name: row.name,
          email: row.email || null,
          phone: row.phone || null,
          billingAddress: row.address || null,
          migrationBatchId: batchId,
        },
      });
      summary.customers += 1;
    }

    // Vendors — stamped.
    const vendorSeq = await tx.vendor.count({ where: { organizationId: orgId } });
    let venIdx = 0;
    for (const row of vendorRows) {
      await tx.vendor.create({
        data: {
          organizationId: orgId,
          code: `VEND-${String(vendorSeq + (++venIdx)).padStart(6, '0')}`,
          name: row.name,
          email: row.email || null,
          phone: row.phone || null,
          npwp: row.npwp || null,
          migrationBatchId: batchId,
        },
      });
      summary.vendors += 1;
    }

    // Items — stamped. Opening stock writes lots ONLY (postGl:false); the opening
    // journal below already carries the inventory-asset balance.
    for (const row of itemRows) {
      const openingStock = row.openingStock ?? 0;
      const createdItem = await tx.item.create({
        data: {
          organizationId: orgId,
          name: row.name,
          sku: row.sku || row.name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 32),
          type: row.type,
          unit: row.unit,
          sellingPrice: row.salePrice,
          costPrice:
            row.openingValue != null && openingStock
              ? row.openingValue / openingStock
              : row.purchasePrice,
          openingStock,
          migrationBatchId: batchId,
        },
      });
      if (openingStock > 0) {
        // postGl:false — lots + perpetual ledger only, NO inventory journal.
        await postOpeningStockIfNeeded(tx, orgId, createdItem.id, cutoverDate, { postGl: false });
        // Stamp the freshly-created lot + ledger rows. addCostLayer leaves
        // migrationBatchId null; Task 6 rollback deletes inventory by
        // migrationBatchId, so unstamped rows would orphan as phantom stock.
        // Safe: the item is brand-new here, so all its inventory rows are ours.
        await tx.inventoryLot.updateMany({
          where: { organizationId: orgId, itemId: createdItem.id },
          data: { migrationBatchId: batchId },
        });
        await tx.inventoryLedgerEntry.updateMany({
          where: { organizationId: orgId, itemId: createdItem.id },
          data: { migrationBatchId: batchId },
        });
      }
      summary.items += 1;
    }

    // Opening balance journal — the ONE and only GL posting. Stamped, dated at
    // the cutover, source OPENING, status POSTED.
    if (journalRows.length > 0) {
      const accounts = await tx.account.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, code: true },
      });
      const codeToId = Object.fromEntries(accounts.map((a) => [a.code, a.id]));

      const journalLines: {
        accountId: string;
        debit: number;
        credit: number;
        description: string | null;
        lineNo: number;
      }[] = [];
      let totalDebit = 0;
      let totalCredit = 0;

      for (const line of journalRows) {
        const accountId = codeToId[line.accountCode];
        if (!accountId) {
          throw new Error(`Opening journal references unknown account code ${line.accountCode}`);
        }
        const debit = round2(line.debit ?? 0);
        const credit = round2(line.credit ?? 0);
        if (debit === 0 && credit === 0) continue;
        journalLines.push({
          accountId,
          debit,
          credit,
          description: null,
          lineNo: journalLines.length + 1,
        });
        totalDebit += debit;
        totalCredit += credit;
      }

      totalDebit = round2(totalDebit);
      totalCredit = round2(totalCredit);

      if (journalLines.length > 0) {
        const maxResult = await tx.$queryRaw<Array<{ max_seq: number | null }>>`
          SELECT MAX(CAST(SUBSTRING("entryNo" FROM '^JE-(\\d+)$') AS INTEGER)) AS max_seq
          FROM "JournalEntry"
          WHERE "organizationId" = ${orgId}
            AND "entryNo" LIKE 'JE-%'
        `;
        const nextSeq = Number(maxResult[0]?.max_seq ?? 0) + 1;
        const entryNo = `JE-${String(nextSeq).padStart(6, '0')}`;

        await tx.journalEntry.create({
          data: {
            organizationId: orgId,
            entryNo,
            date: cutoverDate,
            memo: 'Opening Balance Journal (migration)',
            source: 'OPENING',
            status: 'POSTED',
            totalDebit,
            totalCredit,
            postedAt: cutoverDate,
            migrationBatchId: batchId,
            lines: { create: journalLines },
          },
        });
        summary.openingJournalLines = journalLines.length;
      }
    }

    // Opening AR invoices — plain SalesInvoice creates, NO journal. Stamped.
    for (const inv of invoiceRows) {
      const customer = await tx.customer.findFirst({
        where: { organizationId: orgId, name: { equals: inv.customerName, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!customer) {
        throw new Error(`Opening invoice references unknown customer "${inv.customerName}"`);
      }
      const maxInv = await tx.$queryRaw<Array<{ max_seq: number | null }>>`
        SELECT MAX(CAST(SUBSTRING("number" FROM '^INV-(\\d+)$') AS INTEGER)) AS max_seq
        FROM "SalesInvoice"
        WHERE "organizationId" = ${orgId}
          AND "number" LIKE 'INV-%'
      `;
      const nextInvSeq = Number(maxInv[0]?.max_seq ?? 0) + 1;
      const invNumber = inv.invoiceNumber || `INV-${String(nextInvSeq).padStart(6, '0')}`;

      await tx.salesInvoice.create({
        data: {
          organizationId: orgId,
          number: invNumber,
          customerId: customer.id,
          issueDate: inv.issueDate ? new Date(inv.issueDate) : cutoverDate,
          dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
          status: 'SENT',
          subtotal: inv.amount,
          totalAmount: inv.amount,
          taxEnabled: false,
          notes: 'Opening balance invoice (migration)',
          migrationBatchId: batchId,
          lines: {
            create: [
              {
                lineNo: 1,
                description: 'Opening balance',
                quantity: 1,
                unit: 'LOT',
                price: inv.amount,
                lineSubtotal: inv.amount,
              },
            ],
          },
        },
      });
      summary.openingInvoices += 1;
    }

    // Opening AP bills — plain Bill creates, NO journal. Stamped.
    for (const bill of billRows) {
      const vendor = await tx.vendor.findFirst({
        where: { organizationId: orgId, name: { equals: bill.vendorName, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!vendor) {
        throw new Error(`Opening bill references unknown vendor "${bill.vendorName}"`);
      }
      const maxBill = await tx.$queryRaw<Array<{ max_seq: number | null }>>`
        SELECT MAX(CAST(SUBSTRING("number" FROM '^BILL-(\\d+)$') AS INTEGER)) AS max_seq
        FROM "Bill"
        WHERE "organizationId" = ${orgId}
          AND "number" LIKE 'BILL-%'
      `;
      const nextBillSeq = Number(maxBill[0]?.max_seq ?? 0) + 1;
      const billNumber = bill.billNumber || `BILL-${String(nextBillSeq).padStart(6, '0')}`;

      await tx.bill.create({
        data: {
          organizationId: orgId,
          number: billNumber,
          vendorId: vendor.id,
          issueDate: bill.issueDate ? new Date(bill.issueDate) : cutoverDate,
          dueDate: bill.dueDate ? new Date(bill.dueDate) : null,
          status: 'OPEN',
          subtotal: bill.amount,
          totalAmount: bill.amount,
          notes: 'Opening balance bill (migration)',
          migrationBatchId: batchId,
          lines: {
            create: [
              {
                lineNo: 1,
                description: 'Opening balance',
                quantity: 1,
                unit: 'LOT',
                price: bill.amount,
                lineTotal: bill.amount,
              },
            ],
          },
        },
      });
      summary.openingBills += 1;
    }

    await tx.migrationBatch.update({
      where: { id: batchId },
      data: {
        status: 'COMMITTED',
        summary: summary as Prisma.InputJsonValue,
      },
    });
  });

  return { committed: true, reconcile };
}

/**
 * Organization bootstrap — the single source of truth for what a brand-new
 * company looks like: the standard Indonesian chart of accounts, the default
 * warehouse, the three template roles + permission matrices, and twelve OPEN
 * accounting periods for the fiscal year.
 *
 * `prisma/seed.ts` imports the constants below for the demo org (so the seed
 * and the in-app "New Company" wizard can never drift), and
 * `POST /api/v1/organizations` runs `bootstrapOrganization` inside a
 * transaction to create a company that is ready to post immediately.
 */
import { ModuleKey, RoleType, type InvoiceAccessScope, type Prisma } from '@prisma/client';

export const ALL_MODULE_KEYS: ModuleKey[] = [
  ModuleKey.DASHBOARD,
  ModuleKey.GL_COA,
  ModuleKey.GL_JOURNAL,
  ModuleKey.AR_INVOICES,
  ModuleKey.AR_SALES_ORDERS,
  ModuleKey.AR_PAYMENTS,
  ModuleKey.AR_CREDITS,
  ModuleKey.AR_CUSTOMERS,
  ModuleKey.AP_POS,
  ModuleKey.AP_BILLS,
  ModuleKey.AP_PAYMENTS,
  ModuleKey.AP_DEBITS,
  ModuleKey.AP_VENDORS,
  ModuleKey.INV_ITEMS,
  ModuleKey.INV_CATEGORIES,
  ModuleKey.INV_ADJ,
  ModuleKey.HR_EMPLOYEES,
  ModuleKey.HR_ATTENDANCE,
  ModuleKey.HR_PAYROLL,
  ModuleKey.BANKING,
  ModuleKey.INTEGRATIONS,
  ModuleKey.REPORTS,
  ModuleKey.COMPANY,
  ModuleKey.SETTINGS,
  ModuleKey.SYSTEM_BACKUP,
];

/* ------------------------------------------------------------------ */
/* Standard chart of accounts (Indonesian SME template)                */
/* ------------------------------------------------------------------ */

type StandardAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
type StandardNormalSide = 'DEBIT' | 'CREDIT';

export interface StandardRootAccount {
  code: string;
  name: string;
  type: StandardAccountType;
  normalSide: StandardNormalSide;
}

export interface StandardChildAccount extends StandardRootAccount {
  parentCode: string;
}

// normalSide: DEBIT for ASSET/EXPENSE, CREDIT for LIABILITY/EQUITY/REVENUE
export const STANDARD_ROOT_ACCOUNTS: readonly StandardRootAccount[] = [
  { code: '1-0000', name: 'Current Assets',      type: 'ASSET',     normalSide: 'DEBIT'  },
  { code: '2-0000', name: 'Current Liabilities',  type: 'LIABILITY', normalSide: 'CREDIT' },
  { code: '3-0000', name: 'Equity',              type: 'EQUITY',    normalSide: 'CREDIT' },
  { code: '4-0000', name: 'Revenue',             type: 'REVENUE',   normalSide: 'CREDIT' },
  { code: '5-0000', name: 'Operating Expenses',  type: 'EXPENSE',   normalSide: 'DEBIT'  },
] as const;

// Child accounts (pass 1 — non-grandchildren)
export const STANDARD_CHILD_ACCOUNTS: readonly StandardChildAccount[] = [
  { code: '1-1000', name: 'Cash and Bank',        type: 'ASSET',     normalSide: 'DEBIT',  parentCode: '1-0000' },
  { code: '1-1200', name: 'Accounts Receivable',   type: 'ASSET',     normalSide: 'DEBIT',  parentCode: '1-0000' },
  { code: '1-1300', name: 'Inventory',             type: 'ASSET',     normalSide: 'DEBIT',  parentCode: '1-0000' },
  { code: '2-1000', name: 'Accounts Payable',      type: 'LIABILITY', normalSide: 'CREDIT', parentCode: '2-0000' },
  { code: '2-1100', name: 'Tax Payable (PPN)',     type: 'LIABILITY', normalSide: 'CREDIT', parentCode: '2-0000' },
  { code: '3-1000', name: 'Retained Earnings',     type: 'EQUITY',    normalSide: 'CREDIT', parentCode: '3-0000' },
  { code: '3-9000', name: 'Opening Balance Equity', type: 'EQUITY',   normalSide: 'CREDIT', parentCode: '3-0000' },
  { code: '4-1000', name: 'Sales Revenue',         type: 'REVENUE',   normalSide: 'CREDIT', parentCode: '4-0000' },
  { code: '5-1000', name: 'Cost of Goods Sold',    type: 'EXPENSE',   normalSide: 'DEBIT',  parentCode: '5-0000' },
  { code: '5-1100', name: 'Salaries Expense',      type: 'EXPENSE',   normalSide: 'DEBIT',  parentCode: '5-0000' },

  // Note the AR/AP asymmetry, which is deliberate: a sales return charges the
  // P&L (the credit note posts DR arReturn / CR A/R), whereas a purchase return
  // only *clears* — stock removal posts DR apReturn / CR Inventory and the debit
  // note posts DR A/P / CR apReturn, netting to zero. So arReturn is an expense
  // and apReturn is an asset clearing account, sibling to GR/IR on the AP side.
  //
  // Accounts every trading company eventually posts to. Without them the
  // account-default resolver (lib/account-defaults.ts) finds no candidate for
  // these roles and falls back to its last resort — "first account of an
  // allowed type" — which silently posted purchase returns and input tax to
  // Cash and Bank. Each name below is chosen to match that resolver's existing
  // keywords, so the binding needs no configuration; a company that wants a
  // different account can still override it in Settings.
  { code: '1-1400', name: 'Prepaid Tax (PPN Masukan)',        type: 'ASSET',     normalSide: 'DEBIT',  parentCode: '1-0000' },
  { code: '1-1500', name: 'Purchase Returns Clearing',        type: 'ASSET',     normalSide: 'DEBIT',  parentCode: '1-0000' },
  { code: '2-1200', name: 'Goods Received Not Invoiced (GR/IR)', type: 'LIABILITY', normalSide: 'CREDIT', parentCode: '2-0000' },
  { code: '2-1300', name: 'Withholding Tax Payable (PPh)',    type: 'LIABILITY', normalSide: 'CREDIT', parentCode: '2-0000' },
  { code: '4-1200', name: 'Sales Discount',                   type: 'REVENUE',   normalSide: 'CREDIT', parentCode: '4-0000' },
  { code: '4-9100', name: 'Late Fee Income',                  type: 'REVENUE',   normalSide: 'CREDIT', parentCode: '4-0000' },
  { code: '4-9200', name: 'Purchase Discount Income',         type: 'REVENUE',   normalSide: 'CREDIT', parentCode: '4-0000' },
  { code: '5-1900', name: 'Inventory Variance',               type: 'EXPENSE',   normalSide: 'DEBIT',  parentCode: '5-0000' },
  { code: '5-2000', name: 'Sales Returns',                    type: 'EXPENSE',   normalSide: 'DEBIT',  parentCode: '5-0000' },
  { code: '5-3000', name: 'Sales Discount Expense',           type: 'EXPENSE',   normalSide: 'DEBIT',  parentCode: '5-0000' },
  { code: '5-4000', name: 'Vendor Penalty Expense',           type: 'EXPENSE',   normalSide: 'DEBIT',  parentCode: '5-0000' },
  { code: '5-9000', name: 'Rounding Difference',              type: 'EXPENSE',   normalSide: 'DEBIT',  parentCode: '5-0000' },
] as const;

/* ------------------------------------------------------------------ */
/* Role templates (exactly what prisma/seed.ts produces today)         */
/* ------------------------------------------------------------------ */

export interface RolePermissionTemplate {
  moduleKey: ModuleKey;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}

export interface RoleTemplate {
  name: string;
  roleType: RoleType;
  invoiceAccessScope: InvoiceAccessScope;
  allowedDays: string[];
  startTime: string;
  endTime: string;
  permissions: RolePermissionTemplate[];
}

const fullAccess = (moduleKey: ModuleKey): RolePermissionTemplate => ({
  moduleKey,
  canView: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  canApprove: true,
});

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    name: 'Administrator',
    roleType: RoleType.ADMIN,
    invoiceAccessScope: 'ALL',
    allowedDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    startTime: '00:00',
    endTime: '23:59',
    // Full rights on every module (the seed's createMany + all-true updateMany).
    permissions: ALL_MODULE_KEYS.map(fullAccess),
  },
  {
    name: 'POS Operator',
    roleType: RoleType.CUSTOM,
    invoiceAccessScope: 'OWN',
    allowedDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    startTime: '08:00',
    endTime: '22:00',
    permissions: [
      { moduleKey: ModuleKey.POS_RETAIL,  canView: true, canCreate: true, canEdit: true,  canDelete: false, canApprove: false },
      { moduleKey: ModuleKey.AR_INVOICES, canView: true, canCreate: true, canEdit: false, canDelete: false, canApprove: false },
      { moduleKey: ModuleKey.AR_PAYMENTS, canView: true, canCreate: true, canEdit: false, canDelete: false, canApprove: false },
    ],
  },
  {
    name: 'Cashier',
    roleType: RoleType.CUSTOM,
    invoiceAccessScope: 'OWN',
    allowedDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    startTime: '08:00',
    endTime: '18:00',
    // The seed's createMany rows; its per-module updateMany refinements
    // re-assert these exact values, so this matrix IS the net result.
    permissions: [
      { moduleKey: ModuleKey.DASHBOARD,    canView: true, canCreate: false, canEdit: false, canDelete: false, canApprove: false },
      { moduleKey: ModuleKey.AR_INVOICES,  canView: true, canCreate: true,  canEdit: true,  canDelete: false, canApprove: false },
      { moduleKey: ModuleKey.AR_CUSTOMERS, canView: true, canCreate: false, canEdit: false, canDelete: false, canApprove: false },
      { moduleKey: ModuleKey.AR_PAYMENTS,  canView: true, canCreate: true,  canEdit: false, canDelete: false, canApprove: false },
      { moduleKey: ModuleKey.POS_RETAIL,   canView: true, canCreate: true,  canEdit: true,  canDelete: false, canApprove: false },
    ],
  },
] as const;

/* ------------------------------------------------------------------ */
/* bootstrapOrganization                                               */
/* ------------------------------------------------------------------ */

export interface BootstrapOrgInput {
  legalName: string;
  displayName: string;
  npwp?: string | null;
  isPkp?: boolean;
  baseCurrency?: string;   // default 'IDR'
  timezone?: string;       // default 'Asia/Jakarta'
  fiscalYearStart?: Date | null;
}

/** First day (UTC) of the fiscal-start month; defaults to Jan 1 of the current year. */
function normalizeFiscalStart(fiscalYearStart: Date | null | undefined): Date {
  if (fiscalYearStart instanceof Date && !Number.isNaN(fiscalYearStart.getTime())) {
    return new Date(Date.UTC(fiscalYearStart.getUTCFullYear(), fiscalYearStart.getUTCMonth(), 1));
  }
  return new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
}

/**
 * Twelve month-long periods (name `YYYY-MM`) starting at the fiscal start.
 *
 * Exported because company bootstrap is not the only way an org can need them:
 * organizations created before this bootstrap existed have none at all, and
 * `POST /accounting-periods/generate` backfills them from the same definition
 * so a period built here and one built there can never drift.
 */
export function buildFiscalYearPeriods(fiscalStart: Date): Array<{ name: string; startDate: Date; endDate: Date }> {
  const year = fiscalStart.getUTCFullYear();
  const month = fiscalStart.getUTCMonth();
  return Array.from({ length: 12 }, (_, i) => {
    const startDate = new Date(Date.UTC(year, month + i, 1));
    // Last millisecond of the month — matches the accounting-periods convention.
    const endDate = new Date(Date.UTC(year, month + i + 1, 1) - 1);
    const name = `${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, '0')}`;
    return { name, startDate, endDate };
  });
}

/**
 * Create-only bootstrap of a brand-new organization, ready to post immediately.
 * Must run inside a transaction — the caller owns commit/rollback:
 *
 *   prisma.$transaction((tx) => bootstrapOrganization(tx, input, creatorUserId))
 *
 * Creates, in order: the Organization → standard COA (roots then children) →
 * default warehouse WH-MAIN → the three template roles + permissions → twelve
 * OPEN AccountingPeriods for the fiscal year → an active UserOrganization for
 * the creator with the Admin role.
 */
export async function bootstrapOrganization(
  tx: Prisma.TransactionClient,
  input: BootstrapOrgInput,
  creatorUserId: string,
): Promise<{ orgId: string }> {
  const fiscalStart = normalizeFiscalStart(input.fiscalYearStart);

  const org = await tx.organization.create({
    data: {
      legalName: input.legalName,
      displayName: input.displayName,
      npwp: input.npwp ?? null,
      isPkp: input.isPkp ?? false,
      baseCurrency: input.baseCurrency ?? 'IDR',
      timezone: input.timezone ?? 'Asia/Jakarta',
      fiscalYearStart: fiscalStart,
    },
    select: { id: true },
  });

  // Chart of accounts: roots (summary-only), then postable children linked by parent code.
  const accountIdByCode: Record<string, string> = {};
  for (const a of STANDARD_ROOT_ACCOUNTS) {
    const acc = await tx.account.create({
      data: {
        organizationId: org.id,
        code: a.code,
        name: a.name,
        type: a.type,
        normalSide: a.normalSide,
        isActive: true,
        isPostable: false,
      },
      select: { id: true },
    });
    accountIdByCode[a.code] = acc.id;
  }
  for (const a of STANDARD_CHILD_ACCOUNTS) {
    const parentId = accountIdByCode[a.parentCode];
    if (!parentId) throw new Error(`Unknown parent account code: ${a.parentCode}`);
    const acc = await tx.account.create({
      data: {
        organizationId: org.id,
        code: a.code,
        name: a.name,
        type: a.type,
        normalSide: a.normalSide,
        parentId,
        isActive: true,
        isPostable: true,
      },
      select: { id: true },
    });
    accountIdByCode[a.code] = acc.id;
  }

  await tx.warehouse.create({
    data: { organizationId: org.id, code: 'WH-MAIN', name: 'Gudang Utama' },
  });

  let adminRoleId: string | null = null;
  for (const template of ROLE_TEMPLATES) {
    const role = await tx.role.create({
      data: {
        organizationId: org.id,
        name: template.name,
        roleType: template.roleType,
        invoiceAccessScope: template.invoiceAccessScope,
        isActive: true,
        allowedDays: template.allowedDays,
        startTime: template.startTime,
        endTime: template.endTime,
      },
      select: { id: true },
    });
    await tx.rolePermission.createMany({
      data: template.permissions.map((p) => ({ roleId: role.id, ...p })),
    });
    if (template.roleType === RoleType.ADMIN) adminRoleId = role.id;
  }
  if (!adminRoleId) {
    throw new Error('ROLE_TEMPLATES must include an ADMIN role');
  }

  await tx.accountingPeriod.createMany({
    data: buildFiscalYearPeriods(fiscalStart).map((p) => ({
      organizationId: org.id,
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      status: 'OPEN' as const,
    })),
  });

  await tx.userOrganization.create({
    data: {
      userId: creatorUserId,
      organizationId: org.id,
      roleId: adminRoleId,
      isActive: true,
    },
  });

  return { orgId: org.id };
}

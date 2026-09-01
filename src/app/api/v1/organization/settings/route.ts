import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, ok, err, logAudit } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { updateOrganizationSettingsInputSchema } from '@/types/api';
import {
  ACCOUNT_DEFAULT_SPECS,
  isAccountUsableForRole,
  type AccountDefaultKey,
  type AccountDefaultsConfig,
} from '@/lib/account-defaults';
import { normalizeApprovalRequirements } from '@/lib/approval/config';
import {
  parseTransactionDatePolicy,
  DEFAULT_TRANSACTION_DATE_POLICY,
} from '@/lib/transaction-date-policy';
import {
  normalizeFeatures,
  normalizeDocumentNumbering,
  normalizeSalesPolicy,
} from '@/lib/organization/settings-config';

export const runtime = 'nodejs';

type OrganizationSettingsRecord = {
  id: string;
  legalName: string;
  displayName: string;
  npwp: string | null;
  isPkp: boolean;
  baseCurrency: string;
  address: string | null;
  phone: string | null;
  companyEmail: string | null;
  logoUrl: string | null;
  fiscalYearStart: Date | null;
  costingMethod: string | null;
  costingMethodSetAt: Date | null;
  costingMethodSetById: string | null;
  costingMethodEffectiveDate: Date | null;
  accountDefaults: unknown;
  printSettings: unknown;
  approvalRequirements: unknown;
  requireDistinctApproverForAdmins: boolean;
  defaultPaymentTerms: number;
  features: unknown;
  documentNumbering: unknown;
  salesPolicy: unknown;
  transactionDatePolicy: unknown;
};

const DEFAULT_PRINT_SETTINGS = {
  showLogo: true,
  showLetterhead: false,
  accentColor: '#111827',
  density: 'comfortable' as const,
  defaultPaperSize: 'A4' as const,
  showUnitColumn: true,
  showDiscountColumn: false,
  footerText: '',
  termsText: '',
  showSignature: false,
  signatureLabel: '',
  signerName: '',
};

const normalizePrintSettings = (raw: unknown): typeof DEFAULT_PRINT_SETTINGS => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_PRINT_SETTINGS };
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    showLogo: bool(o.showLogo, DEFAULT_PRINT_SETTINGS.showLogo),
    showLetterhead: bool(o.showLetterhead, DEFAULT_PRINT_SETTINGS.showLetterhead),
    accentColor: /^#[0-9A-Fa-f]{6}$/.test(String(o.accentColor)) ? String(o.accentColor) : DEFAULT_PRINT_SETTINGS.accentColor,
    density: (['compact', 'comfortable', 'spacious'].includes(String(o.density)) ? o.density : DEFAULT_PRINT_SETTINGS.density) as typeof DEFAULT_PRINT_SETTINGS.density,
    defaultPaperSize: (['A4', 'A5'].includes(String(o.defaultPaperSize)) ? o.defaultPaperSize : DEFAULT_PRINT_SETTINGS.defaultPaperSize) as typeof DEFAULT_PRINT_SETTINGS.defaultPaperSize,
    showUnitColumn: bool(o.showUnitColumn, DEFAULT_PRINT_SETTINGS.showUnitColumn),
    showDiscountColumn: bool(o.showDiscountColumn, DEFAULT_PRINT_SETTINGS.showDiscountColumn),
    footerText: str(o.footerText, ''),
    termsText: str(o.termsText, ''),
    showSignature: bool(o.showSignature, DEFAULT_PRINT_SETTINGS.showSignature),
    signatureLabel: str(o.signatureLabel, ''),
    signerName: str(o.signerName, ''),
  };
};

const toDateOrNull = (value: unknown): Date | null => {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeAccountDefaults = (raw: unknown): Partial<AccountDefaultsConfig> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Partial<AccountDefaultsConfig> = {};
  for (const key of Object.keys(ACCOUNT_DEFAULT_SPECS) as AccountDefaultKey[]) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.length > 0) out[key] = v;
  }
  return out;
};

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const orgId = requireOrg(req);

  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
  }) as unknown as OrganizationSettingsRecord | null;

  if (!organization) {
    return err('Organization not found', 404);
  }

  return ok({
    ...organization,
    accountDefaults: normalizeAccountDefaults(organization.accountDefaults),
    printSettings: normalizePrintSettings(organization.printSettings),
    approvalRequirements: normalizeApprovalRequirements(organization.approvalRequirements),
    requireDistinctApproverForAdmins: organization.requireDistinctApproverForAdmins ?? false,
    defaultPaymentTerms: organization.defaultPaymentTerms ?? 0,
    features: normalizeFeatures(organization.features),
    documentNumbering: normalizeDocumentNumbering(organization.documentNumbering),
    salesPolicy: normalizeSalesPolicy(organization.salesPolicy),
    transactionDatePolicy: parseTransactionDatePolicy(organization.transactionDatePolicy),
    needsInventoryValuationSetup: !organization.costingMethod,
  });
});

export const PUT = withPermission({ module: 'SETTINGS', action: 'edit' }, async function PUT(req: NextRequest) {
  const orgId = requireOrg(req);
  const userId = req.headers.get('x-user-id');

  const body = await req.json();
  const parsed = updateOrganizationSettingsInputSchema.safeParse({
    ...body,
    costingMethod: typeof body.costingMethod === 'string' ? String(body.costingMethod).trim().toUpperCase() : body.costingMethod,
  });
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message || 'Invalid organization settings payload', 400);
  }
  const updateData: Record<string, unknown> = {};

  if (parsed.data.legalName !== undefined) updateData.legalName = parsed.data.legalName;
  if (parsed.data.displayName !== undefined) updateData.displayName = parsed.data.displayName;
  if (parsed.data.npwp !== undefined) updateData.npwp = parsed.data.npwp?.trim() || null;
  if (parsed.data.isPkp !== undefined) updateData.isPkp = parsed.data.isPkp;
  if (parsed.data.baseCurrency !== undefined) updateData.baseCurrency = parsed.data.baseCurrency;
  if (parsed.data.timezone !== undefined) updateData.timezone = parsed.data.timezone;
  if (parsed.data.locale !== undefined) updateData.locale = parsed.data.locale;
  if (parsed.data.address !== undefined) updateData.address = parsed.data.address?.trim() || null;
  if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone?.trim() || null;
  if (parsed.data.companyEmail !== undefined) updateData.companyEmail = parsed.data.companyEmail?.trim() || null;
  if (parsed.data.logoUrl !== undefined) updateData.logoUrl = parsed.data.logoUrl?.trim() || null;
  if (parsed.data.defaultCreditLimit !== undefined) updateData.defaultCreditLimit = parsed.data.defaultCreditLimit;
  if (parsed.data.enforceCreditLimit !== undefined) updateData.enforceCreditLimit = parsed.data.enforceCreditLimit;
  if (parsed.data.taxEnabled !== undefined) updateData.taxEnabled = parsed.data.taxEnabled;
  if (parsed.data.taxDefaultRate !== undefined) updateData.taxDefaultRate = parsed.data.taxDefaultRate;
  if (parsed.data.taxInclusiveByDefault !== undefined) updateData.taxInclusiveByDefault = parsed.data.taxInclusiveByDefault;
  if (parsed.data.financeEmail !== undefined) updateData.financeEmail = parsed.data.financeEmail?.trim() || null;
  if (parsed.data.invoiceReminders !== undefined) updateData.invoiceReminders = parsed.data.invoiceReminders;
  if (parsed.data.paymentAlerts !== undefined) updateData.paymentAlerts = parsed.data.paymentAlerts;
  if (parsed.data.dailySummary !== undefined) updateData.dailySummary = parsed.data.dailySummary;

  if (parsed.data.fiscalYearStart !== undefined) {
    updateData.fiscalYearStart = toDateOrNull(parsed.data.fiscalYearStart);
  }

  if (parsed.data.costingMethod !== undefined) {
    updateData.costingMethod = parsed.data.costingMethod;
    updateData.costingMethodSetAt = new Date();
    updateData.costingMethodSetById = userId || null;

    const effectiveDate = toDateOrNull(parsed.data.costingMethodEffectiveDate)
      ?? toDateOrNull(parsed.data.fiscalYearStart)
      ?? new Date();
    updateData.costingMethodEffectiveDate = effectiveDate;
  } else if (parsed.data.costingMethodEffectiveDate !== undefined) {
    updateData.costingMethodEffectiveDate = toDateOrNull(parsed.data.costingMethodEffectiveDate);
  }

  if (parsed.data.accountDefaults !== undefined) {
    const incoming = parsed.data.accountDefaults as Record<string, string>;
    const knownKeys = Object.keys(ACCOUNT_DEFAULT_SPECS) as AccountDefaultKey[];
    const sanitized: Partial<AccountDefaultsConfig> = {};
    const accountIdsToValidate: Array<{ key: AccountDefaultKey; accountId: string }> = [];

    for (const [rawKey, rawValue] of Object.entries(incoming)) {
      if (!knownKeys.includes(rawKey as AccountDefaultKey)) continue; // ignore unknown
      const key = rawKey as AccountDefaultKey;
      const trimmed = String(rawValue ?? '').trim();
      if (trimmed === '') {
        sanitized[key] = ''; // explicit clear
      } else {
        sanitized[key] = trimmed;
        accountIdsToValidate.push({ key, accountId: trimmed });
      }
    }

    if (accountIdsToValidate.length > 0) {
      const accountIds = Array.from(new Set(accountIdsToValidate.map((a) => a.accountId)));
      const accounts = await prisma.account.findMany({
        where: { id: { in: accountIds }, organizationId: orgId },
        select: { id: true, code: true, name: true, type: true, isActive: true, isPostable: true },
      });
      const accountMap = new Map(accounts.map((a) => [a.id, a]));
      for (const { key, accountId } of accountIdsToValidate) {
        const account = accountMap.get(accountId);
        if (!isAccountUsableForRole(account, key)) {
          return err(`Invalid account for ${ACCOUNT_DEFAULT_SPECS[key].label}`, 400);
        }
      }
    }

    const existing = normalizeAccountDefaults(
      ((await prisma.organization.findUnique({
        where: { id: orgId },
        select: { accountDefaults: true },
      })) as unknown as { accountDefaults: unknown } | null)?.accountDefaults,
    );
    const merged: Record<string, string> = { ...existing };
    for (const [k, v] of Object.entries(sanitized)) {
      if (v === '' || v == null) {
        delete merged[k];
      } else {
        merged[k] = v;
      }
    }
    updateData.accountDefaults = merged;
  }

  if (parsed.data.printSettings !== undefined) {
    const existing = normalizePrintSettings(
      ((await prisma.organization.findUnique({
        where: { id: orgId },
        select: { printSettings: true },
      })) as unknown as { printSettings: unknown } | null)?.printSettings,
    );
    // Merge incoming over existing, then normalize to drop anything invalid.
    updateData.printSettings = normalizePrintSettings({ ...existing, ...parsed.data.printSettings });
  }

  if (parsed.data.approvalRequirements !== undefined) {
    updateData.approvalRequirements = normalizeApprovalRequirements(parsed.data.approvalRequirements);
  }
  if (parsed.data.requireDistinctApproverForAdmins !== undefined) {
    updateData.requireDistinctApproverForAdmins = !!parsed.data.requireDistinctApproverForAdmins;
  }

  if (parsed.data.defaultPaymentTerms !== undefined) {
    updateData.defaultPaymentTerms = parsed.data.defaultPaymentTerms;
  }
  if (parsed.data.features !== undefined) {
    updateData.features = normalizeFeatures(parsed.data.features);
  }
  if (parsed.data.transactionDatePolicy !== undefined) {
    // Store the parsed shape, not the raw input: `parseTransactionDatePolicy`
    // is the same function the guard reads through, so what is saved is exactly
    // what will be enforced — a policy cannot be stored in a state the guard
    // would interpret differently.
    updateData.transactionDatePolicy = parseTransactionDatePolicy({
      ...DEFAULT_TRANSACTION_DATE_POLICY,
      ...parsed.data.transactionDatePolicy,
    });
  }

  if (parsed.data.salesPolicy !== undefined) {
    updateData.salesPolicy = normalizeSalesPolicy(parsed.data.salesPolicy);
  }
  if (parsed.data.documentNumbering !== undefined) {
    const existing = normalizeDocumentNumbering(
      ((await prisma.organization.findUnique({
        where: { id: orgId },
        select: { documentNumbering: true },
      })) as unknown as { documentNumbering: unknown } | null)?.documentNumbering,
    );
    // Merge incoming per-doc edits over existing, then normalize.
    const merged: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(parsed.data.documentNumbering)) {
      merged[k] = { ...((existing as Record<string, unknown>)[k] as object), ...(v as object) };
    }
    updateData.documentNumbering = normalizeDocumentNumbering(merged);
  }

  if (Object.keys(updateData).length === 0) {
    return err('No changes provided', 400);
  }

  if (parsed.data.invoiceReminders || parsed.data.paymentAlerts || parsed.data.dailySummary) {
    if (!String(updateData.financeEmail || '').trim()) {
      return err('Finance notification email is required when notifications are enabled', 400);
    }
  }

  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: updateData,
  }) as unknown as OrganizationSettingsRecord;

  logAudit({
    orgId,
    actorId: userId,
    entityType: 'Organization',
    entityId: updated.id,
    action: 'UPDATE',
    payload: updateData,
  });

  return ok({
    ...updated,
    accountDefaults: normalizeAccountDefaults(updated.accountDefaults),
    printSettings: normalizePrintSettings(updated.printSettings),
    approvalRequirements: normalizeApprovalRequirements(updated.approvalRequirements),
    requireDistinctApproverForAdmins: updated.requireDistinctApproverForAdmins ?? false,
    defaultPaymentTerms: updated.defaultPaymentTerms ?? 0,
    features: normalizeFeatures(updated.features),
    documentNumbering: normalizeDocumentNumbering(updated.documentNumbering),
    salesPolicy: normalizeSalesPolicy(updated.salesPolicy),
    needsInventoryValuationSetup: !updated.costingMethod,
  });
});

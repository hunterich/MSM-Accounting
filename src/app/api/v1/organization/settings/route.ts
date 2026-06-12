import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, ok, err, logAudit } from '@/lib/api-utils';
import { updateOrganizationSettingsInputSchema } from '@/types/api';
import {
  ACCOUNT_DEFAULT_SPECS,
  isAccountUsableForRole,
  type AccountDefaultKey,
  type AccountDefaultsConfig,
} from '@/lib/account-defaults';

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
    needsInventoryValuationSetup: !organization.costingMethod,
  });
});

export const PUT = withHandler(async function PUT(req: NextRequest) {
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
    needsInventoryValuationSetup: !updated.costingMethod,
  });
});

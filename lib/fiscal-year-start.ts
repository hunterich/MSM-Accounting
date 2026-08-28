/**
 * Which fiscal year an operation acts on.
 *
 * Defaults to the company's own `fiscalYearStart` — the same source
 * `POST /accounting-periods/generate` uses, so the year you can close is
 * always the year whose periods exist.
 */
import type { Prisma } from '@prisma/client';

type Db = { organization: Prisma.OrganizationDelegate<never> } | any;

export async function resolveFiscalYearStart(
  db: Db,
  orgId: string,
  override: string | null | undefined,
): Promise<Date | null> {
  if (override) {
    const parsed = new Date(override);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { fiscalYearStart: true },
  });
  return org?.fiscalYearStart ?? null;
}

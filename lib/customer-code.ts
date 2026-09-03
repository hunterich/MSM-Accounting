/**
 * Next customer code for a prefix — `CST-0001`, `CST-0002`, …
 *
 * The customer form used to compute this from the customers it had loaded,
 * which is the first page of twenty, so the "next" code was already taken as
 * soon as a company had more customers than that and every save failed with
 * "Duplicate record". The sequence is now read over the whole organisation
 * here, and the form asks for it via `/api/v1/customers/next-code`.
 */
import type { Prisma } from '@prisma/client';

/** Prefix used when the customer has no category, or its category has none. */
export const DEFAULT_CUSTOMER_CODE_PREFIX = 'CST';

const PREFIX_PATTERN = /^[A-Za-z0-9]{1,10}$/;

export function isValidCustomerCodePrefix(prefix: string): boolean {
  return PREFIX_PATTERN.test(prefix);
}

/** Pure step: the code after the highest `PREFIX-nnnn` already in `codes`. */
export function nextCodeAfter(codes: readonly string[], prefix: string): string {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}-(\\d+)$`, 'i');
  let max = 0;
  for (const code of codes) {
    const m = String(code ?? '').match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

type CustomerDb = Pick<Prisma.TransactionClient, 'customer'>;

/** The next free code for `prefix` across every customer of the organisation. */
export async function nextCustomerCode(db: CustomerDb, orgId: string, prefix: string): Promise<string> {
  const rows = await db.customer.findMany({
    where: { organizationId: orgId, code: { startsWith: `${prefix}-`, mode: 'insensitive' } },
    select: { code: true },
  });
  return nextCodeAfter(rows.map((r) => r.code), prefix);
}

/**
 * Sequential per-org invoice number generation (`INV-NNNNNN`).
 *
 * Extracted verbatim from `src/app/api/v1/invoices/route.ts` so the marketplace
 * import orchestrator allocates numbers through the SAME advisory-locked
 * max-sequence mechanism the UI route uses — no parallel numbering scheme.
 * Must run inside a `$transaction` (the advisory lock is transaction-scoped).
 */
import type { Prisma } from '@prisma/client';

const INVOICE_PREFIX = 'INV';
const INVOICE_DIGITS = 6;
const INVOICE_REGEX_SOURCE = '^INV-(\\d+)$';

// FNV-1a 32-bit hash — significantly better distribution than the naive * 31
// approach, reducing advisory lock collisions across organizations.
const hashLockKey = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash || 1;
};

const getCurrentInvoiceSequence = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<number> => {
  const rows = await tx.$queryRaw<Array<{ max_seq: number | null }>>`
    SELECT MAX(CAST(SUBSTRING("number" FROM ${INVOICE_REGEX_SOURCE}) AS INTEGER)) AS max_seq
    FROM "SalesInvoice"
    WHERE "organizationId" = ${organizationId}
      AND "number" LIKE ${`${INVOICE_PREFIX}-%`}
  `;

  return Number(rows[0]?.max_seq ?? 0);
};

export const nextInvoiceNumber = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> => {
  const lockKey = hashLockKey(`invoice-seq:${organizationId}`);
  // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void, which
  // $queryRaw cannot deserialize (it 500s every invoice create).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

  const nextSequence = (await getCurrentInvoiceSequence(tx, organizationId)) + 1;
  return `${INVOICE_PREFIX}-${String(nextSequence).padStart(INVOICE_DIGITS, '0')}`;
};

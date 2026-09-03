/**
 * Sequential per-org invoice numbers, shaped by the org's numbering settings
 * (Settings → Document numbering → Sales invoice): prefix, reset period and
 * sequence width. `lib/organization/document-number.ts` is the one formatter,
 * shared with the form's preview, so the number the form shows is the number
 * that gets saved.
 *
 * Every invoice-creating path (the invoices route, sales-order conversion,
 * subscription billing, marketplace import) allocates through here, under the
 * same per-org advisory lock, so there is no parallel numbering scheme. Must
 * run inside a `$transaction` (the advisory lock is transaction-scoped).
 */
import type { Prisma } from '@prisma/client';
import { normalizeDocumentNumbering, type DocNumberingConfig } from './organization/settings-config';
import { documentNumberScope, formatDocumentNumber } from './organization/document-number';

type Db = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw' | 'organization'>;

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

/** The org's sales-invoice numbering config (defaults when never saved). */
export async function loadInvoiceNumbering(db: Db, organizationId: string): Promise<DocNumberingConfig> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { documentNumbering: true },
  });
  return normalizeDocumentNumbering(org?.documentNumbering).ar_invoice;
}

const currentSequence = async (
  db: Db,
  organizationId: string,
  cfg: DocNumberingConfig,
  issueDate: Date,
): Promise<number> => {
  const scope = documentNumberScope(cfg, issueDate);
  const rows = await db.$queryRaw<Array<{ max_seq: number | null }>>`
    SELECT MAX(CAST(SUBSTRING("number" FROM ${scope.regex}) AS INTEGER)) AS max_seq
    FROM "SalesInvoice"
    WHERE "organizationId" = ${organizationId}
      AND "number" LIKE ${scope.like}
  `;
  return Number(rows[0]?.max_seq ?? 0);
};

export interface InvoiceNumberOptions {
  /** Decides the period for monthly/yearly resets. Defaults to now. */
  issueDate?: Date;
}

/**
 * Allocate the next invoice number. Takes the org's invoice-sequence advisory
 * lock for the rest of the transaction, so two concurrent creates cannot get
 * the same number.
 */
export const nextInvoiceNumber = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  opts: InvoiceNumberOptions = {},
): Promise<string> => {
  const lockKey = hashLockKey(`invoice-seq:${organizationId}`);
  // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void, which
  // $queryRaw cannot deserialize (it 500s every invoice create).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

  const issueDate = opts.issueDate ?? new Date();
  const cfg = await loadInvoiceNumbering(tx, organizationId);
  const next = (await currentSequence(tx, organizationId, cfg, issueDate)) + 1;
  return formatDocumentNumber(cfg, next, issueDate);
};

/**
 * The number the next invoice dated `issueDate` would get, for the form's
 * preview. No lock: it is a hint, and a concurrent save may take it first —
 * the save itself always allocates under the lock.
 */
export const peekNextInvoiceNumber = async (
  db: Db,
  organizationId: string,
  opts: InvoiceNumberOptions = {},
): Promise<string> => {
  const issueDate = opts.issueDate ?? new Date();
  const cfg = await loadInvoiceNumbering(db, organizationId);
  const next = (await currentSequence(db, organizationId, cfg, issueDate)) + 1;
  return formatDocumentNumber(cfg, next, issueDate);
};

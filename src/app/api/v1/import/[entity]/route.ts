import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsPreflightResponse } from '@/lib/cors';
import { withHandler, requireOrg, ok, ApiError } from '@/lib/api-utils';
import { z } from 'zod';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

// ── Per-entity row schemas ────────────────────────────────────────────────────

const CustomerRowSchema = z.object({
  name: z.string().min(1, 'name is required'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  npwp: z.string().optional(),
  creditLimit: z.coerce.number().min(0).optional(),
  paymentTerms: z.coerce.number().int().min(0).optional(),
  openingBalance: z.coerce.number().optional(),
});

const VendorRowSchema = z.object({
  name: z.string().min(1, 'name is required'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  npwp: z.string().optional(),
  paymentTerms: z.coerce.number().int().min(0).optional(),
  openingBalance: z.coerce.number().optional(),
});

const ItemRowSchema = z.object({
  name: z.string().min(1, 'name is required'),
  sku: z.string().optional(),
  type: z.enum(['PRODUCT', 'SERVICE']).optional().default('PRODUCT'),
  unit: z.string().optional().default('PCS'),
  salePrice: z.coerce.number().min(0).optional().default(0),
  purchasePrice: z.coerce.number().min(0).optional().default(0),
  trackInventory: z.union([z.boolean(), z.string().transform((v) => v === 'true' || v === '1' || v === 'yes')]).optional().default(true),
  openingStock: z.coerce.number().min(0).optional(),
  openingValue: z.coerce.number().min(0).optional(),
});

const AccountRowSchema = z.object({
  code: z.string().min(1, 'code is required'),
  name: z.string().min(1, 'name is required'),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
  description: z.string().optional(),
});

const OpeningJournalLineSchema = z.object({
  accountCode: z.string().min(1, 'accountCode is required'),
  debit: z.coerce.number().min(0).optional().default(0),
  credit: z.coerce.number().min(0).optional().default(0),
  description: z.string().optional(),
});

const OpeningInvoiceSchema = z.object({
  customerName: z.string().min(1, 'customerName is required'),
  invoiceNumber: z.string().optional(),
  issueDate: z.string().min(1, 'issueDate is required (YYYY-MM-DD)'),
  dueDate: z.string().optional(),
  amount: z.coerce.number().min(0, 'amount must be >= 0'),
  notes: z.string().optional(),
});

const OpeningBillSchema = z.object({
  vendorName: z.string().min(1, 'vendorName is required'),
  billNumber: z.string().optional(),
  issueDate: z.string().min(1, 'issueDate is required (YYYY-MM-DD)'),
  dueDate: z.string().optional(),
  amount: z.coerce.number().min(0, 'amount must be >= 0'),
  notes: z.string().optional(),
});

type ImportEntity = 'customers' | 'vendors' | 'items' | 'accounts' | 'opening-journal' | 'opening-invoices' | 'opening-bills';

const VALID_ENTITIES: ImportEntity[] = ['customers', 'vendors', 'items', 'accounts', 'opening-journal', 'opening-invoices', 'opening-bills'];

// ── Dry-run validation ────────────────────────────────────────────────────────

function validateRows(entity: ImportEntity, rows: unknown[]): { valid: unknown[]; errors: { row: number; message: string }[] } {
  const valid: unknown[] = [];
  const errors: { row: number; message: string }[] = [];

  const schema =
    entity === 'customers' ? CustomerRowSchema :
    entity === 'vendors'   ? VendorRowSchema :
    entity === 'items'     ? ItemRowSchema :
    entity === 'opening-journal' ? OpeningJournalLineSchema :
    entity === 'opening-invoices' ? OpeningInvoiceSchema :
    entity === 'opening-bills' ? OpeningBillSchema :
    AccountRowSchema;

  rows.forEach((row, idx) => {
    const result = schema.safeParse(row);
    if (result.success) {
      valid.push(result.data);
    } else {
      errors.push({ row: idx + 2, message: result.error.issues.map((i) => i.message).join('; ') });
    }
  });

  return { valid, errors };
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  return withHandler(req, async () => {
    const orgId = requireOrg(req);
    const { entity } = await params;

    if (!VALID_ENTITIES.includes(entity as ImportEntity)) {
      throw new ApiError(`Unknown entity: ${entity}. Valid: ${VALID_ENTITIES.join(', ')}`, 400);
    }

    const body = await req.json() as { rows: unknown[]; dryRun?: boolean };
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const dryRun = body.dryRun === true;

    if (rows.length === 0) throw new ApiError('No rows provided', 400);
    if (rows.length > 1000) throw new ApiError('Maximum 1000 rows per import', 400);

    const { valid, errors } = validateRows(entity as ImportEntity, rows);

    if (dryRun || errors.length > 0) {
      return ok({ dryRun: true, valid: valid.length, invalid: errors.length, errors });
    }

    // ── Persist ───────────────────────────────────────────────────────────────

    let created = 0;

    if (entity === 'customers') {
      for (const row of valid as z.infer<typeof CustomerRowSchema>[]) {
        await prisma.customer.create({
          data: {
            organizationId: orgId,
            name: row.name,
            email: row.email || null,
            phone: row.phone || null,
            address: row.address || null,
            npwp: row.npwp || null,
            creditLimit: row.creditLimit ?? 0,
            paymentTerms: row.paymentTerms ?? 30,
            openingBalance: row.openingBalance ?? 0,
          },
        });
        created++;
      }
    }

    if (entity === 'vendors') {
      for (const row of valid as z.infer<typeof VendorRowSchema>[]) {
        await prisma.vendor.create({
          data: {
            organizationId: orgId,
            name: row.name,
            email: row.email || null,
            phone: row.phone || null,
            address: row.address || null,
            npwp: row.npwp || null,
            paymentTerms: row.paymentTerms ?? 30,
            openingBalance: row.openingBalance ?? 0,
          },
        });
        created++;
      }
    }

    if (entity === 'items') {
      for (const row of valid as z.infer<typeof ItemRowSchema>[]) {
        await prisma.item.create({
          data: {
            organizationId: orgId,
            name: row.name,
            sku: row.sku || null,
            type: row.type,
            unit: row.unit,
            salePrice: row.salePrice,
            purchasePrice: row.purchasePrice,
            trackInventory: row.trackInventory as boolean,
            openingStock: row.openingStock ?? 0,
            costPrice: row.openingValue != null && row.openingStock
              ? row.openingValue / row.openingStock
              : row.purchasePrice,
          },
        });
        created++;
      }
    }

    if (entity === 'accounts') {
      for (const row of valid as z.infer<typeof AccountRowSchema>[]) {
        const existing = await prisma.account.findFirst({
          where: { organizationId: orgId, code: row.code },
        });
        if (existing) {
          errors.push({ row: -1, message: `Account code ${row.code} already exists — skipped` });
          continue;
        }
        await prisma.account.create({
          data: {
            organizationId: orgId,
            code: row.code,
            name: row.name,
            type: row.type,
            description: row.description || null,
            isActive: true,
            isPostable: true,
          },
        });
        created++;
      }
    }

    // ── Opening Balance Journal ─────────────────────────────────────────────────
    if (entity === 'opening-journal') {
      const lines = valid as z.infer<typeof OpeningJournalLineSchema>[];
      // Resolve account codes → IDs
      const accounts = await prisma.account.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, code: true },
      });
      const codeToId = Object.fromEntries(accounts.map((a) => [a.code, a.id]));

      const journalLines: { accountId: string; debit: number; credit: number; description: string | null; lineNo: number }[] = [];
      let totalDebit = 0;
      let totalCredit = 0;

      for (const line of lines) {
        const accountId = codeToId[line.accountCode];
        if (!accountId) {
          errors.push({ row: -1, message: `Account code ${line.accountCode} not found — skipped` });
          continue;
        }
        const debit = Math.round((line.debit + Number.EPSILON) * 100) / 100;
        const credit = Math.round((line.credit + Number.EPSILON) * 100) / 100;
        if (debit === 0 && credit === 0) continue;
        journalLines.push({
          accountId,
          debit,
          credit,
          description: line.description || null,
          lineNo: journalLines.length + 1,
        });
        totalDebit += debit;
        totalCredit += credit;
      }

      totalDebit = Math.round((totalDebit + Number.EPSILON) * 100) / 100;
      totalCredit = Math.round((totalCredit + Number.EPSILON) * 100) / 100;

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return ok({
          created: 0,
          skipped: 0,
          errors: [{ row: -1, message: `Journal does not balance: Debit ${totalDebit} vs Credit ${totalCredit} (difference ${Math.abs(totalDebit - totalCredit).toFixed(2)})` }],
        });
      }

      if (journalLines.length > 0) {
        // Generate next journal number
        const maxResult = await prisma.$queryRaw<Array<{ max_seq: number | null }>>`
          SELECT MAX(CAST(SUBSTRING("entryNo" FROM '^JE-(\\d+)$') AS INTEGER)) AS max_seq
          FROM "JournalEntry"
          WHERE "organizationId" = ${orgId}
            AND "entryNo" LIKE 'JE-%'
        `;
        const nextSeq = Number(maxResult[0]?.max_seq ?? 0) + 1;
        const entryNo = `JE-${String(nextSeq).padStart(6, '0')}`;

        await prisma.journalEntry.create({
          data: {
            organizationId: orgId,
            entryNo,
            date: new Date(),
            memo: 'Opening Balance Journal (imported)',
            source: 'OPENING',
            status: 'POSTED',
            totalDebit,
            totalCredit,
            postedAt: new Date(),
            lines: { create: journalLines },
          },
        });
        created = 1;
      }
    }

    // ── Opening AR Invoices (old unpaid invoices) ───────────────────────────────
    if (entity === 'opening-invoices') {
      const invoices = valid as z.infer<typeof OpeningInvoiceSchema>[];

      for (const inv of invoices) {
        // Resolve customer by name
        const customer = await prisma.customer.findFirst({
          where: { organizationId: orgId, name: { equals: inv.customerName, mode: 'insensitive' } },
          select: { id: true },
        });
        if (!customer) {
          errors.push({ row: -1, message: `Customer "${inv.customerName}" not found — skipped` });
          continue;
        }

        // Generate next invoice number
        const maxInv = await prisma.$queryRaw<Array<{ max_seq: number | null }>>`
          SELECT MAX(CAST(SUBSTRING("number" FROM '^INV-(\\d+)$') AS INTEGER)) AS max_seq
          FROM "SalesInvoice"
          WHERE "organizationId" = ${orgId}
            AND "number" LIKE 'INV-%'
        `;
        const nextInvSeq = Number(maxInv[0]?.max_seq ?? 0) + 1;
        const invNumber = inv.invoiceNumber || `INV-${String(nextInvSeq).padStart(6, '0')}`;

        await prisma.salesInvoice.create({
          data: {
            organizationId: orgId,
            number: invNumber,
            customerId: customer.id,
            issueDate: new Date(inv.issueDate),
            dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
            status: 'POSTED',
            subtotal: inv.amount,
            totalAmount: inv.amount,
            taxEnabled: false,
            notes: inv.notes || 'Opening balance invoice (imported)',
            lines: {
              create: [{
                lineNo: 1,
                description: 'Opening balance',
                quantity: 1,
                unit: 'LOT',
                price: inv.amount,
                lineTotal: inv.amount,
              }],
            },
          },
        });
        created++;
      }
    }

    // ── Opening AP Bills (old unpaid bills) ─────────────────────────────────────
    if (entity === 'opening-bills') {
      const bills = valid as z.infer<typeof OpeningBillSchema>[];

      for (const bill of bills) {
        // Resolve vendor by name
        const vendor = await prisma.vendor.findFirst({
          where: { organizationId: orgId, name: { equals: bill.vendorName, mode: 'insensitive' } },
          select: { id: true },
        });
        if (!vendor) {
          errors.push({ row: -1, message: `Vendor "${bill.vendorName}" not found — skipped` });
          continue;
        }

        // Generate next bill number
        const maxBill = await prisma.$queryRaw<Array<{ max_seq: number | null }>>`
          SELECT MAX(CAST(SUBSTRING("number" FROM '^BILL-(\\d+)$') AS INTEGER)) AS max_seq
          FROM "Bill"
          WHERE "organizationId" = ${orgId}
            AND "number" LIKE 'BILL-%'
        `;
        const nextBillSeq = Number(maxBill[0]?.max_seq ?? 0) + 1;
        const billNumber = bill.billNumber || `BILL-${String(nextBillSeq).padStart(6, '0')}`;

        await prisma.bill.create({
          data: {
            organizationId: orgId,
            number: billNumber,
            vendorId: vendor.id,
            issueDate: new Date(bill.issueDate),
            dueDate: bill.dueDate ? new Date(bill.dueDate) : null,
            status: 'APPROVED',
            subtotal: bill.amount,
            totalAmount: bill.amount,
            notes: bill.notes || 'Opening balance bill (imported)',
            lines: {
              create: [{
                lineNo: 1,
                description: 'Opening balance',
                quantity: 1,
                unit: 'LOT',
                price: bill.amount,
                lineTotal: bill.amount,
              }],
            },
          },
        });
        created++;
      }
    }

    return ok({ created, skipped: valid.length - created, errors });
  });
}

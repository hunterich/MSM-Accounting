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
});

const VendorRowSchema = z.object({
  name: z.string().min(1, 'name is required'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  npwp: z.string().optional(),
  paymentTerms: z.coerce.number().int().min(0).optional(),
});

const ItemRowSchema = z.object({
  name: z.string().min(1, 'name is required'),
  sku: z.string().optional(),
  type: z.enum(['PRODUCT', 'SERVICE']).optional().default('PRODUCT'),
  unit: z.string().optional().default('PCS'),
  salePrice: z.coerce.number().min(0).optional().default(0),
  purchasePrice: z.coerce.number().min(0).optional().default(0),
  trackInventory: z.union([z.boolean(), z.string().transform((v) => v === 'true' || v === '1' || v === 'yes')]).optional().default(true),
});

const AccountRowSchema = z.object({
  code: z.string().min(1, 'code is required'),
  name: z.string().min(1, 'name is required'),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
  description: z.string().optional(),
});

type ImportEntity = 'customers' | 'vendors' | 'items' | 'accounts';

const VALID_ENTITIES: ImportEntity[] = ['customers', 'vendors', 'items', 'accounts'];

// ── Dry-run validation ────────────────────────────────────────────────────────

function validateRows(entity: ImportEntity, rows: unknown[]): { valid: unknown[]; errors: { row: number; message: string }[] } {
  const valid: unknown[] = [];
  const errors: { row: number; message: string }[] = [];

  const schema =
    entity === 'customers' ? CustomerRowSchema :
    entity === 'vendors'   ? VendorRowSchema :
    entity === 'items'     ? ItemRowSchema :
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

    return ok({ created, skipped: valid.length - created, errors });
  });
}

/**
 * Shared Zod schemas for API input validation.
 *
 * Helpers:
 *   isoDateString   — non-empty string expected to be a YYYY-MM-DD ISO date
 *   positiveDecimal — number > 0 (accepts decimals)
 *
 * Usage:
 *   import { marketplaceImportInputSchema } from '@/types/api';
 *   const result = marketplaceImportInputSchema.safeParse(body);
 */

import { z } from 'zod';

// ── Shared primitives ─────────────────────────────────────────────────────────

/** Non-empty string representing a YYYY-MM-DD ISO date. */
export const isoDateString = z
  .string()
  .trim()
  .min(1, 'Date is required (YYYY-MM-DD)');

/** Positive decimal (> 0). Accepts fractional values. */
export const positiveDecimal = z
  .number()
  .positive('Must be a positive number');

// ── Marketplace import ────────────────────────────────────────────────────────

/**
 * A single line item within a marketplace order.
 * `itemId` is required — the import is master-only (no unlinked lines allowed).
 */
export const marketplaceImportLineSchema = z.object({
  itemId:      z.string().trim().min(1, 'Every line must map to a master item'),
  description: z.string().trim().min(1),
  sku:         z.string().trim().default(''),
  quantity:    positiveDecimal,
  unitPrice:   positiveDecimal,
});

/** A single marketplace order containing one or more lines. */
export const marketplaceImportOrderSchema = z.object({
  orderNo:   z.string().trim().min(1),
  issueDate: isoDateString,
  lines:     z.array(marketplaceImportLineSchema).min(1),
});

/** Top-level body schema for POST /api/v1/integrations/[id]/import. */
export const marketplaceImportInputSchema = z.object({
  orders:  z.array(marketplaceImportOrderSchema).min(1),
  options: z.object({
    customerId:    z.string().trim().optional(),
    recordPayment: z.boolean().default(true),
  }),
});

// ── Inferred types ────────────────────────────────────────────────────────────

export type MarketplaceImportLine  = z.infer<typeof marketplaceImportLineSchema>;
export type MarketplaceImportOrder = z.infer<typeof marketplaceImportOrderSchema>;
export type MarketplaceImportInput = z.infer<typeof marketplaceImportInputSchema>;

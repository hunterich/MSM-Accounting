import { Prisma } from '@prisma/client';
import { ApiError } from './errors';
import type { BillInput } from '@/types/api';

type Tx = Prisma.TransactionClient;
export async function lockAssetPurchases(tx: Tx, orgId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`asset-purchases:${orgId}`}, 0))`;
}

export async function nextAssetNumber(tx: Tx, orgId: string) {
  await lockAssetPurchases(tx, orgId);
  const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
    SELECT MAX(CAST(SUBSTRING("assetNo" FROM '[0-9]+') AS INTEGER)) AS max
    FROM "Asset" WHERE "organizationId" = ${orgId}`;
  return `ASSET-${String(Number(rows[0]?.max ?? 0) + 1).padStart(6, '0')}`;
}

export function assetLineCost(line: { quantity: unknown; price: unknown; discountPct?: unknown }, tax: { taxable?: boolean; taxInclusive?: boolean; taxRate?: unknown }) {
  const gross = new Prisma.Decimal(String(line.quantity)).mul(new Prisma.Decimal(String(line.price)).toDecimalPlaces(2))
    .mul(new Prisma.Decimal(1).minus(new Prisma.Decimal(String(line.discountPct ?? 0)).div(100))).toDecimalPlaces(2);
  return tax.taxable && tax.taxInclusive
    ? gross.div(new Prisma.Decimal(1).plus(new Prisma.Decimal(String(tax.taxRate ?? 0)).div(100))).toDecimalPlaces(2)
    : gross;
}

/** Runs in the bill transaction. The bill owns cost and the only acquisition journal. */
export async function prepareAssetLines(tx: Tx, orgId: string, billId: string, lines: BillInput['lines'], header: { issueDate: string | Date; taxable?: boolean; taxInclusive?: boolean; taxRate?: unknown }) {
  if (!lines.some(l => l.assetPurchase)) return lines;
  await lockAssetPurchases(tx, orgId);
  const seen = new Set<string>();
  const prepared = [];
  for (const line of lines) {
    const choice = line.assetPurchase;
    if (!choice) { prepared.push(line); continue; }
    if (line.itemId || line.purchaseOrderLineId || Number(line.quantity) !== 1) {
      throw new ApiError('Use one asset per bill line, without an inventory item or purchase-order receipt link.', 422);
    }
    const cost = assetLineCost(line, header);
    if (!cost.greaterThan(0)) throw new ApiError('Asset purchase cost must be greater than zero.', 422);
    let asset = choice.mode === 'LINK' ? await tx.asset.findFirst({
      where: { id: choice.assetId, organizationId: orgId, deletedAt: null }, include: { purchaseLine: true },
    }) : null;
    if (choice.mode === 'LINK' && (!asset || asset.status !== 'DRAFT' || (asset.purchaseLine && asset.purchaseLine.billId !== billId))) {
      throw new ApiError('Choose an unlinked draft asset in this organization.', 422);
    }
    const categoryId = choice.mode === 'CREATE' ? choice.categoryId : asset!.categoryId;
    const category = await tx.assetCategory.findFirst({ where: { id: categoryId, organizationId: orgId } });
    if (!category?.assetAccountId) throw new ApiError('Set a fixed-asset account on the asset category first.', 422);
    const account = await tx.account.findFirst({ where: { id: category.assetAccountId, organizationId: orgId, isActive: true, isPostable: true } });
    if (!account || !['ASSET', 'Asset'].includes(account.type)) throw new ApiError('The category needs an active, postable asset account.', 422);
    const salvage = choice.mode === 'CREATE' ? new Prisma.Decimal(choice.salvageValue ?? cost.mul(category.salvagePercent).div(100)).toDecimalPlaces(2) : asset!.salvageValue;
    if (salvage.greaterThan(cost)) throw new ApiError('Salvage value cannot exceed asset cost.', 422);
    const data = { acquisitionDate: new Date(header.issueDate), acquisitionCost: cost, bookValue: cost };
    if (choice.mode === 'CREATE') {
      asset = await tx.asset.create({ data: { ...data, organizationId: orgId, assetNo: await nextAssetNumber(tx, orgId),
        name: choice.name, categoryId, depreciationMethod: category.depreciationMethod,
        usefulLifeMonths: choice.usefulLifeMonths ?? category.usefulLifeMonths, salvageValue: salvage, serialNumber: choice.serialNumber, status: 'DRAFT' }, include: { purchaseLine: true } });
    } else {
      asset = await tx.asset.update({ where: { id: asset!.id }, data, include: { purchaseLine: true } });
    }
    if (seen.has(asset!.id)) throw new ApiError('An asset can only appear once on a bill.', 422);
    seen.add(asset!.id);
    const gross = assetLineCost(line, { taxable: false });
    prepared.push({ ...line, assetId: asset!.id, accountId: category.assetAccountId, lineTotal: Number(gross) });
  }
  return prepared;
}

import type { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/errors';

type ItemReader = Pick<Prisma.TransactionClient, 'item'>;

/**
 * Reject inactive (or cross-organization) master items on new transaction
 * lines. Historical document workflows deliberately do not use this guard:
 * deactivation stops future selection without breaking returns or receipts.
 */
export async function assertItemsActive(
  db: ItemReader,
  organizationId: string,
  itemIds: Array<string | null | undefined>,
  options: { allowItemIds?: Iterable<string> } = {},
): Promise<void> {
  const allowed = new Set(options.allowItemIds ?? []);
  const requested = Array.from(new Set(itemIds.filter((id): id is string => Boolean(id))))
    .filter((id) => !allowed.has(id));

  if (requested.length === 0) return;

  const items = await db.item.findMany({
    where: { organizationId, id: { in: requested } },
    select: { id: true, sku: true, name: true, isActive: true },
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  const unavailable = requested.filter((id) => !byId.get(id)?.isActive);

  if (unavailable.length === 0) return;

  const labels = unavailable.map((id) => {
    const item = byId.get(id);
    return item ? `${item.sku} — ${item.name}` : id;
  });
  throw new ApiError(
    `Inactive or unavailable item${labels.length === 1 ? '' : 's'} cannot be added to a new transaction: ${labels.join(', ')}`,
    422,
  );
}

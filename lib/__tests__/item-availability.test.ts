import { describe, expect, it, vi } from 'vitest';
import { assertItemsActive } from '@/lib/item-availability';

function itemReader(rows: Array<{ id: string; sku: string; name: string; isActive: boolean }>) {
  return {
    item: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  } as any;
}

describe('assertItemsActive', () => {
  it('accepts active items and de-duplicates ids', async () => {
    const db = itemReader([{ id: 'i1', sku: 'SKU-1', name: 'Item 1', isActive: true }]);

    await expect(assertItemsActive(db, 'org-1', ['i1', 'i1', null])).resolves.toBeUndefined();
    expect(db.item.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', id: { in: ['i1'] } },
      select: { id: true, sku: true, name: true, isActive: true },
    });
  });

  it('rejects inactive items with a useful transaction error', async () => {
    const db = itemReader([{ id: 'i1', sku: 'OLD-1', name: 'Retired item', isActive: false }]);

    await expect(assertItemsActive(db, 'org-1', ['i1'])).rejects.toMatchObject({
      status: 422,
      message: 'Inactive or unavailable item cannot be added to a new transaction: OLD-1 — Retired item',
    });
  });

  it('does not reveal whether an unavailable id belongs to another organization', async () => {
    const db = itemReader([]);

    await expect(assertItemsActive(db, 'org-1', ['foreign-item'])).rejects.toMatchObject({
      status: 422,
      message: 'Inactive or unavailable item cannot be added to a new transaction: foreign-item',
    });
  });

  it('allows an inactive item already present on the document being edited', async () => {
    const db = itemReader([]);

    await expect(assertItemsActive(db, 'org-1', ['i1'], { allowItemIds: ['i1'] })).resolves.toBeUndefined();
    expect(db.item.findMany).not.toHaveBeenCalled();
  });
});

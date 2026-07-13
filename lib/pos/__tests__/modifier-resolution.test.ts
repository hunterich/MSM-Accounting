import { describe, it, expect } from 'vitest';
import { resolveItemGroups, type GroupWithAttach } from '../modifier-resolution';

const g = (id: string, over: Partial<GroupWithAttach> = {}): GroupWithAttach => ({
  id, name: id, selectionType: 'SINGLE', isRequired: false, sortOrder: 0, isActive: true,
  options: [], attachedItemIds: [], attachedCategoryIds: [], ...over,
});

describe('resolveItemGroups', () => {
  it('unions item-attached and category-attached groups', () => {
    const groups = [
      g('milk', { sortOrder: 0, attachedCategoryIds: ['coffee'] }),
      g('addons', { sortOrder: 1, attachedItemIds: ['latte'] }),
      g('other', { attachedItemIds: ['tea'] }),
    ];
    const res = resolveItemGroups(groups, { itemId: 'latte', categoryId: 'coffee' });
    expect(res.map((x) => x.id)).toEqual(['milk', 'addons']);
  });

  it('dedupes a group attached via both item and category', () => {
    const groups = [g('milk', { attachedItemIds: ['latte'], attachedCategoryIds: ['coffee'] })];
    const res = resolveItemGroups(groups, { itemId: 'latte', categoryId: 'coffee' });
    expect(res).toHaveLength(1);
  });

  it('orders by sortOrder then name and drops inactive groups/options', () => {
    const groups = [
      g('b', { sortOrder: 2, attachedItemIds: ['x'] }),
      g('a', { sortOrder: 1, attachedItemIds: ['x'], options: [
        { id: 'o1', name: 'on', priceDelta: 0, itemId: null, sortOrder: 0, isActive: true },
        { id: 'o2', name: 'off', priceDelta: 0, itemId: null, sortOrder: 1, isActive: false },
      ] }),
      g('z', { isActive: false, attachedItemIds: ['x'] }),
    ];
    const res = resolveItemGroups(groups, { itemId: 'x', categoryId: null });
    expect(res.map((x) => x.id)).toEqual(['a', 'b']);
    expect(res[0].options.map((o) => o.id)).toEqual(['o1']);
  });
});

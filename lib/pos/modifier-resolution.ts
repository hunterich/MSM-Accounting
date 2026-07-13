export interface ResolvedOption {
  id: string; name: string; priceDelta: number; itemId: string | null; sortOrder: number; isActive: boolean;
}
export interface GroupWithAttach {
  id: string; name: string;
  selectionType: 'SINGLE' | 'MULTI';
  isRequired: boolean; sortOrder: number; isActive: boolean;
  options: ResolvedOption[];
  attachedItemIds: string[];
  attachedCategoryIds: string[];
}

/** Groups applicable to an item = item-attached ∪ category-attached, active only,
 *  active options only, ordered by sortOrder then name (deterministic tie-break at
 *  both group and option levels). Pure — caller supplies data. */
export function resolveItemGroups(
  groups: GroupWithAttach[],
  ctx: { itemId: string; categoryId: string | null },
): GroupWithAttach[] {
  const seen = new Set<string>();
  const out: GroupWithAttach[] = [];
  for (const grp of groups) {
    if (!grp.isActive || seen.has(grp.id)) continue;
    const byItem = grp.attachedItemIds.includes(ctx.itemId);
    const byCat = ctx.categoryId != null && grp.attachedCategoryIds.includes(ctx.categoryId);
    if (!byItem && !byCat) continue;
    seen.add(grp.id);
    out.push({
      ...grp,
      options: grp.options
        .filter((o) => o.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    });
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

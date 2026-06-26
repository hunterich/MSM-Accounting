import { ModuleKey } from '@prisma/client';

export const MODULE_KEYS = Object.values(ModuleKey) as ModuleKey[];

export interface PermissionRowInput {
  moduleKey: ModuleKey;
  canView?: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canApprove?: boolean;
}

export interface PermissionRow {
  moduleKey: ModuleKey;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}

const known = new Set<string>(MODULE_KEYS);

/** Keep only known module keys, dedupe by key, coerce all flags to booleans. */
export function normalizePermissionMatrix(rows: PermissionRowInput[] | undefined): PermissionRow[] {
  if (!Array.isArray(rows)) return [];
  const byKey = new Map<ModuleKey, PermissionRow>();
  for (const r of rows) {
    if (!r || !known.has(r.moduleKey)) continue;
    byKey.set(r.moduleKey, {
      moduleKey: r.moduleKey,
      canView: !!r.canView,
      canCreate: !!r.canCreate,
      canEdit: !!r.canEdit,
      canDelete: !!r.canDelete,
      canApprove: !!r.canApprove,
    });
  }
  return [...byKey.values()];
}

/** A role can administer settings if it's the ADMIN type or has SETTINGS.canEdit. */
export function roleGrantsSettingsEdit(
  roleType: string,
  rows: Array<{ moduleKey: ModuleKey; canEdit?: boolean }>,
): boolean {
  if (roleType === 'ADMIN') return true;
  return rows.some((r) => r.moduleKey === 'SETTINGS' && !!r.canEdit);
}

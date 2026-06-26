import { NextRequest } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ok, err } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { corsPreflightResponse } from '@/lib/cors';
import { getSettings, updateSettings } from '@/lib/backup/backup-service';
import { resolvePgToolPath, assertPgToolAvailable } from '@/lib/backup/pg-tools';
import { updateBackupSettingsInputSchema } from '@/types/api';

export const runtime = 'nodejs';

async function settingsResponsePayload() {
  const settings = await getSettings();
  let pgToolsOk = true;
  let pgToolsMessage = '';
  try {
    const tool = resolvePgToolPath('pg_dump', { override: settings.pgToolsPathOverride });
    pgToolsMessage = await assertPgToolAvailable(tool);
  } catch (e) {
    pgToolsOk = false;
    pgToolsMessage = e instanceof Error ? e.message : String(e);
  }
  const folderChecks = await Promise.all(
    settings.folderDestinations.map(async (d) => {
      let writable = false;
      let message = '';
      try {
        await fs.access(path.dirname(d.path)); // parent must exist (drive mounted / cloud app present)
        writable = true;
      } catch {
        message = 'Folder not available — is the drive connected / the cloud app installed & signed in?';
      }
      return { label: d.label, path: d.path, enabled: d.enabled, writable, message };
    }),
  );
  return { ...settings, pgToolsOk, pgToolsMessage, folderChecks };
}

export function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withPermission({ module: 'SYSTEM_BACKUP', action: 'view' }, async function GET(_req: NextRequest) {
  return ok(await settingsResponsePayload());
});

export const PUT = withPermission({ module: 'SYSTEM_BACKUP', action: 'edit' }, async function PUT(req: NextRequest) {
  const body = await req.json();
  const parsed = updateBackupSettingsInputSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid backup settings', 400);

  await updateSettings(parsed.data);

  const { rescheduleBackups } = await import('@/lib/backup/scheduler');
  await rescheduleBackups();

  return ok(await settingsResponsePayload());
});

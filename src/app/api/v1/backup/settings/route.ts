import { NextRequest } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ok, err, withHandler } from '@/lib/api-utils';
import { corsPreflightResponse } from '@/lib/cors';
import { getSettings, updateSettings } from '@/lib/backup/backup-service';
import { resolvePgToolPath, assertPgToolAvailable } from '@/lib/backup/pg-tools';
import { updateBackupSettingsInputSchema } from '@/types/api';

export const runtime = 'nodejs';

function requireAdmin(req: NextRequest): string | null {
  if (req.headers.get('x-role-type') !== 'ADMIN') return 'Forbidden: ADMIN role required';
  return null;
}

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

export const GET = withHandler(async function GET(req: NextRequest) {
  const forbidden = requireAdmin(req);
  if (forbidden) return err(forbidden, 403);

  return ok(await settingsResponsePayload());
});

export const PUT = withHandler(async function PUT(req: NextRequest) {
  const forbidden = requireAdmin(req);
  if (forbidden) return err(forbidden, 403);

  const body = await req.json();
  const parsed = updateBackupSettingsInputSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message || 'Invalid backup settings', 400);

  await updateSettings(parsed.data);

  const { rescheduleBackups } = await import('@/lib/backup/scheduler');
  await rescheduleBackups();

  return ok(await settingsResponsePayload());
});

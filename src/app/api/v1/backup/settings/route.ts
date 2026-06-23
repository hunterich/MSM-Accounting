import { NextRequest } from 'next/server';
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

export function OPTIONS() {
  return corsPreflightResponse();
}

export const GET = withHandler(async function GET(req: NextRequest) {
  const forbidden = requireAdmin(req);
  if (forbidden) return err(forbidden, 403);

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
  return ok({ ...settings, pgToolsOk, pgToolsMessage });
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

  return ok(await getSettings());
});

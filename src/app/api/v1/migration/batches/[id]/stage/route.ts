import { NextRequest } from 'next/server';
import { corsPreflightResponse } from '@/lib/cors';
import { requireOrg, ok, ApiError } from '@/lib/api-utils';
import { withPermission } from '@/lib/authz';
import { stageEntity } from '@/lib/migration/batch-service';
import { MIGRATION_ENTITIES, type MigrationEntity } from '@/lib/migration/schemas';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return corsPreflightResponse();
}

export const POST = withPermission(
  { module: 'SETTINGS', action: 'create' },
  async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const orgId = requireOrg(req);
    const { id } = await params;
    const body = (await req.json()) as { entity?: string; rows?: unknown[] };

    if (!body.entity || !MIGRATION_ENTITIES.includes(body.entity as MigrationEntity)) {
      throw new ApiError(
        `Unknown entity: ${body.entity}. Valid: ${MIGRATION_ENTITIES.join(', ')}`,
        400,
      );
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];

    const result = await stageEntity(orgId, id, body.entity as MigrationEntity, rows);
    return ok(result);
  },
);

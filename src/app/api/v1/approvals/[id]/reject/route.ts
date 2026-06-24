import { NextRequest } from 'next/server';
import { corsPreflightResponse } from '@/lib/cors';
import { ok, withHandler } from '@/lib/api-utils';
import { approvalActor } from '@/lib/approval/can-approve';
import { rejectRequest } from '@/lib/approval/engine';

export const runtime = 'nodejs';
export async function OPTIONS() { return corsPreflightResponse(); }

export const POST = withHandler(async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = approvalActor(req);
  const body = await req.json().catch(() => ({}));
  await rejectRequest(id, actor, typeof body?.note === 'string' ? body.note : undefined);
  return ok({ success: true });
});

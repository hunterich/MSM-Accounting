import { NextResponse } from 'next/server';

// The authenticated middleware returns this probe using its live membership
// query. Fail closed if invoked without that middleware (never trust headers).
export async function GET() {
  return NextResponse.json({ error: 'Authenticated schedule check required' }, { status: 401 });
}

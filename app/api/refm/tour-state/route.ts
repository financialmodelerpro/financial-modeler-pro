/**
 * /api/refm/tour-state (2026-08-20)
 *
 * GET  -> { available, state } : the signed-in user's guided-tour state.
 * PATCH { state } -> persist it.
 *
 * Backed by users.refm_tour (mig 217, one jsonb column). SCHEMA TOLERANT: on
 * a database without the column, both verbs report available:false instead of
 * erroring, and the client falls back to localStorage, so the tour works the
 * day it deploys and gains per-user persistence the day the migration lands.
 *
 * The state is a small self-describing blob ({ startedAt, step, completedAt,
 * skippedAt }); the server does not interpret it beyond capping its size, so
 * the shape can evolve without a route change. It is per user by construction:
 * the row is resolved from the session, never from the request.
 *
 * No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { getServerClient } from '@/src/core/db/supabase';

const COLUMN_MISSING = /refm_tour/;

export async function GET() {
  const userId = await getRefmUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = getServerClient();
  const { data, error } = await sb.from('users').select('refm_tour').eq('id', userId).maybeSingle();
  if (error) {
    if (COLUMN_MISSING.test(error.message)) return NextResponse.json({ available: false });
    return NextResponse.json({ available: false });
  }
  return NextResponse.json({ available: true, state: (data as { refm_tour?: unknown } | null)?.refm_tour ?? null });
}

export async function PATCH(req: NextRequest) {
  const userId = await getRefmUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null) as { state?: unknown } | null;
  const state = body?.state;
  // A blob, but a SMALL one: this column is a resume position, not a store.
  if (!state || typeof state !== 'object' || JSON.stringify(state).length > 2_000) {
    return NextResponse.json({ error: 'state must be a small object' }, { status: 400 });
  }
  const sb = getServerClient();
  const { error } = await sb.from('users').update({ refm_tour: state }).eq('id', userId);
  if (error) {
    if (COLUMN_MISSING.test(error.message)) return NextResponse.json({ available: false });
    return NextResponse.json({ available: false });
  }
  return NextResponse.json({ available: true });
}

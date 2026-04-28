/**
 * POST /api/training/assessment/start
 *
 * Idempotent: creates an in-progress attempt row, or returns the existing
 * row's state if one already exists. Two tabs hitting Start for the same
 * (email, attempt) converge on the same row.
 *
 * Body (one identifier required):
 *   { tabKey: string, attemptNumber: number, timerMinutes?: number, isFinal?: boolean }
 *   { sessionId: string, attemptNumber: number, timerMinutes?: number, isFinal?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { startAttempt, type AttemptKey } from '@/src/hubs/training/lib/assessment/attemptInProgress';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await getTrainingCookieSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tabKey         = typeof body.tabKey === 'string' ? body.tabKey.trim() : '';
  const sessionId      = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const attemptNumber  = typeof body.attemptNumber === 'number' && Number.isFinite(body.attemptNumber)
    ? Math.max(1, Math.floor(body.attemptNumber))
    : null;
  const timerMinutes   = typeof body.timerMinutes === 'number' && body.timerMinutes > 0 ? body.timerMinutes : null;
  const isFinal        = body.isFinal === true;

  if (!attemptNumber) return NextResponse.json({ error: 'attemptNumber required' }, { status: 400 });
  if (!tabKey && !sessionId) return NextResponse.json({ error: 'tabKey or sessionId required' }, { status: 400 });
  if (tabKey && sessionId)   return NextResponse.json({ error: 'tabKey and sessionId are mutually exclusive' }, { status: 400 });

  const key: AttemptKey = tabKey
    ? { kind: 'cert', tabKey }
    : { kind: 'live', sessionId };

  const sb = getServerClient();
  try {
    const state = await startAttempt(sb, session.email, key, attemptNumber, timerMinutes, isFinal);
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

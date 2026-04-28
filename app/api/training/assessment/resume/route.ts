/**
 * POST /api/training/assessment/resume
 *
 * Caps the actual pause duration at remaining grace, extends expires_at by
 * the capped amount, increments pause_count, appends to pause_log, clears
 * paused_at. Idempotent on already-running rows. Returns the fresh state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { resumeAttempt, type AttemptKey } from '@/src/hubs/training/lib/assessment/attemptInProgress';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await getTrainingCookieSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tabKey        = typeof body.tabKey === 'string' ? body.tabKey.trim() : '';
  const sessionId     = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const attemptNumber = typeof body.attemptNumber === 'number' ? Math.max(1, Math.floor(body.attemptNumber)) : null;

  if (!attemptNumber) return NextResponse.json({ error: 'attemptNumber required' }, { status: 400 });
  if (!tabKey && !sessionId) return NextResponse.json({ error: 'tabKey or sessionId required' }, { status: 400 });

  const key: AttemptKey = tabKey ? { kind: 'cert', tabKey } : { kind: 'live', sessionId };

  const sb = getServerClient();
  const result = await resumeAttempt(sb, session.email, key, attemptNumber);
  if (result.ok) return NextResponse.json(result.state);

  return NextResponse.json(
    { error: result.code === 'not_found' ? 'No in-progress attempt found' : result.code, code: result.code, state: result.state ?? null },
    { status: 404 },
  );
}

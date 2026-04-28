/**
 * POST /api/training/assessment/pause
 *
 * Stamps paused_at = now() if pause is allowed. Idempotent: pausing an
 * already-paused row returns the existing state. Final exams always 403.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/lib/training/trainingSessionCookie';
import { pauseAttempt, type AttemptKey } from '@/src/lib/training/attemptInProgress';

export const runtime = 'nodejs';

const ERROR_MESSAGES: Record<string, string> = {
  not_found:        'No in-progress attempt found',
  final_no_pause:   'Pauses are not allowed on final exams',
  no_pauses_left:   'No more pauses available for this attempt',
  grace_exhausted:  'Grace time exhausted; the wall clock is running',
};

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
  const result = await pauseAttempt(sb, session.email, key, attemptNumber);
  if (result.ok) return NextResponse.json(result.state);

  const status = result.code === 'final_no_pause' || result.code === 'no_pauses_left' || result.code === 'grace_exhausted' ? 403 : 404;
  return NextResponse.json(
    { error: ERROR_MESSAGES[result.code] ?? result.code, code: result.code, state: result.state ?? null },
    { status },
  );
}

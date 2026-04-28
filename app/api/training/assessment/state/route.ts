/**
 * GET /api/training/assessment/state?tabKey=...&attemptNumber=N
 * GET /api/training/assessment/state?sessionId=...&attemptNumber=N
 *
 * Returns the authoritative state for the client to render. Returns
 * { exists: false } if no in-progress attempt found (cold start).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/lib/training/trainingSessionCookie';
import { getAttemptState, type AttemptKey } from '@/src/lib/training/attemptInProgress';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await getTrainingCookieSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url           = new URL(req.url);
  const tabKey        = (url.searchParams.get('tabKey') ?? '').trim();
  const sessionId     = (url.searchParams.get('sessionId') ?? '').trim();
  const attemptParam  = url.searchParams.get('attemptNumber');
  const attemptNumber = attemptParam !== null ? parseInt(attemptParam, 10) : NaN;

  if (!Number.isFinite(attemptNumber) || attemptNumber < 1) {
    return NextResponse.json({ error: 'attemptNumber required' }, { status: 400 });
  }
  if (!tabKey && !sessionId) return NextResponse.json({ error: 'tabKey or sessionId required' }, { status: 400 });

  const key: AttemptKey = tabKey ? { kind: 'cert', tabKey } : { kind: 'live', sessionId };

  const sb    = getServerClient();
  const state = await getAttemptState(sb, session.email, key, attemptNumber);
  if (!state) return NextResponse.json({ exists: false });

  return NextResponse.json({ exists: true, ...state });
}

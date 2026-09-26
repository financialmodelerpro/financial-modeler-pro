import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { maxAttemptsFor } from '@/src/hubs/training/lib/assessment/modelGateScope';

/**
 * GET /api/training/attempt-status
 *
 * Supabase-native. `attempts`, `passed`, `score`, `completed_at` come from
 * training_assessment_results. `maxAttempts` comes from the COURSES config
 * bundled with the app (the same config the admin Course Manager edits).
 *
 * This route used to dual-read: Apps Script for maxAttempts, Supabase for
 * everything else. The Apps Script leg is retired now that maxAttempts
 * lives in src/config/courses.ts (and has for a while - Apps Script was
 * the stale source, just never removed).
 */
export async function GET(req: NextRequest) {
  // The student is the SIGNED session (2026-09-26); any identity in the request is ignored.
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const tabKey = searchParams.get('tabKey');
  const email  = sess.email;

  if (!tabKey || !email) {
    return NextResponse.json({ success: false, error: 'Missing tabKey or email' }, { status: 400 });
  }

  // The ONE attempt-limit rule, shared with submit-assessment, which enforces it.
  const maxAttempts = maxAttemptsFor(tabKey);

  const sb = getServerClient();
  const { data: row } = await sb
    .from('training_assessment_results')
    .select('attempts, score, passed, completed_at')
    .eq('email', email.trim().toLowerCase())
    .eq('tab_key', tabKey)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({
      success: true,
      data: {
        tabKey,
        attempts:        0,
        maxAttempts,
        passed:          false,
        canAttempt:      true,
      },
    });
  }

  const attempts = Number(row.attempts ?? 0);
  return NextResponse.json({
    success: true,
    data: {
      tabKey,
      attempts,
      maxAttempts,
      passed:          Boolean(row.passed),
      lastScore:       row.score as number | undefined,
      lastCompletedAt: row.completed_at as string | undefined,
      canAttempt:      !row.passed && attempts < maxAttempts,
    },
  });
}

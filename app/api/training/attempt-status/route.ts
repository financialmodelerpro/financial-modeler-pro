import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { COURSES } from '@/src/hubs/training/config/courses';

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
  const { searchParams } = new URL(req.url);
  const tabKey = searchParams.get('tabKey');
  const email  = searchParams.get('email');

  if (!tabKey || !email) {
    return NextResponse.json({ success: false, error: 'Missing tabKey or email' }, { status: 400 });
  }

  // Resolve maxAttempts from the local COURSES config. Format:
  //   tabKey = "3SFM_S1" | "BVM_L2" | "3SFM_Final" | "BVM_Final"
  const sep = tabKey.indexOf('_');
  const shortCode = sep >= 0 ? tabKey.slice(0, sep).toUpperCase() : '';
  const sessionId = sep >= 0 ? tabKey.slice(sep + 1) : tabKey;
  const course = Object.values(COURSES).find(c => c.shortTitle.toUpperCase() === shortCode);
  const session = course?.sessions.find(s => s.id === sessionId || (s.id === 'S18' && sessionId === 'Final') || (s.id === 'L7' && sessionId === 'Final'));
  const maxAttempts = session?.maxAttempts ?? (session?.isFinal ? 1 : 3);

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

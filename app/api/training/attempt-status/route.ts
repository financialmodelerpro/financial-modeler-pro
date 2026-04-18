import { NextRequest, NextResponse } from 'next/server';
import { getAttemptStatus } from '@/src/lib/training/sheets';
import { getServerClient } from '@/src/lib/shared/supabase';

/**
 * GET /api/training/attempt-status
 *
 * Returns the current attempt status for a (tabKey, email, regId) tuple.
 * Supabase is the source of truth for attempts/pass/score — Apps Script is
 * consulted only to fill in maxAttempts (course config) when Supabase has
 * no row yet for this session.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tabKey = searchParams.get('tabKey');
  const email  = searchParams.get('email');
  const regId  = searchParams.get('regId');

  if (!tabKey || !email || !regId) {
    return NextResponse.json({ success: false, error: 'Missing tabKey, email, or regId' }, { status: 400 });
  }

  // 1. Ask Apps Script first so we inherit `maxAttempts` (course configuration).
  const scriptRes = await getAttemptStatus(tabKey, email, regId);
  const scriptRaw = scriptRes as unknown as Record<string, unknown>;
  const scriptData = scriptRes.data ?? {
    tabKey:          (scriptRaw.tabKey as string)          ?? tabKey,
    attempts:        Number(scriptRaw.attemptsUsed ?? scriptRaw.attempts ?? 0),
    maxAttempts:     Number(scriptRaw.maxAttempts ?? 3),
    passed:          Boolean(scriptRaw.passed ?? false),
    lastScore:       scriptRaw.lastScore as number | undefined,
    lastCompletedAt: scriptRaw.lastCompletedAt as string | undefined,
    canAttempt:      Boolean(scriptRaw.canAttempt ?? true),
  };

  // 2. Overlay Supabase row (authoritative for attempts/pass/score).
  try {
    const sb = getServerClient();
    const { data: row } = await sb
      .from('training_assessment_results')
      .select('attempts, score, passed, completed_at')
      .eq('email', email.trim().toLowerCase())
      .eq('tab_key', tabKey)
      .maybeSingle();

    if (row) {
      const attempts    = Number(row.attempts ?? 0);
      const maxAttempts = Number(scriptData.maxAttempts ?? 3);
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
  } catch (err) {
    console.warn('[attempt-status] Supabase lookup failed, falling back to Apps Script:', err);
  }

  // 3. No Supabase row → use Apps Script data unchanged.
  if (!scriptRes.success) {
    return NextResponse.json({ success: false, error: scriptRes.error ?? 'Failed to load attempt status' });
  }
  return NextResponse.json({ success: true, data: scriptData });
}

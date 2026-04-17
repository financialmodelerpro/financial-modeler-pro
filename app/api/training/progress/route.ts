import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getStudentProgress } from '@/src/lib/training/sheets';
import { getServerClient } from '@/src/lib/shared/supabase';

// ── 2-minute server-side cache ────────────────────────────────────────────────
const _cache = new Map<string, { data: unknown; at: number }>();
const TTL_MS = 2 * 60 * 1000;

function emptyProgress(email: string, registrationId: string) {
  return {
    student: {
      name: registrationId,
      email,
      registrationId,
      course: '3sfm',
      registeredAt: '',
    },
    sessions: [],
    finalPassed: false,
    certificateIssued: false,
  };
}

export async function GET(req: NextRequest) {
  // ── Resolve credentials (cookie first, query param fallback) ─────────────────
  let email = '';
  let registrationId = '';

  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get('training_session')?.value;
    if (raw) {
      const parsed = JSON.parse(raw) as { email?: string; registrationId?: string };
      email = parsed.email ?? '';
      registrationId = parsed.registrationId ?? '';
    }
  } catch { /* ignore */ }

  if (!email || !registrationId) {
    email          = req.nextUrl.searchParams.get('email')          ?? '';
    registrationId = req.nextUrl.searchParams.get('registrationId') ?? '';
  }

  if (!email || !registrationId) {
    return NextResponse.json(
      { success: false, error: 'Not authenticated.' },
      { status: 401 },
    );
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanRegId = registrationId.trim();
  // `refresh=1` busts cache - dashboard calls this after assessment submission
  const refresh    = req.nextUrl.searchParams.get('refresh') === '1';
  const cacheKey   = `${cleanEmail}:${cleanRegId}`;

  // ── Serve from cache if fresh ─────────────────────────────────────────────
  if (!refresh) {
    const hit = _cache.get(cacheKey);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return NextResponse.json({ success: true, data: hit.data, cached: true });
    }
  }

  // ── Fetch progress - always return 200, never hard-error ────────────────────
  try {
    const debug  = req.nextUrl.searchParams.get('debug') === '1';
    const result = await getStudentProgress(cleanEmail, cleanRegId);
    console.log('[training/progress] getProgress response:', JSON.stringify(result));
    if (debug) return NextResponse.json({ _raw: result });

    if (result.success && result.data) {
      // Merge Supabase assessment results (instant, accurate) over Apps Script data (may be stale)
      try {
        const sb = getServerClient();
        const { data: sbResults } = await sb
          .from('training_assessment_results')
          .select('tab_key, score, passed, attempts, completed_at')
          .eq('email', cleanEmail);
        if (sbResults && sbResults.length > 0) {
          const sbMap = new Map(sbResults.map(r => {
            // tab_key "3SFM_S1" → sessionId "S1"; "3SFM_Final" → "S18"; "BVM_Final" → "L7"
            const sep = r.tab_key.indexOf('_');
            const sessId = sep >= 0 ? r.tab_key.slice(sep + 1) : r.tab_key;
            // Map _Final back to the actual session ID used in COURSES config
            const finalId = r.tab_key.toUpperCase().startsWith('BVM') ? 'L7' : 'S18';
            const resolvedId = sessId === 'Final' ? finalId : sessId;
            return [resolvedId, r] as const;
          }));
          for (const sess of result.data.sessions) {
            const sbr = sbMap.get(sess.sessionId);
            if (sbr) {
              sess.score = sbr.score;
              sess.passed = sbr.passed;
              sess.attempts = sbr.attempts;
              sess.completedAt = sbr.completed_at;
              sbMap.delete(sess.sessionId);
            }
          }
          // Add sessions that exist in Supabase but not in Apps Script response
          for (const [sessId, sbr] of sbMap) {
            result.data.sessions.push({
              sessionId: sessId,
              score: sbr.score,
              passed: sbr.passed,
              attempts: sbr.attempts,
              completedAt: sbr.completed_at,
            });
          }
        }
      } catch (sbErr) {
        console.warn('[training/progress] Supabase merge failed, using Apps Script only:', sbErr);
      }
      _cache.set(cacheKey, { data: result.data, at: Date.now() });
      return NextResponse.json({ success: true, data: result.data });
    }

    // Apps Script returned success:false or data was empty - serve empty progress
    console.warn('[training/progress] Apps Script returned:', result.success, result.error);
    return NextResponse.json({
      success: true,
      fallback: true,
      data: emptyProgress(cleanEmail, cleanRegId),
    });
  } catch (err) {
    console.error('[training/progress] Unexpected error:', err);
    return NextResponse.json({
      success: true,
      fallback: true,
      data: emptyProgress(cleanEmail, cleanRegId),
    });
  }
}

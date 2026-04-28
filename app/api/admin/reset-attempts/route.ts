import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getAppsScriptUrl } from '@/src/hubs/training/lib/appsScript/sheets';
import { getServerClient } from '@/src/core/db/supabase';

/**
 * POST /api/admin/reset-attempts
 *
 * Resets a student's assessment state. Historical bug: Apps Script was the only
 * store being cleared — `training_assessment_results` in Supabase kept the
 * passed row, so the dashboard still blocked the retake. This route now clears
 * both stores in every branch.
 *
 * Body: { regId, tabKey, course, email? }
 *   - tabKey = "3SFM_S16"   → single course session reset (Apps Script + DB row)
 *   - tabKey = "ALL"        → reset every session of `course` (Apps Script + all DB rows)
 *   - tabKey = "LIVE_<uuid>"→ live session reset (DB only, no Apps Script)
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json() as { regId?: string; tabKey?: string; course?: string; email?: string };
    const { regId, tabKey, course } = body;
    let { email } = body;

    if (!regId || !tabKey) {
      return NextResponse.json({ success: false, error: 'regId and tabKey required' }, { status: 400 });
    }

    const sb = getServerClient();

    // Fall back to the regId → email lookup when the caller didn't send one.
    if (!email) {
      const { data: reg } = await sb
        .from('training_registrations_meta')
        .select('email')
        .eq('registration_id', regId)
        .maybeSingle();
      email = (reg?.email as string | undefined) ?? '';
    }

    const normalizedEmail = email ? email.toLowerCase() : '';
    const isLive = tabKey.startsWith('LIVE_');
    const isAll  = tabKey === 'ALL';

    // ── Live session branch (no Apps Script) ────────────────────────────────
    if (isLive) {
      if (!normalizedEmail) {
        return NextResponse.json({ success: false, error: 'Email not resolvable from regId' }, { status: 400 });
      }
      const sessionId = tabKey.slice('LIVE_'.length);
      const { error } = await sb
        .from('live_session_attempts')
        .delete()
        .eq('email', normalizedEmail)
        .eq('session_id', sessionId);
      if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, message: 'Live session attempts cleared' });
    }

    // ── Course branch: Apps Script first, then mirror on Supabase ──────────
    const url = await getAppsScriptUrl();
    if (!url) {
      return NextResponse.json({ success: false, error: 'Apps Script URL not configured' }, { status: 500 });
    }

    console.log('[reset-attempts] Calling Apps Script:', { regId, tabKey, course });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'resetAttempts',
        regId,
        tabKey,
        course: course ?? '',
      }),
      cache: 'no-store',
    });

    const data = await res.json() as { success: boolean; error?: string; message?: string };
    console.log('[reset-attempts] Apps Script response:', data);

    if (!data.success) {
      return NextResponse.json({ success: false, error: data.error ?? 'Reset failed' });
    }

    // Mirror the reset in Supabase so the dashboard + retake gate unblock.
    if (normalizedEmail) {
      let q = sb.from('training_assessment_results').delete().eq('email', normalizedEmail);
      if (isAll) {
        // Course-wide reset → "3SFM_*" / "BVM_*".
        if (course && course.trim()) {
          q = q.ilike('tab_key', `${course.trim().toUpperCase()}\\_%`);
        }
        // No course filter → delete every assessment row for this student
        // (same blast radius as Apps Script's ALL with empty course).
      } else {
        q = q.eq('tab_key', tabKey);
      }
      const { error: delErr } = await q;
      if (delErr) console.error('[reset-attempts] Supabase delete error:', delErr.message);
    } else {
      console.warn('[reset-attempts] No email for regId, skipped Supabase cleanup:', regId);
    }

    return NextResponse.json({ success: true, message: data.message ?? 'Attempts reset successfully' });
  } catch (err) {
    console.error('[reset-attempts] Error:', err);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 });
  }
}

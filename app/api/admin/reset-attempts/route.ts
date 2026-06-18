import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getAppsScriptUrl } from '@/src/hubs/training/lib/appsScript/sheets';
import { getServerClient } from '@/src/core/db/supabase';
import {
  resetAttemptsCore, applyTabScope,
  type ResetStore, type ResetExternal, type ScopeArgs,
} from '@/src/hubs/training/lib/admin/resetAttempts';

/**
 * POST /api/admin/reset-attempts
 *
 * Manual, admin-triggered reset of a student's assessment state. NOT automatic
 * and NOT scheduled. Thin wiring over resetAttemptsCore (the orchestration +
 * invariants live there and are unit-tested by verify-reset-attempts).
 *
 * Historical bugs fixed: the reset used to GATE everything on Apps Script's
 * RegID-in-a-Sheet lookup, which is stale relative to the Supabase-sourced
 * admin list, so registered students got "Student not found" and the
 * Supabase row the dashboard reads was never cleared. Now Supabase is cleared
 * first and unconditionally (by email AND reg_id); Apps Script is best-effort.
 *
 * Body: { regId?, email?, tabKey, course? }
 *   - tabKey = "3SFM_S16"    -> single course session reset
 *   - tabKey = "ALL"         -> reset every session of `course`
 *   - tabKey = "LIVE_<uuid>" -> live session reset (Supabase only)
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json() as { regId?: string; tabKey?: string; course?: string; email?: string };
    const sb = getServerClient();

    const store: ResetStore = {
      async emailForRegId(regId) {
        const { data } = await sb.from('training_registrations_meta').select('email').eq('registration_id', regId).maybeSingle();
        return (data?.email as string | undefined) ?? null;
      },
      async regIdForEmail(email) {
        const { data } = await sb.from('training_registrations_meta').select('registration_id').ilike('email', email).maybeSingle();
        return (data?.registration_id as string | undefined) ?? null;
      },
      async clearResults(filter, scope: ScopeArgs) {
        const base = sb.from('training_assessment_results').delete().eq(filter.by, filter.value);
        const { data, error } = await applyTabScope(base, scope).select('id') as { data: unknown[] | null; error: { message: string } | null };
        if (error) throw new Error(error.message);
        return data?.length ?? 0;
      },
      async clearInProgress(email, scope: ScopeArgs) {
        const base = sb.from('assessment_attempts_in_progress').delete().eq('email', email);
        const { error } = await applyTabScope(base, scope) as { error: { message: string } | null };
        if (error) throw new Error(error.message);
      },
      async clearLive(email, sessionId) {
        await sb.from('live_session_attempts').delete().eq('email', email).eq('session_id', sessionId);
        await sb.from('assessment_attempts_in_progress').delete().eq('email', email).eq('session_id', sessionId);
      },
    };

    const external: ResetExternal = {
      async resetSheet(regId, tabKey, course) {
        const url = await getAppsScriptUrl();
        if (!url) return { ok: false, error: 'Apps Script URL not configured' };
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resetAttempts', regId, tabKey, course: course ?? '' }),
          cache: 'no-store',
        });
        const data = await res.json() as { success: boolean; error?: string; message?: string };
        if (data.success) return { ok: true };
        return { ok: false, notFound: /not found/i.test(data.error ?? ''), error: data.error };
      },
    };

    const result = await resetAttemptsCore(store, external, body);
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status ?? 500 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error('[reset-attempts] Error:', err);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 });
  }
}

/**
 * POST /api/admin/sessions/[tabKey]/force-complete-for-student
 *
 * Admin-only per-student force-unlock for a single watch row. Use this
 * to unblock a specific student whose tracker undershot for legitimate
 * reasons (network glitches, mid-session refresh that pre-146 lost,
 * Phase 5 surgical recovery sweep).
 *
 * Body: { email: string, reason?: string }
 *  - email is required (case-insensitive, lowercased server-side).
 *  - reason is free-text; optional, captured into the audit row.
 *
 * Behaviour:
 *  - Routes by tabKey prefix the same way `reset-watch-progress` does:
 *      LIVE_<uuid>         -> session_watch_history (UPDATE by session_id + email)
 *      else (3SFM_S1 etc.) -> certification_watch_history (UPDATE by tab_key + email)
 *  - Idempotent. If the row is already completed, status stays as-is and
 *    completed_via is left alone (we don't overwrite an honest 'threshold'
 *    or 'manual' provenance with 'admin_override' just because the admin
 *    pressed the button on an already-finished row). Returns
 *    `{ ok: true, alreadyCompleted: true }`.
 *  - When the row is in_progress, flips status='completed' +
 *    completed_via='admin_override' + completed_at=now (cert table) /
 *    watched_at=now (live-session table) + watch_percentage clamped to
 *    threshold (default 100 if total_seconds is unknown).
 *  - 404 if no row exists yet for that (tabKey, email) pair. The admin
 *    can ask the student to open the watch page once and try again,
 *    OR (Phase 5 sweep) we INSERT directly via SQL.
 *
 * Audit trail: writes to admin_audit_log with action=
 * 'watch_force_complete' so every override is reversible / explainable
 * later.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

async function checkAdminSession() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== 'admin') return null;
  return session;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tabKey: string }> },
) {
  const adminSession = await checkAdminSession();
  if (!adminSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { tabKey } = await params;
  if (!tabKey) return NextResponse.json({ error: 'tabKey required' }, { status: 400 });

  const body = await req.json().catch(() => ({})) as { email?: string; reason?: string };
  const email = (body.email ?? '').toLowerCase().trim();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const sb = getServerClient();
  const adminId = (adminSession.user as { id?: string } | undefined)?.id ?? null;
  const adminEmail = adminSession.user?.email ?? null;
  const nowIso = new Date().toISOString();

  // Branch by tabKey shape. Live sessions use session_watch_history with
  // a session_id key; everything else (3SFM, BVM, future cert tracks)
  // uses certification_watch_history with a tab_key key.
  if (tabKey.startsWith('LIVE_')) {
    const sessionId = tabKey.slice(5);

    const { data: existing } = await sb
      .from('session_watch_history')
      .select('id, status, watch_percentage, completed_via, points_awarded, total_seconds, watch_seconds, student_reg_id')
      .eq('session_id', sessionId)
      .eq('student_email', email)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({
        error: 'No watch row exists yet for this student. Ask them to open the recording once, then retry.',
      }, { status: 404 });
    }
    if (existing.status === 'completed') {
      return NextResponse.json({ ok: true, alreadyCompleted: true });
    }

    const newPct = (existing.total_seconds ?? 0) > 0 && (existing.watch_seconds ?? 0) > 0
      ? Math.min(100, Math.round(((existing.watch_seconds ?? 0) / (existing.total_seconds ?? 1)) * 100))
      : 100;

    // Award the +50 points exactly like the auto path would have if the
    // tracker hadn't undershot. Skip when the row already had points
    // awarded (defense; status check above should already handle this).
    const shouldAwardPoints = (existing.points_awarded ?? 0) === 0;

    const { error: updateErr } = await sb
      .from('session_watch_history')
      .update({
        status:         'completed',
        watched_at:     nowIso,
        watch_percentage: Math.max(existing.watch_percentage ?? 0, newPct),
        completed_via:  'admin_override',
        updated_at:     nowIso,
        ...(shouldAwardPoints ? { points_awarded: 50 } : {}),
      })
      .eq('id', existing.id);

    if (updateErr) {
      console.error('[force-complete] live-session update failed:', updateErr.message);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    if (shouldAwardPoints && existing.student_reg_id) {
      const { data: profile } = await sb
        .from('student_profiles')
        .select('total_points')
        .eq('registration_id', existing.student_reg_id)
        .maybeSingle();
      if (profile) {
        await sb
          .from('student_profiles')
          .update({ total_points: (profile.total_points ?? 0) + 50 })
          .eq('registration_id', existing.student_reg_id);
      }
    }

    if (adminId) {
      const { error: auditErr } = await sb.from('admin_audit_log').insert({
        admin_id: adminId,
        action: 'watch_force_complete',
        after_value: {
          tab_key: tabKey,
          email,
          reason: body.reason ?? null,
          previous_status: existing.status,
          previous_pct: existing.watch_percentage ?? 0,
          new_pct: newPct,
          admin_email: adminEmail,
        },
      });
      if (auditErr) console.error('[force-complete] audit insert failed:', auditErr.message);
    }
    console.log('[force-complete] LIVE_', sessionId, email, 'completed by', adminEmail);
    return NextResponse.json({ ok: true, alreadyCompleted: false, scope: 'live-session', new_pct: newPct });
  }

  // Cert track (3SFM_S1, BVM_L3, 3SFM_Final, etc.)
  const { data: existing } = await sb
    .from('certification_watch_history')
    .select('id, status, watch_percentage, completed_via, total_seconds, watch_seconds, course_id')
    .eq('tab_key', tabKey)
    .eq('student_email', email)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({
      error: 'No watch row exists yet for this student. Ask them to open the session video once, then retry.',
    }, { status: 404 });
  }
  if (existing.status === 'completed') {
    return NextResponse.json({ ok: true, alreadyCompleted: true });
  }

  const newPct = (existing.total_seconds ?? 0) > 0 && (existing.watch_seconds ?? 0) > 0
    ? Math.min(100, Math.round(((existing.watch_seconds ?? 0) / (existing.total_seconds ?? 1)) * 100))
    : 100;

  const { error: updateErr } = await sb
    .from('certification_watch_history')
    .update({
      status:         'completed',
      completed_at:   nowIso,
      watch_percentage: Math.max(existing.watch_percentage ?? 0, newPct),
      completed_via:  'admin_override',
      updated_at:     nowIso,
    })
    .eq('id', existing.id);

  if (updateErr) {
    console.error('[force-complete] cert-track update failed:', updateErr.message);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  if (adminId) {
    await sb.from('admin_audit_log').insert({
      admin_id: adminId,
      action: 'watch_force_complete',
      after_value: {
        tab_key: tabKey,
        email,
        reason: body.reason ?? null,
        previous_status: existing.status,
        previous_pct: existing.watch_percentage ?? 0,
        new_pct: newPct,
        admin_email: adminEmail,
      },
    }).throwOnError();
  }
  console.log('[force-complete]', tabKey, email, 'completed by', adminEmail);
  return NextResponse.json({ ok: true, alreadyCompleted: false, scope: 'cert-track', new_pct: newPct });
}

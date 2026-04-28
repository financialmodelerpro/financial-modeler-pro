/**
 * scripts/phase5_recovery.ts
 *
 * Surgical recovery sweep for the 4 students stuck under the watch
 * threshold because of the pre-146 tracker bug. Mirrors the logic of
 * `POST /api/admin/sessions/[tabKey]/force-complete-for-student`
 * exactly: flips status='completed', stamps completed_via, awards the
 * +50 points on live-session rows that hadn't received them, and
 * writes an admin_audit_log entry per row.
 *
 * Why a script and not the HTTP endpoint:
 *   The endpoint requires a NextAuth admin session cookie, which is
 *   awkward to thread from a CLI. Direct service-role with the same
 *   row-level logic is the canonical pattern for one-shot maintenance
 *   sweeps in this codebase (see backup_apps_script_students.ts and
 *   the migration 140 / 141 service-role precedents documented in
 *   CLAUDE.md). Idempotent: a second run is a no-op because the
 *   skip-if-completed guard runs first.
 *
 * Targets (per the 2026-04-28 diagnosis dump):
 *   muhammadtayyabmadni07@gmail.com  -- 100% watched, status in_progress
 *   yusra.tufail@yahoo.com           -- 93%  watched
 *   daniyal1012@yahoo.com            -- 76%  watched
 *   FMP-2026-0035 (Fakhri)           -- 3SFM_S2 at 47%, reported full watch
 *
 * Output:
 *   - supabase/backups/phase5_recovery_<date>.json   (full before/after audit)
 *   - TEMP_FAKHRI_EMAIL.md                           (gitignored, draft for Ahmad to send)
 *   - human-readable summary to stdout
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/phase5_recovery.ts
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getServerClient } from '../src/lib/shared/supabase';

const BACKUP_DIR = path.join(process.cwd(), 'supabase', 'backups');
const REPORT_FILE = path.join(BACKUP_DIR, `phase5_recovery_${new Date().toISOString().split('T')[0]}.json`);
const FAKHRI_EMAIL_FILE = path.join(process.cwd(), 'TEMP_FAKHRI_EMAIL.md');

interface Target {
  email?: string;                  // resolved at runtime if regId given
  regId?: string;                  // for Fakhri (look up email by reg id)
  reason: string;
  /** Optional explicit tab_key restriction. If omitted we sweep all
   *  in_progress rows for the email across both watch tables. The 3
   *  bug-victim students don't restrict (any in_progress row counts);
   *  Fakhri restricts to 3SFM_S2 because his S1 is already completed. */
  tabKeyHint?: string;
}

const TARGETS: Target[] = [
  {
    email: 'muhammadtayyabmadni07@gmail.com',
    reason: 'Watched 100% but tracker stuck. Tracker bug recovery (Phase 5 sweep).',
  },
  {
    email: 'yusra.tufail@yahoo.com',
    reason: '93% watched, past threshold. Tracker bug recovery (Phase 5 sweep).',
  },
  {
    email: 'daniyal1012@yahoo.com',
    reason: '76% watched, past threshold. Tracker bug recovery (Phase 5 sweep).',
  },
  {
    regId: 'FMP-2026-0035',
    reason: 'Reported full watch on 3SFM_S2, multi-session resume bug. Manual unblock (Phase 5 sweep).',
    tabKeyHint: '3SFM_S2',
  },
];

interface BeforeAfter {
  source: 'cert' | 'live';
  key: string;
  email: string;
  before: {
    status: string | null;
    watch_percentage: number | null;
    watch_seconds: number | null;
    total_seconds: number | null;
    completed_via: string | null;
    last_position: number | null;
    updated_at: string | null;
  };
  after: {
    status: string;
    watch_percentage: number;
    completed_via: string;
    points_awarded?: boolean;
  } | null;
  outcome: 'completed' | 'already_completed' | 'no_row' | 'error';
  error?: string;
}

async function lookupAdminId(): Promise<{ id: string; email: string } | null> {
  const sb = getServerClient();
  const { data } = await sb
    .from('users')
    .select('id, email')
    .eq('role', 'admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { id: String(data.id), email: String(data.email ?? '') };
}

async function resolveEmail(t: Target): Promise<string | null> {
  if (t.email) return t.email.toLowerCase();
  if (!t.regId) return null;
  const sb = getServerClient();
  const { data } = await sb
    .from('training_registrations_meta')
    .select('email')
    .eq('registration_id', t.regId)
    .maybeSingle();
  return data?.email ? String(data.email).toLowerCase() : null;
}

async function fetchAllStuckRowsForEmail(
  email: string,
  tabKeyHint: string | undefined,
): Promise<Array<{
  source: 'cert' | 'live';
  tab_key: string;
  id: string;
  status: string | null;
  watch_seconds: number | null;
  total_seconds: number | null;
  watch_percentage: number | null;
  completed_via: string | null;
  last_position: number | null;
  updated_at: string | null;
  points_awarded?: number | null;
  student_reg_id?: string | null;
}>> {
  const sb = getServerClient();

  const certPromise = sb
    .from('certification_watch_history')
    .select('id, tab_key, status, watch_seconds, total_seconds, watch_percentage, completed_via, last_position, updated_at')
    .eq('student_email', email);
  const livePromise = sb
    .from('session_watch_history')
    .select('id, session_id, status, watch_seconds, total_seconds, watch_percentage, completed_via, last_position, updated_at, points_awarded, student_reg_id')
    .eq('student_email', email);
  const [certRes, liveRes] = await Promise.all([certPromise, livePromise]);

  const out: Array<{
    source: 'cert' | 'live';
    tab_key: string;
    id: string;
    status: string | null;
    watch_seconds: number | null;
    total_seconds: number | null;
    watch_percentage: number | null;
    completed_via: string | null;
    last_position: number | null;
    updated_at: string | null;
    points_awarded?: number | null;
    student_reg_id?: string | null;
  }> = [];
  for (const r of certRes.data ?? []) {
    out.push({
      source: 'cert',
      tab_key: String(r.tab_key),
      id: String(r.id),
      status: r.status as string | null,
      watch_seconds: r.watch_seconds as number | null,
      total_seconds: r.total_seconds as number | null,
      watch_percentage: r.watch_percentage as number | null,
      completed_via: r.completed_via as string | null,
      last_position: r.last_position as number | null,
      updated_at: r.updated_at as string | null,
    });
  }
  for (const r of liveRes.data ?? []) {
    out.push({
      source: 'live',
      tab_key: `LIVE_${r.session_id as string}`,
      id: String(r.id),
      status: r.status as string | null,
      watch_seconds: r.watch_seconds as number | null,
      total_seconds: r.total_seconds as number | null,
      watch_percentage: r.watch_percentage as number | null,
      completed_via: r.completed_via as string | null,
      last_position: r.last_position as number | null,
      updated_at: r.updated_at as string | null,
      points_awarded: r.points_awarded as number | null,
      student_reg_id: r.student_reg_id as string | null,
    });
  }

  // Filter to in_progress rows. If a tabKeyHint is set, restrict further.
  return out.filter(r => r.status !== 'completed')
    .filter(r => !tabKeyHint || r.tab_key === tabKeyHint);
}

async function forceCompleteRow(
  row: {
    source: 'cert' | 'live';
    tab_key: string;
    id: string;
    status: string | null;
    watch_seconds: number | null;
    total_seconds: number | null;
    watch_percentage: number | null;
    completed_via: string | null;
    last_position: number | null;
    updated_at: string | null;
    points_awarded?: number | null;
    student_reg_id?: string | null;
  },
  email: string,
  reason: string,
  adminId: string,
  adminEmail: string,
): Promise<BeforeAfter> {
  const sb = getServerClient();
  const nowIso = new Date().toISOString();

  const before = {
    status: row.status,
    watch_percentage: row.watch_percentage,
    watch_seconds: row.watch_seconds,
    total_seconds: row.total_seconds,
    completed_via: row.completed_via,
    last_position: row.last_position,
    updated_at: row.updated_at,
  };

  // Defensive: skip if already completed (idempotent re-runs).
  if (row.status === 'completed') {
    return {
      source: row.source, key: row.tab_key, email,
      before,
      after: null,
      outcome: 'already_completed',
    };
  }

  const newPct = (row.total_seconds ?? 0) > 0 && (row.watch_seconds ?? 0) > 0
    ? Math.min(100, Math.round(((row.watch_seconds ?? 0) / (row.total_seconds ?? 1)) * 100))
    : 100;
  const finalPct = Math.max(row.watch_percentage ?? 0, newPct);

  if (row.source === 'cert') {
    const { error } = await sb
      .from('certification_watch_history')
      .update({
        status:           'completed',
        completed_at:     nowIso,
        watch_percentage: finalPct,
        completed_via:    'admin_override',
        updated_at:       nowIso,
      })
      .eq('id', row.id);
    if (error) {
      return {
        source: row.source, key: row.tab_key, email,
        before, after: null,
        outcome: 'error', error: error.message,
      };
    }
  } else {
    const shouldAwardPoints = (row.points_awarded ?? 0) === 0;
    const { error } = await sb
      .from('session_watch_history')
      .update({
        status:           'completed',
        watched_at:       nowIso,
        watch_percentage: finalPct,
        completed_via:    'admin_override',
        updated_at:       nowIso,
        ...(shouldAwardPoints ? { points_awarded: 50 } : {}),
      })
      .eq('id', row.id);
    if (error) {
      return {
        source: row.source, key: row.tab_key, email,
        before, after: null,
        outcome: 'error', error: error.message,
      };
    }
    // Bump student_profiles.total_points if we just awarded them.
    if (shouldAwardPoints && row.student_reg_id) {
      const { data: profile } = await sb
        .from('student_profiles')
        .select('total_points')
        .eq('registration_id', row.student_reg_id)
        .maybeSingle();
      if (profile) {
        await sb
          .from('student_profiles')
          .update({ total_points: (profile.total_points ?? 0) + 50 })
          .eq('registration_id', row.student_reg_id);
      }
    }
  }

  // Audit trail. action='watch_force_complete' matches the endpoint's
  // string so downstream reports group across script + UI uniformly.
  const { error: auditErr } = await sb.from('admin_audit_log').insert({
    admin_id: adminId,
    action: 'watch_force_complete',
    after_value: {
      tab_key: row.tab_key,
      email,
      reason,
      previous_status: row.status,
      previous_pct: row.watch_percentage ?? 0,
      new_pct: finalPct,
      admin_email: adminEmail,
      via: 'phase5_recovery_script',
    },
  });
  if (auditErr) console.error(`  audit insert failed for ${row.tab_key}:`, auditErr.message);

  return {
    source: row.source, key: row.tab_key, email,
    before,
    after: {
      status: 'completed',
      watch_percentage: finalPct,
      completed_via: 'admin_override',
      points_awarded: row.source === 'live' && (row.points_awarded ?? 0) === 0,
    },
    outcome: 'completed',
  };
}

async function main() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });

  console.log('Phase 5 surgical recovery starting...\n');

  const admin = await lookupAdminId();
  if (!admin) {
    throw new Error('No admin user found. Cannot proceed without admin_id for audit log.');
  }
  console.log(`Admin user: ${admin.email}  (id=${admin.id.slice(0, 8)}…)\n`);

  const allReports: Array<{
    target: Target;
    resolvedEmail: string | null;
    rows: BeforeAfter[];
  }> = [];

  for (const target of TARGETS) {
    const email = await resolveEmail(target);
    console.log(`---  ${email ?? '<lookup failed>'}  (${target.regId ?? 'by-email'})  ---`);

    if (!email) {
      console.log('  Could not resolve email. Skipping.\n');
      allReports.push({ target, resolvedEmail: null, rows: [] });
      continue;
    }

    const rows = await fetchAllStuckRowsForEmail(email, target.tabKeyHint);
    if (rows.length === 0) {
      console.log('  No in_progress rows match' + (target.tabKeyHint ? ` for ${target.tabKeyHint}` : '') + '. Skipping.\n');
      allReports.push({ target, resolvedEmail: email, rows: [] });
      continue;
    }

    const reports: BeforeAfter[] = [];
    for (const row of rows) {
      const pctStr = String(row.watch_percentage ?? 0).padStart(3);
      console.log(`  ${row.tab_key.padEnd(14)} pct=${pctStr}%  pts=${row.points_awarded ?? 0}  status=${row.status}  -> forcing complete`);
      const result = await forceCompleteRow(row, email, target.reason, admin.id, admin.email);
      reports.push(result);
      if (result.outcome === 'completed') {
        const pa = result.after?.points_awarded ? ' (+50 pts)' : '';
        console.log(`    OK  before=${result.before.watch_percentage ?? 0}%  after=${result.after?.watch_percentage}%${pa}`);
      } else if (result.outcome === 'already_completed') {
        console.log(`    SKIP already completed (idempotent re-run)`);
      } else {
        console.log(`    FAIL ${result.error ?? 'unknown'}`);
      }
    }
    console.log('');
    allReports.push({ target, resolvedEmail: email, rows: reports });
  }

  // Persist full report (audit trail in version control)
  const fullReport = {
    generated_at: new Date().toISOString(),
    admin: { id: admin.id, email: admin.email },
    targets: allReports,
    summary: {
      rows_completed: allReports.flatMap(r => r.rows).filter(r => r.outcome === 'completed').length,
      rows_already_completed: allReports.flatMap(r => r.rows).filter(r => r.outcome === 'already_completed').length,
      rows_failed: allReports.flatMap(r => r.rows).filter(r => r.outcome === 'error').length,
    },
  };
  await fs.writeFile(REPORT_FILE, JSON.stringify(fullReport, null, 2));
  console.log(`Report written to: ${path.relative(process.cwd(), REPORT_FILE)}`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`  Completed: ${fullReport.summary.rows_completed}`);
  console.log(`  Already completed (idempotent): ${fullReport.summary.rows_already_completed}`);
  console.log(`  Failed: ${fullReport.summary.rows_failed}`);

  // Fakhri email draft
  const fakhriReport = allReports.find(r => r.target.regId === 'FMP-2026-0035');
  const fakhriEmail = fakhriReport?.resolvedEmail ?? '<email-lookup-failed>';
  const fakhriRowsCompleted = fakhriReport?.rows.some(r => r.outcome === 'completed');

  const draft = `# DRAFT EMAIL FOR FAKHRI (FMP-2026-0035)

**Status of recovery:** ${fakhriRowsCompleted ? 'Successfully unlocked. Send this email.' : 'No row was unlocked (already completed or no row matched). Verify before sending.'}

**To:** ${fakhriEmail}
**Subject:** Re: Course 2 Progress Issue - Resolved

---

Hi Fakhri,

Thank you for your patience and for bringing this to our attention. Your case helped us identify a tracking issue that was affecting several students.

We have fixed the underlying problem and your stuck session has been unlocked. You can now continue with the assessment for your course.

Going forward, the progress tracking is more reliable, and you will see your watch percentage displayed in the video player so you always know where you stand.

If you encounter any further issues, please reply to this email and we will assist you immediately.

Best regards,
Ahmad Din
Founder, Financial Modeler Pro

---

This file is gitignored (TEMP_*.md). Delete it after sending.
`;
  await fs.writeFile(FAKHRI_EMAIL_FILE, draft);
  console.log(`\nFakhri email draft saved to: ${path.relative(process.cwd(), FAKHRI_EMAIL_FILE)} (gitignored)`);
}

main().catch(e => {
  console.error('Phase 5 recovery FAILED:', e);
  process.exit(1);
});

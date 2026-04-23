/**
 * GET /api/admin/analytics?range=7|30|90|all
 *
 * Single aggregated endpoint for the /admin/analytics dashboard. Pulls
 * from every live data source in parallel:
 *
 *   - training_registrations_meta    (total students + daily signups)
 *   - training_enrollments            (per-course enrollment + 3SFM vs BVM)
 *   - training_assessment_results     (session attempts + passes, activity)
 *   - certification_watch_history     (per-session watch tally, activity)
 *   - student_certificates            (certificate issue counts)
 *   - live_sessions                   (live session metadata)
 *   - session_registrations           (live session RSVPs + attended flag)
 *   - session_watch_history           (live session recording watches)
 *
 * Everything is computed in-process so the dashboard runs off one round
 * trip. Response is small (a few hundred KB at most) and admin-only
 * (NextAuth admin-role gate + `revalidate = 0` so the data is always
 * fresh).
 *
 * `range` filters the growth trend window. The funnel / course-summary
 * / certificate / live-session sections are cumulative (they reflect
 * the current state of the platform, not just the selected window) -
 * trying to filter those would produce numbers that misread at a
 * glance.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { COURSES } from '@/src/config/courses';

export const runtime    = 'nodejs';
export const revalidate = 0;
export const dynamic    = 'force-dynamic';

type Range = '7' | '30' | '90' | 'all';

interface CourseKey { code: '3SFM' | 'BVM'; slug: '3sfm' | 'bvm'; sessionsTotal: number; regularCount: number; }
const COURSE_KEYS: CourseKey[] = [
  { code: '3SFM', slug: '3sfm', sessionsTotal: COURSES['3sfm']?.sessions.length ?? 18, regularCount: (COURSES['3sfm']?.sessions ?? []).filter(s => !s.isFinal).length },
  { code: 'BVM',  slug: 'bvm',  sessionsTotal: COURSES['bvm']?.sessions.length  ?? 7,  regularCount: (COURSES['bvm']?.sessions  ?? []).filter(s => !s.isFinal).length  },
];

function tabKey(courseCode: '3SFM' | 'BVM', sessionId: string, isFinal: boolean): string {
  return isFinal ? `${courseCode}_Final` : `${courseCode}_${sessionId}`;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rawRange = (req.nextUrl.searchParams.get('range') ?? '30') as Range;
  const rangeDays = rawRange === 'all' ? 365 * 3 : (parseInt(rawRange, 10) || 30);
  const now       = Date.now();
  const cutoffMs  = now - rangeDays * 86_400_000;
  const cutoffIso = new Date(cutoffMs).toISOString();
  const window7d  = now - 7  * 86_400_000;
  const window30d = now - 30 * 86_400_000;

  const sb = getServerClient();

  // Fire all independent queries in parallel.
  const [
    metaRes,
    enrollRes,
    assessRes,
    watchRes,
    certRes,
    liveRes,
    liveRegRes,
    liveWatchRes,
  ] = await Promise.all([
    sb.from('training_registrations_meta')
      .select('registration_id, email, name, created_at, email_confirmed'),
    sb.from('training_enrollments')
      .select('registration_id, course_code'),
    sb.from('training_assessment_results')
      .select('email, tab_key, score, passed, is_final, attempts, completed_at'),
    sb.from('certification_watch_history')
      .select('student_email, tab_key, status, watch_percentage, updated_at, completed_at'),
    sb.from('student_certificates')
      .select('email, course_code, cert_status, issued_at'),
    sb.from('live_sessions')
      .select('id, title, session_type, scheduled_datetime, is_published')
      .eq('is_published', true)
      .order('scheduled_datetime', { ascending: false })
      .limit(40),
    sb.from('session_registrations')
      .select('session_id, student_email, attended'),
    sb.from('session_watch_history')
      .select('session_id, student_email, status, watch_percentage'),
  ]);

  type MetaRow   = { registration_id: string; email: string; name: string | null; created_at: string | null; email_confirmed: boolean | null; };
  type EnrollRow = { registration_id: string; course_code: string };
  type AssessRow = { email: string; tab_key: string; score: number | null; passed: boolean | null; is_final: boolean | null; attempts: number | null; completed_at: string | null };
  type WatchRow  = { student_email: string; tab_key: string; status: string | null; watch_percentage: number | null; updated_at: string | null; completed_at: string | null };
  type CertRow   = { email: string; course_code: string | null; cert_status: string | null; issued_at: string | null };
  type LiveRow   = { id: string; title: string; session_type: string | null; scheduled_datetime: string | null; is_published: boolean };
  type LiveRegRow = { session_id: string; student_email: string; attended: boolean | null };
  type LiveWatchRow = { session_id: string; student_email: string; status: string | null; watch_percentage: number | null };

  const metas       = (metaRes.data       ?? []) as MetaRow[];
  const enrolls     = (enrollRes.data     ?? []) as EnrollRow[];
  const assessments = (assessRes.data     ?? []) as AssessRow[];
  const watches     = (watchRes.data      ?? []) as WatchRow[];
  const certs       = (certRes.data       ?? []) as CertRow[];
  const liveSess    = (liveRes.data       ?? []) as LiveRow[];
  const liveRegs    = (liveRegRes.data    ?? []) as LiveRegRow[];
  const liveWatches = (liveWatchRes.data  ?? []) as LiveWatchRow[];

  // ── OVERVIEW ─────────────────────────────────────────────────────────────
  // Total: every meta row (even unconfirmed - the confirmed gate is already
  // applied by the registration flow so an unconfirmed row only exists for
  // a short window after signup. Counting all is cleaner for leadership
  // reporting than hiding in-flight registrations).
  const totalStudents = metas.length;

  // Active: emails that have any assessment completion OR watch progress
  // update inside the window. Uses the MAX of the two timestamps so a
  // student who only watched (no assessment yet) still counts.
  const lastActivityByEmail = new Map<string, number>();
  const bumpActivity = (email: string, iso: string | null) => {
    if (!iso || !email) return;
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) return;
    const prev = lastActivityByEmail.get(email.toLowerCase());
    if (!prev || ms > prev) lastActivityByEmail.set(email.toLowerCase(), ms);
  };
  for (const a of assessments) bumpActivity(a.email ?? '', a.completed_at);
  for (const w of watches)     bumpActivity(w.student_email ?? '', w.updated_at);

  let active7d  = 0;
  let active30d = 0;
  for (const [, ms] of lastActivityByEmail) {
    if (ms >= window30d) active30d++;
    if (ms >= window7d)  active7d++;
  }

  // ── COURSE ENROLLMENT + CERT COUNT ───────────────────────────────────────
  const enrolledByCourse = new Map<'3SFM' | 'BVM', Set<string>>([
    ['3SFM', new Set()],
    ['BVM',  new Set()],
  ]);
  // registration_id -> email for joining enrollments to assessments/certs
  const emailByRegId = new Map<string, string>();
  for (const m of metas) emailByRegId.set(m.registration_id, (m.email ?? '').toLowerCase());
  for (const e of enrolls) {
    const code = (e.course_code ?? '').toUpperCase() as '3SFM' | 'BVM';
    if (code !== '3SFM' && code !== 'BVM') continue;
    const email = emailByRegId.get(e.registration_id);
    if (email) enrolledByCourse.get(code)!.add(email);
  }

  const certifiedByCourse = new Map<'3SFM' | 'BVM', Set<string>>([
    ['3SFM', new Set()],
    ['BVM',  new Set()],
  ]);
  for (const c of certs) {
    if ((c.cert_status ?? '') !== 'Issued') continue;
    const code = (c.course_code ?? '').toUpperCase() as '3SFM' | 'BVM';
    if (code !== '3SFM' && code !== 'BVM') continue;
    certifiedByCourse.get(code)!.add((c.email ?? '').toLowerCase());
  }
  const totalCertified = certifiedByCourse.get('3SFM')!.size + certifiedByCourse.get('BVM')!.size;
  const totalEnrolled  = enrolledByCourse.get('3SFM')!.size + enrolledByCourse.get('BVM')!.size;
  const certificationRate = totalEnrolled > 0 ? Math.round((totalCertified / totalEnrolled) * 1000) / 10 : 0;

  // ── GROWTH TREND ─────────────────────────────────────────────────────────
  // Daily signups within the window, plus a running cumulative so the UI
  // can draw both curves on the same chart. Dates are ISO YYYY-MM-DD in UTC.
  const growthDailyMap = new Map<string, number>();
  const cutoffDate = new Date(cutoffMs); cutoffDate.setUTCHours(0, 0, 0, 0);
  // Seed every day in the window with 0 so sparse data still produces a
  // smooth line.
  for (let d = new Date(cutoffDate); d.getTime() <= now; d.setUTCDate(d.getUTCDate() + 1)) {
    growthDailyMap.set(isoDay(d), 0);
  }
  // Also count cumulative baseline (signups BEFORE the window starts) so
  // the cumulative line starts at the right level.
  let cumulativeBeforeWindow = 0;
  for (const m of metas) {
    if (!m.created_at) continue;
    const t = new Date(m.created_at).getTime();
    if (t < cutoffMs) { cumulativeBeforeWindow++; continue; }
    const day = isoDay(new Date(m.created_at));
    growthDailyMap.set(day, (growthDailyMap.get(day) ?? 0) + 1);
  }
  let running = cumulativeBeforeWindow;
  const growth = Array.from(growthDailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, daily]) => {
      running += daily;
      return { date, daily, cumulative: running };
    });

  // ── COURSE COMPARISON ────────────────────────────────────────────────────
  // For each course:
  //   enrolled   = distinct email in training_enrollments for this course
  //   started    = enrolled AND passed at least 1 session of this course
  //   completed  = passed all sessions of this course (regular + final)
  //   certified  = has Issued certificate for this course
  //   avg_score  = mean of all assessment scores for this course
  //   completion_rate = completed / enrolled * 100
  const passedTabsByEmail = new Map<string, Set<string>>();
  const scoresByCourse    = new Map<'3SFM' | 'BVM', number[]>([['3SFM', []], ['BVM', []]]);
  for (const a of assessments) {
    const email = (a.email ?? '').toLowerCase();
    if (!email) continue;
    // Credit scores per course regardless of pass status - gives a
    // truer picture than "avg of passing scores only."
    const tk = a.tab_key ?? '';
    const code: '3SFM' | 'BVM' | null =
      tk.startsWith('3SFM_') ? '3SFM' :
      tk.startsWith('BVM_')  ? 'BVM'  : null;
    if (code && typeof a.score === 'number') scoresByCourse.get(code)!.push(a.score);
    if (a.passed) {
      const set = passedTabsByEmail.get(email) ?? new Set<string>();
      set.add(tk);
      passedTabsByEmail.set(email, set);
    }
  }

  const courses = COURSE_KEYS.map(({ code, slug, sessionsTotal, regularCount }) => {
    const enrolled = enrolledByCourse.get(code)!;
    const enrolledArr = Array.from(enrolled);

    const tabsRegular = (COURSES[slug]?.sessions ?? []).filter(s => !s.isFinal).map(s => tabKey(code, s.id, false));
    const tabFinal    = (COURSES[slug]?.sessions ?? []).find(s => s.isFinal);
    const tabFinalKey = tabFinal ? tabKey(code, tabFinal.id, true) : null;

    let started = 0, completed = 0;
    for (const email of enrolledArr) {
      const passedSet = passedTabsByEmail.get(email) ?? new Set<string>();
      if (tabsRegular.some(t => passedSet.has(t))) started++;
      const allRegular = tabsRegular.every(t => passedSet.has(t));
      const finalDone  = tabFinalKey ? passedSet.has(tabFinalKey) : true;
      if (allRegular && finalDone) completed++;
    }
    const certified = certifiedByCourse.get(code)!.size;
    const scores    = scoresByCourse.get(code)!;
    const avgScore  = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;

    return {
      code,
      enrolled:        enrolled.size,
      started,
      completed,
      certified,
      avg_score:       avgScore,
      completion_rate: enrolled.size > 0 ? Math.round((completed / enrolled.size) * 1000) / 10 : 0,
      sessions_total:  sessionsTotal,
      regular_count:   regularCount,
    };
  });

  // ── SESSION FUNNELS (per course) ─────────────────────────────────────────
  // For every session (S1..Sn + Final): enrolled / watched / attempted /
  // passed distinct-email counts. drop_off_from_prev reports how many
  // students made it to this stage that DIDN'T in the previous stage
  // (negative = growth, usually late-starters catching up).
  function buildFunnel(code: '3SFM' | 'BVM', slug: '3sfm' | 'bvm') {
    const cfg = COURSES[slug];
    if (!cfg) return [];
    const enrolled = enrolledByCourse.get(code)!.size;

    // Index watched / attempted / passed tallies by tab_key + email set
    const watchedByTab   = new Map<string, Set<string>>();
    const attemptedByTab = new Map<string, Set<string>>();
    const passedByTab    = new Map<string, Set<string>>();

    for (const w of watches) {
      const tk = w.tab_key ?? '';
      if (!tk.startsWith(`${code}_`)) continue;
      const email = (w.student_email ?? '').toLowerCase();
      if (!email) continue;
      if (w.status === 'completed' || w.status === 'in_progress' || (w.watch_percentage ?? 0) > 0) {
        const set = watchedByTab.get(tk) ?? new Set<string>();
        set.add(email);
        watchedByTab.set(tk, set);
      }
    }
    for (const a of assessments) {
      const tk = a.tab_key ?? '';
      if (!tk.startsWith(`${code}_`)) continue;
      const email = (a.email ?? '').toLowerCase();
      if (!email) continue;
      const attempts = a.attempts ?? 0;
      if (attempts > 0 || a.passed || typeof a.score === 'number') {
        const set = attemptedByTab.get(tk) ?? new Set<string>();
        set.add(email);
        attemptedByTab.set(tk, set);
      }
      if (a.passed) {
        const set = passedByTab.get(tk) ?? new Set<string>();
        set.add(email);
        passedByTab.set(tk, set);
      }
    }

    const rows = cfg.sessions.map((sess, idx) => {
      const tk = tabKey(code, sess.id, sess.isFinal);
      const watched   = watchedByTab.get(tk)?.size   ?? 0;
      const attempted = attemptedByTab.get(tk)?.size ?? 0;
      const passed    = passedByTab.get(tk)?.size    ?? 0;
      return {
        index:     idx + 1,
        session_id: sess.id,
        title:      sess.title,
        is_final:   sess.isFinal,
        tab_key:    tk,
        enrolled,
        watched,
        attempted,
        passed,
        pass_rate_vs_enrolled: enrolled > 0 ? Math.round((passed / enrolled) * 1000) / 10 : 0,
        watch_rate:            enrolled > 0 ? Math.round((watched / enrolled) * 1000) / 10 : 0,
      };
    });

    // drop_off_from_prev = (passed at stage N-1) - (passed at stage N).
    // Positive value means students lost between sessions - the top
    // absolute drop across the course is the UI's "biggest dropoff point"
    // callout.
    for (let i = 0; i < rows.length; i++) {
      const prevPassed = i === 0 ? enrolled : rows[i - 1].passed;
      const dropOff = prevPassed - rows[i].passed;
      (rows[i] as { drop_off_from_prev?: number }).drop_off_from_prev = dropOff;
    }

    return rows as (typeof rows[number] & { drop_off_from_prev: number })[];
  }

  const funnel_3sfm = buildFunnel('3SFM', '3sfm');
  const funnel_bvm  = buildFunnel('BVM',  'bvm');

  // ── LIVE SESSIONS ────────────────────────────────────────────────────────
  const regsBySession       = new Map<string, LiveRegRow[]>();
  const watchesBySession    = new Map<string, LiveWatchRow[]>();
  for (const r of liveRegs) {
    const arr = regsBySession.get(r.session_id) ?? [];
    arr.push(r);
    regsBySession.set(r.session_id, arr);
  }
  for (const w of liveWatches) {
    const arr = watchesBySession.get(w.session_id) ?? [];
    arr.push(w);
    watchesBySession.set(w.session_id, arr);
  }
  const live_sessions = liveSess.map(s => {
    const regs = regsBySession.get(s.id) ?? [];
    const wats = watchesBySession.get(s.id) ?? [];
    const attended = regs.filter(r => r.attended === true).length;
    const watched = wats.length;
    const watchedCompleted = wats.filter(w => w.status === 'completed' || (w.watch_percentage ?? 0) >= 90).length;
    return {
      id:              s.id,
      title:           s.title,
      session_type:    s.session_type ?? 'unknown',
      scheduled_datetime: s.scheduled_datetime ?? null,
      registered:      regs.length,
      attended,
      attendance_rate: regs.length > 0 ? Math.round((attended / regs.length) * 1000) / 10 : 0,
      watched,
      watched_completed: watchedCompleted,
      watch_rate:      regs.length > 0 ? Math.round((watched / regs.length) * 1000) / 10 : 0,
    };
  });

  // Biggest drop-off across either course - the UI shows this as a
  // headline callout.
  const allFunnelRows = [
    ...funnel_3sfm.map(r => ({ ...r, course: '3SFM' as const })),
    ...funnel_bvm.map(r  => ({ ...r, course: 'BVM'  as const })),
  ];
  const biggestDropoff = allFunnelRows
    .filter(r => (r.drop_off_from_prev ?? 0) > 0)
    .sort((a, b) => (b.drop_off_from_prev ?? 0) - (a.drop_off_from_prev ?? 0))[0] ?? null;

  return NextResponse.json({
    updated_at: new Date().toISOString(),
    range:      rawRange,
    overview: {
      total_students:    totalStudents,
      active_7d:         active7d,
      active_30d:        active30d,
      total_enrolled:    totalEnrolled,
      total_certified:   totalCertified,
      certification_rate: certificationRate,
      sfm_enrolled:      enrolledByCourse.get('3SFM')!.size,
      bvm_enrolled:      enrolledByCourse.get('BVM')!.size,
    },
    growth,
    courses,
    funnel_3sfm,
    funnel_bvm,
    biggest_dropoff: biggestDropoff,
    live_sessions,
  });
}

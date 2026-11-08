/**
 * verify-live-course.ts
 *
 * The REFM live course (Training Hub): one verifier, one section per build unit.
 *
 * UNIT 0, the join link is private.
 *   A Teams join link, its password and the dial-in let anyone into the meeting.
 *   The public live-session routes used to return every column, so they reached
 *   any visitor; the newsletter auto-notify emailed the join link to public
 *   subscribers. The rule now lives in ONE place
 *   (src/hubs/training/lib/liveSessions/privateSessionFields.ts):
 *     - an unchecked route returns a session only through withoutPrivateFields;
 *     - the join link reaches a browser only through joinDetailsFor, which gives
 *       it to the signed student registered for that session;
 *     - a public announcement links the public session page, never the meeting.
 *   U0.4 calls the REAL public route handlers against the live database.
 *
 * Run: npx tsx scripts/verify-live-course.ts   (needs .env.local for U0.4)
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';
import {
  PRIVATE_SESSION_FIELDS, withoutPrivateFields, joinDetailsFor,
  publicSessionUrl, sessionPlatformLabel,
} from '../src/hubs/training/lib/liveSessions/privateSessionFields';

for (const f of ['.env.local', '.env']) {
  try {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === 'route.ts') out.push(p);
  }
  return out;
}

const hasPrivateKey = (o: Record<string, unknown>): string[] =>
  PRIVATE_SESSION_FIELDS.filter((k) => Object.prototype.hasOwnProperty.call(o, k));

async function unit0(): Promise<void> {
  console.log('=== Unit 0: the join link is private ===\n');

  // U0.1 withoutPrivateFields drops every private column and keeps the rest.
  const row = {
    id: 's1', title: 'Session 1', youtube_url: 'https://youtu.be/x',
    live_url: 'https://teams.microsoft.com/l/meetup-join/abc', live_password: 'pw',
    teams_dial_in: { conferenceId: '123' }, teams_meeting_id: 'evt',
  };
  const pub = withoutPrivateFields(row) as Record<string, unknown>;
  check('U0.1a every private field is removed', hasPrivateKey(pub).length === 0, `left: ${hasPrivateKey(pub).join(',')}`);
  check('U0.1b public fields are kept', pub.id === 's1' && pub.title === 'Session 1' && pub.youtube_url === row.youtube_url);
  check('U0.1c has_live_url is true when a link exists', pub.has_live_url === true);
  check('U0.1d has_live_url is false for no link', withoutPrivateFields({ id: 'x', live_url: null }).has_live_url === false);
  check('U0.1e has_live_url is false for a blank link', withoutPrivateFields({ id: 'x', live_url: '   ' }).has_live_url === false);
  check('U0.1f the input row is not mutated', row.live_url !== undefined && row.live_password === 'pw');

  // U0.2 joinDetailsFor: the link goes to a registered student, and only then.
  const sess = { live_url: ' https://teams/x ', live_password: 'pw' };
  const no = joinDetailsFor(false, sess);
  check('U0.2a not registered: no link, no password', no.liveUrl === null && no.livePassword === null);
  const yes = joinDetailsFor(true, sess);
  check('U0.2b registered: link and password, trimmed', yes.liveUrl === 'https://teams/x' && yes.livePassword === 'pw');
  const empty = joinDetailsFor(true, { live_url: '', live_password: null });
  check('U0.2c registered, nothing stored: nulls, never empty strings', empty.liveUrl === null && empty.livePassword === null);
  check('U0.2d registered, session missing: nulls', joinDetailsFor(true, null).liveUrl === null);

  // U0.3 THE RULE across every student-facing and public route: a route that
  // reads live_sessions either strips private fields, or names them and hands
  // them out only through joinDetailsFor. Measured, so each branch must fire.
  const files = [...walk('app/api/training'), ...walk('app/api/public')];
  let readers = 0, starReaders = 0, namedReaders = 0;
  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (!src.includes("from('live_sessions')")) continue;
    readers++;
    // String or template selects; SESSION_ACCESS_COLUMNS (sessionAccess.ts) names live_url.
    const selects = [...src.matchAll(/from\('live_sessions'\)\s*\.select\(\s*(?:['`]([^'`]*)['`]|(SESSION_ACCESS_COLUMNS))/g)]
      .map((m) => (m[2] ? 'live_url' : m[1].replace('${SESSION_ACCESS_COLUMNS}', 'live_url')));
    const star = selects.some((s) => s.trim().startsWith('*'));
    const named = selects.some((s) => /\b(live_url|live_password|teams_dial_in|teams_meeting_id)\b/.test(s));
    if (star) { starReaders++; if (!src.includes('withoutPrivateFields(')) offenders.push(`${f} selects * without withoutPrivateFields`); }
    // The one rule: joinDetailsFor (password) and joinStatusFrom / the join route (link).
    if (named) { namedReaders++; if (!src.includes('joinDetailsFor(') && !src.includes('joinStatusFrom(') && !src.includes('studentHasSessionAccess(')) offenders.push(`${f} reads a private field without the one rule`); }
  }
  check('U0.3a routes reading live_sessions were found', readers >= 4, `found ${readers}`);
  check('U0.3b the select-* branch was exercised', starReaders >= 2, `found ${starReaders}`);
  check('U0.3c the named-private-field branch was exercised', namedReaders >= 2, `found ${namedReaders}`);
  check('U0.3d no route returns a private field outside the one rule', offenders.length === 0, offenders.join(' | '));

  // U0.4 the REAL public handlers against the live database.
  if (!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    check('U0.4 credentials loaded for the live handler check', false, 'no SUPABASE_URL; run through npm run verify:suite');
  } else {
    const list = await import('../app/api/training/live-sessions/route');
    let total = 0, withLink = 0; const leaks: string[] = [];
    let firstId: string | null = null;
    for (const type of ['upcoming', 'recorded', '']) {
      const res = await list.GET(new NextRequest(`https://learn.financialmodelerpro.com/api/training/live-sessions${type ? `?type=${type}` : ''}`));
      const body = await res.json() as { sessions?: Record<string, unknown>[] };
      for (const s of body.sessions ?? []) {
        total++;
        if (s.has_live_url === true) withLink++;
        firstId ??= String(s.id);
        const k = hasPrivateKey(s);
        if (k.length) leaks.push(`${s.id}: ${k.join(',')}`);
      }
    }
    check('U0.4a the public list returned published sessions', total > 0, `got ${total}`);
    check('U0.4b no session in the public list carries a private field', leaks.length === 0, leaks.slice(0, 3).join(' | '));
    console.log(`        (${total} rows across the three lists, ${withLink} with a meeting link that is now withheld)`);
    if (firstId) {
      const one = await import('../app/api/training/live-sessions/[id]/route');
      const res = await one.GET(new NextRequest(`https://learn.financialmodelerpro.com/api/training/live-sessions/${firstId}`), { params: Promise.resolve({ id: firstId }) });
      const body = await res.json() as { session?: Record<string, unknown> };
      check('U0.4c the public detail route returned the session', !!body.session);
      check('U0.4d the public detail carries no private field', !!body.session && hasPrivateKey(body.session).length === 0, body.session ? hasPrivateKey(body.session).join(',') : '');
    }
  }

  // U0.5 a public announcement never carries the join link.
  const announcers = [...walk('app'), ...walk('src')].filter((f) => readFileSync(f, 'utf8').includes('sendAutoNewsletter('));
  const allSrc = (dir: string): string[] => {
    const out: string[] = [];
    const rec = (d: string): void => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) rec(p); else if (/\.tsx?$/.test(n)) out.push(p); } };
    rec(dir); return out;
  };
  const callers = [...allSrc('app'), ...allSrc('src')].filter((f) => /sendAutoNewsletter\(\s*'live_session_scheduled'/.test(readFileSync(f, 'utf8')));
  check('U0.5a the live-session announcement callers were found', callers.length >= 2, `found ${callers.length} (${announcers.length} route files announce)`);
  const bad = callers.filter((f) => /url:\s*[a-z]+\.live_url/.test(readFileSync(f, 'utf8')));
  check('U0.5b no announcement uses live_url as its link', bad.length === 0, bad.join(', '));
  const viaRule = callers.filter((f) => readFileSync(f, 'utf8').includes('publicSessionUrl('));
  check('U0.5c every announcement links the public session page', viaRule.length === callers.length, `${viaRule.length} of ${callers.length}`);
  check('U0.5d the public page link is the session page', publicSessionUrl('https://learn.example.com/', 'abc') === 'https://learn.example.com/training-sessions/abc');
  check('U0.5e the platform reads Teams for a Teams session, never YouTube', sessionPlatformLabel('teams') === 'Microsoft Teams' && sessionPlatformLabel(null) === 'Live online');
}

const hasCreds = (): boolean => !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
async function db() {
  const { getServerClient } = await import('../src/core/db/supabase');
  return getServerClient();
}

async function unit1(): Promise<void> {
  console.log('\n=== Unit 1: course rules and data ===\n');
  const cs = await import('../src/hubs/training/lib/liveCourse/courseSettings');

  check('U1.1a course codes normalise to upper case', cs.normaliseCourseCode(' refm ') === 'REFM');
  check('U1.1b a malformed code is refused', cs.normaliseCourseCode('re fm') === null && cs.normaliseCourseCode(7) === null);
  const d = cs.settingsFromRow({ course_code: 'refm', exams_enabled: false });
  check('U1.1c absent values take the migration defaults', d.attendanceThresholdPct === 75 && d.recordingCompletePct === 95 && d.maxSubmissionAttempts === 3 && d.allowMixedRoutes && d.certRoutes.join() === 'live,recording');
  check('U1.1d attempts clamp to 1..10', cs.settingsFromRow({ course_code: 'X1', max_submission_attempts: 99 }).maxSubmissionAttempts === 10);
  check('U1.1e an exam course (no row) is never a live course', cs.isLiveCourseRow(null) === false);
  check('U1.1f a row with exams on is not a live course', cs.isLiveCourseRow(cs.settingsFromRow({ course_code: 'X1', exams_enabled: true })) === false);

  if (!hasCreds()) { check('U1.2 credentials loaded for the schema probe', false, 'run through npm run verify:suite'); return; }
  const sb = await db();
  const refm = await cs.getLiveCourseSettings(sb, 'REFM');
  check('U1.2a REFM is seeded as a live course', cs.isLiveCourseRow(refm), JSON.stringify(refm));
  check('U1.2b REFM rules: 75% live, 95% recording, 3 attempts, mixed, no exams',
    !!refm && refm.attendanceThresholdPct === 75 && refm.recordingCompletePct === 95 && refm.maxSubmissionAttempts === 3 && refm.allowMixedRoutes && !refm.examsEnabled);
  for (const exam of ['3SFM', 'BVM']) {
    check(`U1.2c ${exam} has no live-course row (keeps the exam path)`, (await cs.getLiveCourseSettings(sb, exam)) === null);
  }
  const probes: [string, string][] = [
    ['live_sessions', 'course_code, course_session_no, graph_online_meeting_id, attendance_synced_at, attendance_sync_error, actual_start_at, actual_end_at, day_reminder_sent_at'],
    ['live_session_attendance', 'id, session_id, attendee_email, student_email, matched_by, intervals, attended_seconds, session_seconds, attended_pct, source'],
    ['student_email_aliases', 'alias_email, student_email'],
    ['live_session_join_clicks', 'id, session_id, student_email, clicked_at'],
    ['training_pending_registrations', 'enrol_course_code'],
    ['training_enrollments', 'source, confirmation_sent_at'],
    ['model_submissions', 'superseded_at, superseded_by, superseded_reason'],
  ];
  for (const [table, cols] of probes) {
    const { error } = await sb.from(table).select(cols).limit(1);
    check(`U1.3 ${table} has the mig 247/248 columns`, !error, error?.message ?? '');
  }
}

/**
 * A tiny in-memory stand-in for the Supabase query builder: enough of
 * select/eq/is/in/order/limit/maybeSingle/single/insert/upsert/update/delete
 * for the live-course rules, so they run end to end with no production writes.
 */
type Row = Record<string, unknown>;
export function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let seq = 0;
  const from = (table: string) => {
    tables[table] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
    let payload: Row | Row[] | null = null;
    let conflict: string[] = [];
    let ignoreDup = false;
    let orderBy: { col: string; asc: boolean }[] = [];
    let lim: number | null = null;
    const run = (): { data: Row[]; error: null | { message: string } } => {
      const rows = tables[table];
      if (op === 'insert' || op === 'upsert') {
        const list = Array.isArray(payload) ? payload : [payload as Row];
        const out: Row[] = [];
        for (const p of list) {
          const keys = conflict.length ? conflict : [];
          const hit = keys.length ? rows.find((r) => keys.every((k) => r[k] === p[k])) : undefined;
          if (hit) {
            if (op === 'insert') return { data: [], error: { message: 'duplicate key value violates unique constraint' } };
            if (!ignoreDup) Object.assign(hit, p);
            if (!ignoreDup) out.push(hit);
            continue;
          }
          const r = { id: `id_${++seq}`, ...p };
          rows.push(r); out.push(r);
        }
        return { data: out, error: null };
      }
      let sel = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') { for (const r of sel) Object.assign(r, payload); return { data: sel, error: null }; }
      if (op === 'delete') { tables[table] = rows.filter((r) => !sel.includes(r)); return { data: sel, error: null }; }
      for (const o of [...orderBy].reverse()) sel = [...sel].sort((a, b) => ((a[o.col] as number | string) > (b[o.col] as number | string) ? 1 : -1) * (o.asc ? 1 : -1));
      if (lim != null) sel = sel.slice(0, lim);
      return { data: sel, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return q; },
      is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      ilike: (c: string, v: string) => { filters.push((r) => String(r[c] ?? '').toLowerCase() === v.toLowerCase()); return q; },
      not: (c: string, _o: string, v: unknown) => { filters.push((r) => (r[c] ?? null) !== v); return q; },
      gte: (c: string, v: string) => { filters.push((r) => String(r[c] ?? '') >= v); return q; },
      lte: (c: string, v: string) => { filters.push((r) => String(r[c] ?? '') <= v); return q; },
      order: (col: string, o?: { ascending?: boolean }) => { orderBy.push({ col, asc: o?.ascending !== false }); return q; },
      limit: (n: number) => { lim = n; return q; },
      range: (_a: number, b: number) => { lim = b + 1; return q; },
      insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return q; },
      upsert: (p: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) => { op = 'upsert'; payload = p; conflict = (o?.onConflict ?? '').split(',').filter(Boolean); ignoreDup = !!o?.ignoreDuplicates; return q; },
      update: (p: Row) => { op = 'update'; payload = p; return q; },
      delete: () => { op = 'delete'; return q; },
      maybeSingle: async () => { const r = run(); return { data: r.data[0] ?? null, error: r.error }; },
      single: async () => { const r = run(); return { data: r.data[0] ?? null, error: r.error ?? (r.data[0] ? null : { message: 'no row' }) }; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { client: { from } as unknown as import('@supabase/supabase-js').SupabaseClient, tables };
}

const REFM_ROW = { course_code: 'REFM', title: 'REFM Live', is_active: true, is_public: true, exams_enabled: false, cert_routes: ['live', 'recording'], allow_mixed_routes: true, attendance_threshold_pct: 75, recording_complete_pct: 95, model_approval_required: true, max_submission_attempts: 3, join_opens_minutes_before: 15, session_day_reminder: true, certificate_grade_label: 'Completed' };

async function unit1b(): Promise<void> {
  console.log('\n=== Unit 1b: registration and enrolment ===\n');
  const en = await import('../src/hubs/training/lib/liveCourse/enrolment');
  const { client, tables } = fakeDb({
    training_course_settings: [REFM_ROW, { ...REFM_ROW, course_code: 'OFF', is_active: false }],
    live_sessions: [{ id: 's1', title: 'Kick-off', course_code: 'REFM', course_session_no: 1, is_published: true, scheduled_datetime: '2026-12-01T16:00:00.000Z' }],
    training_enrollments: [],
  });
  const sent: string[] = [];
  const send = async (to: string, subject: string) => { sent.push(`${to}|${subject}`); };

  // New visitor: confirm-email enrols with source public_page.
  const a = await en.enrolInLiveCourse(client, { registrationId: 'FMP-2026-9001', email: 'new@x.com', name: 'New', courseCode: 'refm', source: 'public_page' }, { send });
  check('U1b.1a a new registrant is enrolled in the course', a.ok && a.enrolled && !a.alreadyEnrolled);
  check('U1b.1b the enrolment row records the public page as its source', tables.training_enrollments.some((r) => r.registration_id === 'FMP-2026-9001' && r.course_code === 'REFM' && r.source === 'public_page'));
  check('U1b.1c the confirmation email is sent, with the course in the subject', sent.length === 1 && sent[0].includes('REFM Live'));

  // Existing student: dashboard enrol, then a second click.
  const b = await en.enrolInLiveCourse(client, { registrationId: 'FMP-2026-0002', email: 'old@x.com', courseCode: 'REFM', source: 'dashboard' }, { send });
  const b2 = await en.enrolInLiveCourse(client, { registrationId: 'FMP-2026-0002', email: 'old@x.com', courseCode: 'REFM', source: 'dashboard' }, { send });
  check('U1b.2a an existing student enrols from the dashboard', b.ok && !b.alreadyEnrolled);
  check('U1b.2b a second click is idempotent: one row, reported as already enrolled', b2.ok && b2.alreadyEnrolled && tables.training_enrollments.filter((r) => r.registration_id === 'FMP-2026-0002').length === 1);
  check('U1b.2c the confirmation email is sent once, not per click', sent.filter((s) => s.startsWith('old@x.com')).length === 1);
  check('U1b.2d confirmation_sent_at is stamped', tables.training_enrollments.every((r) => !!r.confirmation_sent_at));

  // Refusals.
  check('U1b.3a an exam course is refused (not this rule\'s)', !(await en.enrolInLiveCourse(client, { registrationId: 'R', email: 'e@x.com', courseCode: '3SFM', source: 'dashboard' }, { send })).ok);
  check('U1b.3b an inactive live course is refused', !(await en.enrolInLiveCourse(client, { registrationId: 'R', email: 'e@x.com', courseCode: 'OFF', source: 'dashboard' }, { send })).ok);
  check('U1b.3c the sign-in link lands on the course page and enrols', en.courseSigninUrl('REFM') === `/signin?redirect=${encodeURIComponent('/training/live-course/REFM?enrol=1')}`);

  // Wiring of the real routes (the register route is behind hCaptcha, and
  // confirm-email consumes a real registration id, so they are pinned by source).
  const reg = readFileSync('app/api/training/register/route.ts', 'utf8');
  const dupAt = reg.indexOf('existing?.email_confirmed');
  const upsertAt = reg.indexOf("from('training_pending_registrations').upsert");
  check('U1b.4a register: an existing email returns before any pending row is written (no duplicate account)', dupAt > 0 && upsertAt > dupAt && /duplicate:\s*true/.test(reg.slice(dupAt, upsertAt)));
  check('U1b.4b register: the duplicate response carries the course sign-in link', /signinUrl:\s*enrolCourseCode\s*\?\s*courseSigninUrl\(/.test(reg));
  check('U1b.4c register: only an active, public live course is accepted', /isLiveCourseRow\(settings\)\s*&&\s*settings\.isActive\s*&&\s*settings\.isPublic/.test(reg) && reg.includes('enrol_course_code: enrolCourseCode'));
  const conf = readFileSync('app/api/training/confirm-email/route.ts', 'utf8');
  check('U1b.4d confirm-email: enrols through the one rule with source public_page', /enrolInLiveCourse\(sb,[\s\S]{0,200}source: 'public_page'/.test(conf));
  check('U1b.4e confirm-email: the main path keeps the redirect', /signin\?confirmed=true\$\{landing \?/.test(conf));
  check('U1b.4f confirm-email: 3SFM auto-enrol is kept', conf.includes("course_code: '3SFM'"));
  const enrollRoute = readFileSync('app/api/training/enroll/route.ts', 'utf8');
  check('U1b.4g enroll route: identity from the signed cookie only', enrollRoute.includes('getTrainingCookieSession()') && !/body\.(email|registrationId)/.test(enrollRoute));
  const signin = readFileSync('app/training/signin/SignInForm.tsx', 'utf8');
  check('U1b.4h sign-in: the email-code step keeps the return link', !signin.includes("router.push('/training/dashboard')"));
}

async function unit2(): Promise<void> {
  console.log('\n=== Unit 2: Join live, KSA times, same-day reminder ===\n');
  const jw = await import('../src/hubs/training/lib/liveCourse/joinWindow');
  const tm = await import('../src/hubs/training/lib/liveCourse/time');
  const sa = await import('../src/hubs/training/lib/liveCourse/sessionAccess');
  const dr = await import('../src/hubs/training/lib/liveCourse/dayReminder');

  // A REFM session: Tue 1 Dec 2026, 7:00 PM KSA = 16:00 UTC, 150 minutes.
  const start = '2026-12-01T16:00:00.000Z';
  const s = { scheduled_datetime: start, duration_minutes: 150 };
  const w = jw.joinWindowFor(s, 15)!;
  const at = (iso: string) => new Date(iso).getTime();
  check('U2.1a the window opens 15 minutes before the start', w.opensAt === '2026-12-01T15:45:00.000Z');
  check('U2.1b the window closes at the scheduled end (start + 150 min)', w.closesAt === '2026-12-01T18:30:00.000Z');
  check('U2.1c one minute before it opens: closed (before)', jw.joinStateAt(at('2026-12-01T15:44:00Z'), w) === 'before');
  check('U2.1d at the opening minute: open', jw.joinStateAt(at('2026-12-01T15:45:00Z'), w) === 'open');
  check('U2.1e at the scheduled end: still open', jw.joinStateAt(at('2026-12-01T18:30:00Z'), w) === 'open');
  check('U2.1f one minute after the end: ended', jw.joinStateAt(at('2026-12-01T18:31:00Z'), w) === 'ended');
  check('U2.1g no start time: no window', jw.joinWindowFor({ scheduled_datetime: null }, 15) === null);

  // The bug: an upcoming session turned 'recorded' at its START.
  check('U2.2a before the start: upcoming', jw.effectiveSessionType({ ...s, session_type: 'upcoming' }, at('2026-12-01T15:59:00Z')) === 'upcoming');
  check('U2.2b ten minutes after the start: LIVE (was recorded, hiding Join)', jw.effectiveSessionType({ ...s, session_type: 'upcoming' }, at('2026-12-01T16:10:00Z')) === 'live');
  check('U2.2c after the scheduled end: recorded', jw.effectiveSessionType({ ...s, session_type: 'upcoming' }, at('2026-12-01T18:31:00Z')) === 'recorded');
  check('U2.2d an admin\'s recorded always wins', jw.effectiveSessionType({ ...s, session_type: 'recorded' }, at('2026-12-01T16:10:00Z')) === 'recorded');

  // Bug 4: admin times are KSA wall-clock, not the admin browser's zone.
  check('U2.3a 7:00 PM KSA is 16:00 UTC', tm.zonedWallTimeToUtc('2026-12-01', '19:00', 'Asia/Riyadh') === start);
  check('U2.3b the same typed time in Karachi would be 14:00 UTC (the zone is honoured)', tm.zonedWallTimeToUtc('2026-12-01', '19:00', 'Asia/Karachi') === '2026-12-01T14:00:00.000Z');
  const parts = tm.utcToZonedParts(start, 'Asia/Riyadh');
  check('U2.3c the edit form shows it back as 2026-12-01 19:00', parts.date === '2026-12-01' && parts.time === '19:00');
  check('U2.3d a malformed time is refused, never guessed', tm.zonedWallTimeToUtc('2026-12-01', '7pm') === null);
  check('U2.3e display reads 7:00 PM KSA', /7:00 PM KSA$/.test(tm.formatSessionTime(start)), tm.formatSessionTime(start));
  const admin = readFileSync('app/admin/training-hub/live-sessions/page.tsx', 'utf8');
  check('U2.3f the admin form converts through zonedWallTimeToUtc, not the browser zone', admin.includes('zonedWallTimeToUtc(form.date') && !admin.includes('new Date(`${form.date}T${form.time}`)'));
  check('U2.3g the admin edit form reads back through utcToZonedParts', admin.includes('utcToZonedParts(raw'));

  // Access: a registration, or an enrolment in the session's course.
  const sess = { id: 'cs1', live_url: 'https://teams.microsoft.com/l/meetup-join/x', scheduled_datetime: start, duration_minutes: 150, course_code: 'REFM' };
  const { client } = fakeDb({
    session_registrations: [{ id: 'r1', session_id: 'solo', student_email: 'reg@x.com' }],
    training_enrollments: [{ id: 'e1', registration_id: 'FMP-1', course_code: 'REFM' }],
  });
  check('U2.4a enrolled in the course: access to its session', await sa.studentHasSessionAccess(client, { email: 'enr@x.com', registrationId: 'FMP-1' }, sess));
  check('U2.4b not enrolled, not registered: no access', !(await sa.studentHasSessionAccess(client, { email: 'no@x.com', registrationId: 'FMP-9' }, sess)));
  check('U2.4c registered for a standalone session: access', await sa.studentHasSessionAccess(client, { email: 'REG@x.com', registrationId: 'FMP-2' }, { id: 'solo' }));
  const open = sa.joinStatusFrom(true, sess, 15, at('2026-12-01T16:05:00Z'));
  check('U2.4d in the window with access: can join now', open.canJoinNow);
  check('U2.4e the link handed out is the logged join route, never the meeting link', !!open.joinUrl && open.joinUrl.endsWith('/api/training/live-sessions/cs1/join') && !open.joinUrl.includes('teams.microsoft.com'));
  check('U2.4f no access: no link at all', sa.joinStatusFrom(false, sess, 15, at('2026-12-01T16:05:00Z')).joinUrl === null);
  check('U2.4g before the window: a link, but not joinable yet', (() => { const b = sa.joinStatusFrom(true, sess, 15, at('2026-12-01T12:00:00Z')); return !b.canJoinNow && b.state === 'before'; })());

  // The join route logs, then redirects; every refusal goes back to the page.
  const join = readFileSync('app/api/training/live-sessions/[id]/join/route.ts', 'utf8');
  const logAt = join.indexOf("from('live_session_join_clicks').insert");
  const goAt = join.indexOf('NextResponse.redirect(session.live_url');
  check('U2.5a the join route logs the click before redirecting to Teams', logAt > 0 && goAt > logAt);
  check('U2.5b it checks access and the window before the redirect', join.indexOf('studentHasSessionAccess(') < goAt && join.indexOf("state === 'before'") < goAt && join.indexOf("state === 'ended'") < goAt);
  for (const f of ['app/api/training/live-sessions/[id]/register/route.ts', 'app/api/training/live-sessions/registration-status-batch/route.ts']) {
    const src = readFileSync(f, 'utf8');
    check(`U2.5c ${f.split('/').slice(-2).join('/')}: Join follows the one window rule`, src.includes('joinStatusFrom(') && !src.includes('180 * 60000') && !src.includes("!!session?.scheduled_datetime;"));
  }
  const btnUsers = ['app/training/live-sessions/[id]/page.tsx', 'src/hubs/training/components/dashboard/LiveSessionCard.tsx', 'app/training/live-course/[code]/LiveCourseClient.tsx'];
  check('U2.5d detail page, dashboard card and course page all use THE Join button', btnUsers.every((f) => readFileSync(f, 'utf8').includes('<JoinLiveButton')));

  // Same-day reminder at 9:00 AM KSA (cron 06:00 UTC).
  check('U2.6a 19:00 KSA is later today at 09:00 KSA', dr.startsLaterToday(start, new Date('2026-12-01T06:00:00Z')));
  check('U2.6b tomorrow is not today', !dr.startsLaterToday('2026-12-02T16:00:00Z', new Date('2026-12-01T06:00:00Z')));
  const db2 = fakeDb({
    training_course_settings: [REFM_ROW],
    live_sessions: [
      { id: 'today', title: 'Session 1', scheduled_datetime: start, course_code: 'REFM', course_session_no: 1, is_published: true, session_type: 'upcoming', day_reminder_sent_at: null },
      { id: 'tomorrow', title: 'Session 2', scheduled_datetime: '2026-12-02T16:00:00.000Z', course_code: 'REFM', course_session_no: 2, is_published: true, session_type: 'upcoming', day_reminder_sent_at: null },
      { id: 'solo', title: 'Standalone', scheduled_datetime: start, course_code: null, is_published: true, session_type: 'upcoming', day_reminder_sent_at: null },
    ],
    training_enrollments: [{ id: 'e1', registration_id: 'FMP-1', course_code: 'REFM' }, { id: 'e2', registration_id: 'FMP-2', course_code: 'REFM' }],
    training_registrations_meta: [{ registration_id: 'FMP-1', email: 'A@x.com', name: 'A' }, { registration_id: 'FMP-2', email: 'b@x.com', name: 'B' }],
  });
  const mails: string[] = [];
  const sendAll = async (items: { to: string; subject: string }[]) => { for (const i of items) mails.push(`${i.to}|${i.subject}`); return items.map(() => ({ ok: true })); };
  const r1 = await dr.sendSessionDayReminders(db2.client, new Date('2026-12-01T06:00:00Z'), sendAll);
  check('U2.6c today\'s course session reminds every enrolled student', r1.sessions === 1 && r1.sent === 2 && mails.every((m) => m.includes('Today: Session 1')));
  check('U2.6d tomorrow\'s session and a standalone session are not reminded', !mails.some((m) => m.includes('Session 2') || m.includes('Standalone')));
  const r2 = await dr.sendSessionDayReminders(db2.client, new Date('2026-12-01T06:05:00Z'), sendAll);
  check('U2.6e a second cron run sends nothing (stamped before sending)', r2.sent === 0 && mails.length === 2);
  const cron = readFileSync('app/api/cron/session-reminders/route.ts', 'utf8');
  check('U2.6f the cron runs the day reminder and skips course sessions in the 1-hour pass', cron.includes('sendSessionDayReminders(') && cron.includes('if (session.course_code) continue;'));
}

async function unit3(): Promise<void> {
  console.log('\n=== Unit 3: attendance (Graph sync, CSV, matching) ===\n');
  const A = await import('../src/hubs/training/lib/liveCourse/attendance');
  const C = await import('../src/hubs/training/lib/liveCourse/teamsCsv');
  const S = await import('../src/hubs/training/lib/liveCourse/attendanceSync');
  const t = (iso: string) => new Date(iso).getTime();

  // Interval arithmetic.
  check('U3.1a overlapping intervals merge (two devices count once)', JSON.stringify(A.mergeIntervals([[0, 10], [5, 20], [30, 40]])) === JSON.stringify([[0, 20], [30, 40]]));
  check('U3.1b join/leave several times: the intervals are summed', A.totalSeconds(A.mergeIntervals([[0, 60_000], [120_000, 180_000]])) === 120);
  check('U3.1c time before the start and after the end is not counted', A.totalSeconds(A.clipIntervals([[0, 100_000]], 20_000, 50_000)) === 30);
  check('U3.1d the share is capped at 100%', A.attendedPct(9999, 100) === 100);
  check('U3.1e no session length: 0%, never NaN', A.attendedPct(50, 0) === 0);

  // The saved sample report, in the Graph attendanceRecord shape (learn.microsoft.com).
  const start = '2026-12-01T16:00:00Z', end = '2026-12-01T18:30:00Z'; // 150 minutes
  const sampleRecords = [
    { emailAddress: 'Full@Example.com', identity: { displayName: 'Full Attendee' }, role: 'Attendee', totalAttendanceInSeconds: 9000,
      attendanceIntervals: [{ joinDateTime: '2026-12-01T15:55:00Z', leaveDateTime: '2026-12-01T18:35:00Z', durationInSeconds: 9600 }] },
    { emailAddress: 'edge@example.com', identity: { displayName: 'Exactly 75' }, role: 'Attendee', totalAttendanceInSeconds: 6750,
      attendanceIntervals: [{ joinDateTime: '2026-12-01T16:00:00Z', leaveDateTime: '2026-12-01T17:00:00Z', durationInSeconds: 3600 },
                            { joinDateTime: '2026-12-01T17:30:00Z', leaveDateTime: '2026-12-01T18:22:30Z', durationInSeconds: 3150 }] },
    { emailAddress: 'personal@gmail.com', identity: { displayName: 'Alias Person' }, role: 'Attendee', totalAttendanceInSeconds: 3600,
      attendanceIntervals: [{ joinDateTime: '2026-12-01T16:00:00Z', leaveDateTime: '2026-12-01T17:00:00Z', durationInSeconds: 3600 }] },
    { emailAddress: 'stranger@x.com', identity: { displayName: 'Stranger' }, role: 'Attendee', totalAttendanceInSeconds: 600,
      attendanceIntervals: [{ joinDateTime: '2026-12-01T16:00:00Z', leaveDateTime: '2026-12-01T16:10:00Z', durationInSeconds: 600 }] },
    { emailAddress: '', identity: { displayName: 'Phone Caller' }, role: 'Attendee', totalAttendanceInSeconds: 1200,
      attendanceIntervals: [{ joinDateTime: '2026-12-01T16:00:00Z', leaveDateTime: '2026-12-01T16:20:00Z', durationInSeconds: 1200 }] },
  ];
  const rows = A.buildAttendanceRows(A.rawFromGraph(sampleRecords), { start: t(start), end: t(end) }, 9000);
  const pctOf = (e: string) => rows.find((r) => r.attendee_email === e)?.attended_pct;
  check('U3.2a lobby time before the start and after the end is clipped: 100%', pctOf('full@example.com') === 100);
  check('U3.2b two intervals summing to exactly 75% of 150 minutes read 75.00', pctOf('edge@example.com') === 75);
  check('U3.2c an attendee with no email is kept, keyed by name, for a manual match', rows.some((r) => r.attendee_email === 'noemail:phone caller'));
  check('U3.2d emails are lowercased', rows.some((r) => r.attendee_email === 'full@example.com'));

  // CSV fallback: a Teams export, tab separated, times in KSA wall clock.
  const csv = [
    '1. Summary', 'Meeting title\tREFM Session 1', 'Attended participants\t2',
    'Start time\t12/1/26, 7:00:00 PM', 'End time\t12/1/26, 9:30:00 PM', 'Meeting duration\t2h 30m 0s', '',
    '2. Participants', 'Name\tFirst Join\tLast Leave\tIn-Meeting Duration\tEmail\tParticipant ID (UPN)\tRole',
    'Edge Person\t12/1/26, 7:00:00 PM\t12/1/26, 9:22:30 PM\t1h 52m 30s\tedge@example.com\tedge@example.com\tAttendee', '',
    '3. In-Meeting Activities', 'Name\tJoin Time\tLeave Time\tDuration\tEmail\tRole',
    'Edge Person\t12/1/26, 7:00:00 PM\t12/1/26, 8:00:00 PM\t1h 0m 0s\tedge@example.com\tAttendee',
    'Edge Person\t12/1/26, 8:30:00 PM\t12/1/26, 9:22:30 PM\t52m 30s\tedge@example.com\tAttendee',
    'Late Joiner\t12/1/26, 8:00:00 PM\t12/1/26, 9:00:00 PM\t1h 0m 0s\tlate@example.com\tAttendee',
  ].join('\n');
  const parsed = C.parseTeamsAttendanceCsv(csv, { timeZone: 'Asia/Riyadh' });
  check('U3.3a the activities section is read (one interval per join)', parsed.format === 'activities' && parsed.attendees.length === 3);
  check('U3.3b the summary window is read as KSA: 7:00 PM = 16:00 UTC', parsed.meetingStart === t(start) && parsed.meetingEnd === t(end));
  const csvRows = A.buildAttendanceRows(parsed.attendees, { start: parsed.meetingStart, end: parsed.meetingEnd }, 9000);
  check('U3.3c the CSV gives the same 75.00% as Graph for the same attendance', csvRows.find((r) => r.attendee_email === 'edge@example.com')?.attended_pct === 75);
  check('U3.3d durations parse ("1h 52m 30s", "52s", "01:02:03")', C.parseDurationSeconds('1h 52m 30s') === 6750 && C.parseDurationSeconds('52s') === 52 && C.parseDurationSeconds('01:02:03') === 3723);
  check('U3.3e a day above 12 switches to day-first dates', C.parseTeamsTime('13/12/26, 7:00:00 PM', 'Asia/Riyadh', 'DMY') === t('2026-12-13T16:00:00Z'));
  const partsOnly = C.parseTeamsAttendanceCsv(csv.split('3. In-Meeting Activities')[0], { timeZone: 'Asia/Riyadh' });
  check('U3.3f without the activities section, the in-meeting duration is used (not first-join to last-leave)', partsOnly.format === 'participants' && A.totalSeconds(partsOnly.attendees[0].intervals) === 6750);
  let threw = false; try { C.parseTeamsAttendanceCsv('hello,world'); } catch { threw = true; }
  check('U3.3g a file that is not a Teams report is refused, not guessed', threw);

  // Sync end to end against the sample report: fake Graph + in-memory database.
  const { client, tables } = fakeDb({
    live_sessions: [
      { id: 'sess1', live_url: 'https://teams.microsoft.com/l/meetup-join/abc', scheduled_datetime: start, duration_minutes: 150, graph_online_meeting_id: null, course_code: 'REFM', attendance_synced_at: null },
      { id: 'sess0', live_url: 'https://teams.microsoft.com/l/meetup-join/old', scheduled_datetime: '2026-11-24T16:00:00Z', duration_minutes: 150, graph_online_meeting_id: 'm0', course_code: 'REFM', attendance_synced_at: '2026-11-25T06:00:00Z' },
    ],
    training_registrations_meta: [{ registration_id: 'FMP-1', email: 'full@example.com' }, { registration_id: 'FMP-2', email: 'edge@example.com' }, { registration_id: 'FMP-3', email: 'alias.owner@example.com' }],
    student_email_aliases: [{ alias_email: 'personal@gmail.com', student_email: 'alias.owner@example.com' }],
    live_session_attendance: [
      { id: 'old', session_id: 'sess0', attendee_email: 'stranger@x.com', student_email: null, source: 'graph', matched_by: null },
    ],
  });
  let resolves = 0;
  const graph = {
    resolveMeetingId: async (url: string) => { resolves++; return url.endsWith('abc') ? 'm1' : 'mX'; },
    listReports: async () => [
      { id: 'rep1', meetingStartDateTime: start, meetingEndDateTime: end },
      { id: 'repOtherWeek', meetingStartDateTime: '2026-12-08T16:00:00Z', meetingEndDateTime: '2026-12-08T18:30:00Z' },
    ],
    getRecords: async (_m: string, rep: string) => (rep === 'rep1' ? sampleRecords : [{ emailAddress: 'nextweek@x.com', totalAttendanceInSeconds: 9000, attendanceIntervals: [] }]) as never,
  };
  const r1 = await S.syncSessionFromGraph(client, 'sess1', graph, 'admin@x.com');
  const att = tables.live_session_attendance.filter((r) => r.session_id === 'sess1');
  check('U3.4a only this week\'s report is used (a reused link\'s other weeks are ignored)', r1.reports === 1 && !att.some((r) => r.attendee_email === 'nextweek@x.com'));
  check('U3.4b matched by email', att.find((r) => r.attendee_email === 'edge@example.com')?.student_email === 'edge@example.com');
  check('U3.4c matched by a remembered alias', att.find((r) => r.attendee_email === 'personal@gmail.com')?.student_email === 'alias.owner@example.com');
  check('U3.4d an unknown email is UNMATCHED (listed for the admin), never guessed', att.find((r) => r.attendee_email === 'stranger@x.com')?.student_email == null && r1.unmatched === 2);
  const sessRow = tables.live_sessions.find((r) => r.id === 'sess1')!;
  check('U3.4e the meeting id is resolved from the join link and stored', sessRow.graph_online_meeting_id === 'm1' && resolves === 1);
  check('U3.4f the session records the sync and the actual meeting window', !!sessRow.attendance_synced_at && sessRow.actual_start_at === new Date(start).toISOString() && sessRow.attendance_sync_error == null);
  check('U3.4g the denominator is the actual meeting length (150 min)', r1.sessionSeconds === 9000);

  // Manual match, remembered: this session AND the older session's unmatched row.
  await S.matchAttendee(client, { sessionId: 'sess1', attendeeEmail: 'stranger@x.com', studentEmail: 'FULL@example.com', remember: true, by: 'admin@x.com' });
  check('U3.5a a manual match sets the student', tables.live_session_attendance.find((r) => r.session_id === 'sess1' && r.attendee_email === 'stranger@x.com')?.student_email === 'full@example.com');
  check('U3.5b "remember" saves an alias and matches the same email in other sessions', tables.student_email_aliases.some((a) => a.alias_email === 'stranger@x.com') && tables.live_session_attendance.find((r) => r.id === 'old')?.student_email === 'full@example.com');
  let refused = false; try { await S.matchAttendee(client, { sessionId: 'sess1', attendeeEmail: 'x@y.com', studentEmail: 'nobody@x.com', remember: false, by: null }); } catch { refused = true; }
  check('U3.5c matching to an email that is not a student is refused', refused);

  // Hand-entered figure and re-sync.
  await S.setManualAttendance(client, { sessionId: 'sess1', studentEmail: 'alias.owner@example.com', attendedPct: 90, by: 'admin@x.com' });
  tables.live_session_attendance.find((r) => r.session_id === 'sess1' && r.attendee_email === 'alias.owner@example.com')!.attended_pct = 90;
  const r2 = await S.syncSessionFromGraph(client, 'sess1', graph, 'admin@x.com');
  check('U3.6a a re-sync keeps a hand-entered row', tables.live_session_attendance.find((r) => r.session_id === 'sess1' && r.attendee_email === 'alias.owner@example.com')?.source === 'manual');
  check('U3.6b a re-sync keeps a manual match', tables.live_session_attendance.find((r) => r.session_id === 'sess1' && r.attendee_email === 'stranger@x.com')?.student_email === 'full@example.com');
  // 5 Teams identities + the hand-entered row (keyed by the student's email) = 6.
  check('U3.6c a re-sync does not duplicate rows', tables.live_session_attendance.filter((r) => r.session_id === 'sess1').length === 6 && r2.saved === 5, `rows=${tables.live_session_attendance.filter((r) => r.session_id === 'sess1').length} saved=${r2.saved}`);
  check('U3.6d the meeting id is not resolved again', resolves === 1);

  // CSV import path.
  const r3 = await S.importSessionCsv(client, 'sess1', parsed, 'admin@x.com');
  check('U3.7a CSV import saves through the same matcher', r3.saved >= 2 && tables.live_session_attendance.some((r) => r.session_id === 'sess1' && r.attendee_email === 'late@example.com' && r.source === 'csv'));

  // Failure is recorded on the session, then rethrown.
  const bad = { ...graph, listReports: async () => [] };
  tables.live_sessions.push({ id: 'sess2', live_url: 'https://teams.microsoft.com/l/meetup-join/zzz', scheduled_datetime: start, duration_minutes: 150, graph_online_meeting_id: 'm2', course_code: 'REFM', attendance_synced_at: null });
  let failedSync = false; try { await S.syncSessionFromGraph(client, 'sess2', bad); } catch { failedSync = true; }
  check('U3.8a no report yet: the sync fails and the reason is saved on the session', failedSync && /no attendance report/i.test(String(tables.live_sessions.find((r) => r.id === 'sess2')!.attendance_sync_error)));

  // Automatic pull: ended at least 30 minutes ago, never synced.
  const { client: c2 } = fakeDb({ live_sessions: [
    { id: 'ended', live_url: 'u', scheduled_datetime: '2026-12-01T16:00:00Z', duration_minutes: 150, course_code: 'REFM', attendance_synced_at: null },
    { id: 'running', live_url: 'u', scheduled_datetime: '2026-12-01T17:30:00Z', duration_minutes: 150, course_code: 'REFM', attendance_synced_at: null },
    { id: 'done', live_url: 'u', scheduled_datetime: '2026-12-01T10:00:00Z', duration_minutes: 150, course_code: 'REFM', attendance_synced_at: '2026-12-01T13:00:00Z' },
  ] });
  const tried: string[] = [];
  const g2 = { resolveMeetingId: async () => 'm', listReports: async () => { tried.push('x'); return []; }, getRecords: async () => [] };
  const auto = await S.autoSyncEndedSessions(c2, new Date('2026-12-01T19:10:00Z'), g2);
  check('U3.9a the cron pulls only sessions that ended 30+ minutes ago and were never synced', auto.tried === 1);
  const cron = readFileSync('app/api/cron/session-reminders/route.ts', 'utf8');
  check('U3.9b the daily cron runs the automatic pull when Teams is configured', cron.includes('autoSyncEndedSessions(') && cron.includes('isTeamsConfigured()'));
  const route = readFileSync('app/api/admin/live-sessions/[id]/attendance/route.ts', 'utf8');
  check('U3.9c the admin attendance route is admin-only', route.match(/adminEmail\(\)/g)!.length >= 2);
}

async function unit4(): Promise<void> {
  console.log('\n=== Unit 4: eligibility ===\n');
  const E = await import('../src/hubs/training/lib/liveCourse/eligibility');
  const cs = await import('../src/hubs/training/lib/liveCourse/courseSettings');
  const course = cs.settingsFromRow(REFM_ROW);
  const after = new Date('2027-02-01T00:00:00Z').getTime();
  // Eight weekly sessions, all held, all with recordings.
  const sessions = Array.from({ length: 8 }, (_, i) => ({
    id: `s${i + 1}`, course_session_no: i + 1, title: `Session ${i + 1}`,
    scheduled_datetime: new Date(Date.UTC(2026, 11, 1 + 7 * i, 16)).toISOString(), duration_minutes: 150,
    session_type: 'upcoming' as const, youtube_url: `https://youtu.be/r${i + 1}`,
  }));
  const live = (pct: number) => [{ intervals: [] as [string, string][], attended_pct: pct, session_seconds: 9000, source: 'graph' }];
  const allLive = (pct: number) => new Map(sessions.map((s) => [s.id, live(pct)]));
  const watched = (sec: number, total = 3600, pct: number | null = null) => ({ watch_seconds: sec, total_seconds: total, watch_percentage: pct });
  const none = new Map();

  const at75 = E.computeEligibility(course, sessions, allLive(75), none, after);
  check('U4.1a 75.00% in every session: live route complete, submission unlocked', at75.routeCompleted === 'live' && at75.submissionUnlocked);
  const under = allLive(75); under.set('s4', live(74.99));
  const e2 = E.computeEligibility(course, sessions, under, none, after);
  check('U4.1b 74.99% in one session: that session is not met, nothing unlocks', !e2.sessions[3].met && !e2.submissionUnlocked && e2.sessionsMet === 7);

  // One missed session.
  const missed = allLive(90); missed.delete('s5');
  const e3 = E.computeEligibility(course, sessions, missed, none, after);
  check('U4.2a one missed session and no recording watched: locked', !e3.submissionUnlocked && !e3.liveComplete);
  const e4 = E.computeEligibility(course, sessions, missed, new Map([['s5', watched(3600)]]), after);
  check('U4.2b the missed session completed by its recording: mixed route, unlocked', e4.routeCompleted === 'mixed' && e4.submissionUnlocked && e4.sessions[4].via === 'recording');
  const noMix = cs.settingsFromRow({ ...REFM_ROW, allow_mixed_routes: false });
  check('U4.2c with mixed routes OFF, the same student stays locked', !E.computeEligibility(noMix, sessions, missed, new Map([['s5', watched(3600)]]), after).submissionUnlocked);

  // Recording route (a new user after the course ends).
  const fullWatch = new Map(sessions.map((s) => [s.id, watched(3420)])); // 95.0%
  const e5 = E.computeEligibility(course, sessions, none, fullWatch, after);
  check('U4.3a every recording watched to 95%: recording route complete', e5.routeCompleted === 'recording' && e5.submissionUnlocked);
  const oneShort = new Map(fullWatch); oneShort.set('s8', watched(3400)); // 94.4%
  check('U4.3b one recording at 94.4%: incomplete, locked', !E.computeEligibility(course, sessions, none, oneShort, after).submissionUnlocked);
  const flagOnly = new Map(fullWatch); flagOnly.set('s2', watched(60, 3600, 100));
  check('U4.3c a "completed" flag with only 60 seconds watched does not count (skip to end)', !E.computeEligibility(course, sessions, none, flagOnly, after).sessions[1].recordingMet);
  const noRec = sessions.map((s) => (s.id === 's3' ? { ...s, youtube_url: null } : s));
  check('U4.3d a session with no recording uploaded cannot be met by recording', !E.computeEligibility(course, noRec as never, none, fullWatch, after).sessions[2].recordingMet);

  // Sessions not yet held block the unlock.
  const midCourse = new Date('2026-12-10T00:00:00Z').getTime();
  const e6 = E.computeEligibility(course, sessions, new Map([['s1', live(100)], ['s2', live(100)]]), none, midCourse);
  check('U4.4a mid-course: future sessions are "not held" and nothing unlocks', !e6.submissionUnlocked && !e6.sessions[5].held && e6.sessions[0].held);
  check('U4.4b a course with no sessions never unlocks', !E.computeEligibility(course, [], none, none, after).submissionUnlocked);

  // Route settings.
  const liveOnly = cs.settingsFromRow({ ...REFM_ROW, cert_routes: ['live'] });
  check('U4.5a a live-only course ignores recordings', !E.computeEligibility(liveOnly, sessions, none, fullWatch, after).submissionUnlocked);
  const higher = cs.settingsFromRow({ ...REFM_ROW, attendance_threshold_pct: 80 });
  check('U4.5b the threshold is a course setting (80% course: 75% fails)', !E.computeEligibility(higher, sessions, allLive(75), none, after).submissionUnlocked);

  // Live share across Teams identities.
  const twoDevices = [
    { intervals: [['2026-12-01T16:00:00Z', '2026-12-01T17:30:00Z']] as [string, string][], attended_pct: 60, session_seconds: 9000, source: 'graph' },
    { intervals: [['2026-12-01T17:00:00Z', '2026-12-01T18:00:00Z']] as [string, string][], attended_pct: 40, session_seconds: 9000, source: 'graph' },
  ];
  check('U4.6a two identities overlapping: merged to 80%, not 100% summed', E.liveShare(twoDevices) === 80, String(E.liveShare(twoDevices)));
  check('U4.6b a hand-entered figure stands', E.liveShare([...twoDevices, { intervals: [], attended_pct: 95, session_seconds: 9000, source: 'manual' }]) === 95);
  check('U4.6c a recording share uses watch seconds over length, capped at 100', E.recordingShare(watched(5000, 3600)) === 100 && E.recordingShare(undefined) === 0);

  // One rule everywhere.
  const users = ['src/hubs/training/lib/liveCourse/courseView.ts', 'app/api/admin/live-course/[code]/progress/route.ts'];
  check('U4.7a the course page and the admin view both compute through computeEligibility', users.every((f) => readFileSync(f, 'utf8').includes('computeEligibility(')));

  if (hasCreds()) {
    // The loader against the live schema: its columns and filters must exist.
    const sb = await db();
    const { data: anySession } = await sb.from('session_watch_history').select('session_id').limit(1).maybeSingle();
    const ids = anySession?.session_id ? [anySession.session_id as string] : ['00000000-0000-0000-0000-000000000000'];
    let err = '';
    try { await E.loadProgressMaps(sb, ids, null); } catch (e) { err = String(e); }
    const probe = await sb.from('session_watch_history').select('session_id, student_email, watch_seconds, total_seconds, watch_percentage').order('id').limit(1);
    const probe2 = await sb.from('live_session_attendance').select('session_id, student_email, intervals, attended_pct, session_seconds, source').order('id').limit(1);
    check('U4.8a the eligibility loader reads columns that exist on the live schema', !err && !probe.error && !probe2.error, err || probe.error?.message || probe2.error?.message || '');
    const live = await E.loadStudentEligibility(sb, 'nobody-verify@example.com', 'REFM');
    check('U4.8b REFM eligibility loads live for a student with no progress: locked', !!live && !live.submissionUnlocked);
    check('U4.8c an exam course has no live-course eligibility (null)', (await E.loadStudentEligibility(sb, 'nobody-verify@example.com', '3SFM')) === null);
  }
}

(async () => {
  await unit0();
  await unit1();
  await unit1b();
  await unit2();
  await unit3();
  await unit4();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('Failed:'); for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });

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
    const selects = [...src.matchAll(/from\('live_sessions'\)\s*\.select\(\s*'([^']*)'/g)].map((m) => m[1]);
    const star = selects.some((s) => s.trim().startsWith('*'));
    const named = selects.some((s) => /\b(live_url|live_password|teams_dial_in|teams_meeting_id)\b/.test(s));
    if (star) { starReaders++; if (!src.includes('withoutPrivateFields(')) offenders.push(`${f} selects * without withoutPrivateFields`); }
    if (named) { namedReaders++; if (!src.includes('joinDetailsFor(')) offenders.push(`${f} reads a private field without joinDetailsFor`); }
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

(async () => {
  await unit0();
  await unit1();
  await unit1b();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('Failed:'); for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });

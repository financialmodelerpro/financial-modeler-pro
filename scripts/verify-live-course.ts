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
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
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
    let headOnly = false;
    const run = (): { data: Row[]; error: null | { message: string }; count?: number } => {
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
      const total = sel.length;
      if (lim != null) sel = sel.slice(0, lim);
      return { data: headOnly ? [] : sel, error: null, count: total } as { data: Row[]; error: null; count: number };
    };
    const q: Record<string, unknown> = {
      select: (_c?: string, o?: { count?: string; head?: boolean }) => { if (o?.head) headOnly = true; return q; },
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
  // Storage stub: records uploads per bucket (for the materials rules).
  const uploads: { bucket: string; path: string; bytes: number }[] = [];
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Uint8Array) => { uploads.push({ bucket, path, bytes: bytes.length }); return { error: null }; },
      createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null }),
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://public/${path}` } }),
    }),
  };
  return { client: { from, storage } as unknown as import('@supabase/supabase-js').SupabaseClient, tables, uploads };
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
  check('U1b.3c the sign-in link lands on the course page and enrols', en.courseSigninUrl('REFM') === `/signin?redirect=${encodeURIComponent('/training/REFM?enrol=1')}`);

  // Wiring of the real routes (the register route is behind hCaptcha, and
  // confirm-email consumes a real registration id, so they are pinned by source).
  const reg = readFileSync('app/api/training/register/route.ts', 'utf8');
  const dupAt = reg.indexOf('existing?.email_confirmed');
  const upsertAt = reg.indexOf("from('training_pending_registrations').upsert");
  check('U1b.4a register: an existing email returns before any pending row is written (no duplicate account)', dupAt > 0 && upsertAt > dupAt && /duplicate:\s*true/.test(reg.slice(dupAt, upsertAt)));
  check('U1b.4b register: the duplicate response carries the course sign-in link', /signinUrl:\s*enrolCourseCode\s*\?\s*courseSigninUrl\(/.test(reg));
  // Re-aimed 2026-11-08: the rule is now the course status (canRegister: published, enrolment open), mig 249.
  check('U1b.4c register: only a published course with enrolment open is accepted', reg.includes('settings && canRegister(settings)') && reg.includes('enrol_course_code: enrolCourseCode'));
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
  const admin = readFileSync('app/admin/training-hub/live-training/LiveSessionsManager.tsx', 'utf8') /* the editor moved 2026-11-08 */;
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
  const btnUsers = ['app/training/live-sessions/[id]/page.tsx', 'src/hubs/training/components/dashboard/LiveSessionCard.tsx', 'app/training/[courseId]/sessions/[id]/CourseSessionClient.tsx']; // a course's Join button is on its session page since 2026-11-08
  // Re-aimed 2026-11-10: a course session's button is CourseSessionAction, which renders THE Join button in the window.
  check('U2.5d detail page, dashboard card and course session page all use THE Join button', btnUsers.every((f) => /<JoinLiveButton|<CourseSessionAction/.test(readFileSync(f, 'utf8'))) && readFileSync('src/hubs/training/components/sessions/CourseSessionAction.tsx', 'utf8').includes('<JoinLiveButton '));

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

async function unit5(): Promise<void> {
  console.log('\n=== Unit 5: recordings ===\n');
  const R = await import('../src/hubs/training/lib/liveCourse/recordings');
  const { client } = fakeDb({
    training_course_settings: [REFM_ROW],
    training_enrollments: [{ id: 'e1', registration_id: 'FMP-1', course_code: 'REFM' }, { id: 'e2', registration_id: 'FMP-2', course_code: 'REFM' }, { id: 'e3', registration_id: 'FMP-3', course_code: 'REFM' }],
    training_registrations_meta: [{ registration_id: 'FMP-1', email: 'attended@x.com', name: 'A' }, { registration_id: 'FMP-2', email: 'missed@x.com', name: 'M' }, { registration_id: 'FMP-3', email: 'partial@x.com', name: 'P' }],
    live_session_attendance: [
      { id: 'a1', session_id: 's1', student_email: 'attended@x.com', intervals: [], attended_pct: 80, session_seconds: 9000, source: 'graph' },
      { id: 'a2', session_id: 's1', student_email: 'partial@x.com', intervals: [], attended_pct: 50, session_seconds: 9000, source: 'graph' },
    ],
    session_watch_history: [],
  });
  const to = (await R.recordingRecipientsForCourseSession(client, 's1', 'REFM')).map((r) => r.student_email).sort();
  check('U5.1a the recording email goes to enrolled students below the live threshold (missed, partial)', JSON.stringify(to) === JSON.stringify(['missed@x.com', 'partial@x.com']), JSON.stringify(to));
  check('U5.1b an exam course has no course recipients', (await R.recordingRecipientsForCourseSession(client, 's1', '3SFM')).length === 0);

  const admin = readFileSync('app/admin/training-hub/live-training/LiveSessionsManager.tsx', 'utf8') /* the editor moved 2026-11-08 */;
  check('U5.2a "Mark as Recorded" sends session_type (it sent `type`, which the PATCH dropped)', admin.includes("JSON.stringify({ session_type: 'recorded', youtube_url: markRecordedUrl") && !admin.includes("JSON.stringify({ type: 'RECORDED'"));
  const patch = readFileSync('app/api/admin/live-sessions/[id]/route.ts', 'utf8');
  const post = readFileSync('app/api/admin/live-sessions/route.ts', 'utf8');
  check('U5.2b a course session\'s recording is always embedded (tracked), on edit and on create', /if \(courseCode\) updates\.youtube_embed = true/.test(patch) && post.includes('courseFields(body).course_code ? true'));
  check('U5.2c the recording email for a course session uses the course recipients', patch.includes('recordingRecipientsForCourseSession(sb, id, courseCode)'));
  const page = readFileSync('app/training/live-course/[code]/LiveCourseClient.tsx', 'utf8');
  // Re-aimed 2026-11-08: the recording link is the session page's main button, to the tracked player at ./watch.
  check('U5.3a a course session links its recording to the tracked session player', readFileSync('app/training/[courseId]/sessions/[id]/CourseSessionClient.tsx', 'utf8').includes('sessionMainAction(') && readFileSync('src/hubs/training/lib/liveCourse/courseNav.ts', 'utf8').includes("href: `${courseSessionPath(p.courseCode, p.sessionId)}/watch`"));
  const detail = readFileSync('app/training/live-sessions/[id]/page.tsx', 'utf8');
  check('U5.3b the player is not gated on a per-session registration (enrolled or new students can watch)', /const hasVideo = session\.youtube_embed && !!ytId;/.test(detail));
  const watched = readFileSync('app/api/training/live-sessions/[id]/watched/route.ts', 'utf8');
  check('U5.3c watch progress is merged on the server from intervals (what eligibility reads)', watched.includes('watch_intervals') && watched.includes('watch_seconds'));
}

async function unit6(): Promise<void> {
  console.log('\n=== Unit 6: model submission gate, attempts and reset ===\n');
  const CA = await import('../src/hubs/training/lib/modelSubmission/checkApproval');
  const RS = await import('../src/hubs/training/lib/modelSubmission/resetSubmissions');
  const row = (n: number, status: 'pending_review' | 'approved' | 'rejected', superseded: string | null = null) =>
    ({ id: `m${n}`, status, submitted_at: `2027-01-0${n}T10:00:00Z`, superseded_at: superseded, attempt_number: n });

  // Attempts 1 to 3 and the lock.
  const s0 = CA.submissionState([], 3);
  check('U6.1a no submission: 0 used, 3 left, not locked', s0.attemptsUsed === 0 && s0.attemptsRemaining === 3 && !s0.locked);
  const s1 = CA.submissionState([row(1, 'rejected')], 3);
  check('U6.1b one rejection: 1 used, 2 left, not locked', s1.attemptsUsed === 1 && s1.attemptsRemaining === 2 && !s1.locked);
  const s2 = CA.submissionState([row(1, 'rejected'), row(2, 'rejected')], 3);
  check('U6.1c two rejections: 2 used, 1 left, not locked', s2.attemptsUsed === 2 && s2.attemptsRemaining === 1 && !s2.locked);
  const s3p = CA.submissionState([row(1, 'rejected'), row(2, 'rejected'), row(3, 'pending_review')], 3);
  check('U6.1d third attempt under review: not locked yet', !s3p.locked && s3p.latestStatus === 'pending_review');
  const s3 = CA.submissionState([row(1, 'rejected'), row(2, 'rejected'), row(3, 'rejected')], 3);
  check('U6.1e LOCKED after the 3rd rejection', s3.locked && s3.attemptsRemaining === 0 && s3.latestStatus === 'rejected');
  const s3a = CA.submissionState([row(1, 'rejected'), row(2, 'rejected'), row(3, 'approved')], 3);
  check('U6.1f approved on the 3rd attempt: not locked', !s3a.locked && s3a.hasApproved);
  const after = CA.submissionState([row(1, 'rejected', 'x'), row(2, 'rejected', 'x'), row(3, 'rejected', 'x')], 3);
  check('U6.1g after a reset (rows superseded): 0 used, attempt 1 again, not locked', after.attemptsUsed === 0 && !after.locked && after.latestStatus === 'none');
  const supApproved = CA.submissionState([row(1, 'approved', 'x')], 3);
  check('U6.1h a superseded row never counts as an approval', !supApproved.hasApproved);

  // Admin reset against an in-memory database.
  const { client, tables } = fakeDb({
    model_submissions: [
      { id: 'a1', email: 'locked@x.com', course_code: 'REFM', status: 'rejected', superseded_at: null },
      { id: 'a2', email: 'locked@x.com', course_code: 'REFM', status: 'rejected', superseded_at: null },
      { id: 'a3', email: 'locked@x.com', course_code: 'REFM', status: 'rejected', superseded_at: null },
      { id: 'b1', email: 'locked@x.com', course_code: '3SFM', status: 'rejected', superseded_at: null },
      { id: 'c1', email: 'approved@x.com', course_code: 'REFM', status: 'approved', superseded_at: null },
      { id: 'd1', email: 'pending@x.com', course_code: 'REFM', status: 'pending_review', superseded_at: null },
    ],
    admin_audit_log: [],
  });
  const r = await RS.resetSubmissionAttempts(client, { email: 'LOCKED@x.com', courseCode: 'refm', by: 'admin@x.com', adminId: 'admin-uuid', reason: 'Second chance' });
  check('U6.2a reset supersedes the locked student\'s 3 attempts', r.ok && r.superseded === 3 && ['a1', 'a2', 'a3'].every((id) => !!tables.model_submissions.find((x) => x.id === id)!.superseded_at));
  check('U6.2b rows are kept as history (none deleted)', tables.model_submissions.length === 6);
  check('U6.2c only that course: the student\'s 3SFM attempt is untouched', !tables.model_submissions.find((x) => x.id === 'b1')!.superseded_at);
  check('U6.2d the reset is audited with the admin id', tables.admin_audit_log.some((a) => a.action === 'model_submission_reset' && a.admin_id === 'admin-uuid'));
  check('U6.2e an approved student cannot be reset', !(await RS.resetSubmissionAttempts(client, { email: 'approved@x.com', courseCode: 'REFM', by: 'a' })).ok);
  check('U6.2f a submission under review blocks a reset', !(await RS.resetSubmissionAttempts(client, { email: 'pending@x.com', courseCode: 'REFM', by: 'a' })).ok);
  check('U6.2g nothing to reset is refused, not a silent success', !(await RS.resetSubmissionAttempts(client, { email: 'locked@x.com', courseCode: 'REFM', by: 'a' })).ok);

  // The upload route's gate order: eligibility, review in flight, approved, lock.
  const route = readFileSync('app/api/training/model-submission/route.ts', 'utf8');
  const iElig = route.indexOf("error: 'not_eligible'"), iPend = route.indexOf("error: 'pending_review_in_flight'"), iLock = route.indexOf("error: 'attempts_exhausted'"), iUp = route.indexOf('.storage');
  check('U6.3a a live course refuses uploads until eligible, before anything is stored', iElig > 0 && iElig < iPend && iPend < iLock && iLock < iUp);
  check('U6.3b the lock reads the explicit flag', route.includes('status.locked || status.attemptsUsed >= status.maxAttempts'));
  check('U6.3c attempts restart at 1 after a reset (counted from active rows)', route.includes('attempt_number: attemptNumber'));
  const review = readFileSync('app/api/admin/model-submissions/[id]/review/route.ts', 'utf8');
  check('U6.3d the review route counts attempts through THE status reader (active rows, course cap)', review.includes('getModelSubmissionStatus(submission.email, submission.course_code)'));
  check('U6.3e approval and rejection emails take the no-exam wording for a live course', (review.match(/noExam: liveCourse/g) ?? []).length === 2);

  // Emails: the exam wording is unchanged unless noExam is set.
  const { modelSubmissionApprovedTemplate } = await import('../src/shared/email/templates/modelSubmissionApproved');
  const { modelSubmissionRejectedTemplate } = await import('../src/shared/email/templates/modelSubmissionRejected');
  const examA = await modelSubmissionApprovedTemplate({ courseLabel: '3SFM', fileName: 'm.xlsx', attemptNumber: 1 });
  const liveA = await modelSubmissionApprovedTemplate({ courseLabel: 'REFM', fileName: 'm.xlsx', attemptNumber: 1, noExam: true });
  check('U6.4a an exam course\'s approval email is unchanged ("Final exam unlocked")', examA.subject.includes('Final exam unlocked'));
  check('U6.4b a live course\'s approval email says the certificate is on its way, no exam', liveA.subject.includes('certificate is on its way') && !liveA.html.includes('Final Exam'));
  const liveR = await modelSubmissionRejectedTemplate({ courseLabel: 'REFM', fileName: 'm.xlsx', attemptNumber: 3, attemptsRemaining: 0, maxAttempts: 3, reviewerNote: 'Fix the debt schedule', noExam: true });
  check('U6.4c the 3rd rejection email says uploads are locked and an admin can reset', /locked/.test(liveR.html) && /reset/.test(liveR.html) && !liveR.html.includes('Final Exam'));

  // Exam courses unchanged on the LIVE data: active-row counting equals the
  // old every-row count for every (student, course), and no live-course fields.
  if (hasCreds()) {
    const sb = await db();
    const { data: subs, error } = await sb.from('model_submissions').select('email, course_code, status, submitted_at, superseded_at').range(0, 4999);
    check('U6.5a model_submissions is readable with the new columns', !error, error?.message ?? '');
    const groups = new Map<string, { status: 'pending_review' | 'approved' | 'rejected'; submitted_at: string; superseded_at: string | null }[]>();
    for (const s of subs ?? []) {
      const k = `${String(s.email).toLowerCase()}|${s.course_code}`;
      groups.set(k, [...(groups.get(k) ?? []), s as never]);
    }
    let same = 0; const diff: string[] = [];
    for (const [k, list] of groups) {
      const st = CA.submissionState(list, 3);
      const old = { used: list.length, approved: list.some((x) => x.status === 'approved') };
      if (st.attemptsUsed === old.used && st.hasApproved === old.approved) same++; else diff.push(k);
    }
    check(`U6.5b every existing student's attempts and approval read the same as before (${same} of ${groups.size})`, diff.length === 0, diff.slice(0, 3).join(', '));
    const any3 = (subs ?? []).find((s) => s.course_code === '3SFM');
    if (any3) {
      const st = await CA.getModelSubmissionStatus(String(any3.email), '3SFM');
      check('U6.5c an exam course status carries no live-course gate (liveCourse false, eligibleToSubmit null)', st.liveCourse === false && st.eligibleToSubmit === null);
    }
    const live = await CA.getModelSubmissionStatus('nobody-verify@example.com', 'REFM');
    check('U6.5d REFM: approval required, 3 attempts, not eligible with no progress', live.liveCourse && live.required && live.maxAttempts === 3 && live.eligibleToSubmit === false);
  }
}

async function unit7(): Promise<void> {
  console.log('\n=== Unit 7: certificate ===\n');
  const elig = readFileSync('src/hubs/training/lib/certificates/certificateEligibility.ts', 'utf8');
  const engine = readFileSync('src/hubs/training/lib/certificates/certificateEngine.ts', 'utf8');
  const review = readFileSync('app/api/admin/model-submissions/[id]/review/route.ts', 'utf8');

  // The live branch is reachable ONLY for a code with no exam sessions.
  check('U7.1a the live-course branch sits behind "no exam sessions in COURSES"', /if \(!regular\.length && !final\) \{\s*const live = await getLiveCourseSettings/.test(elig));
  check('U7.1b a live course is eligible exactly when eligibility.ts unlocks submission', elig.includes('eligible: e.submissionUnlocked'));
  check('U7.1c the model-approval gate in the engine is unchanged (required and not approved = held)', engine.includes('modelStatus.required && !modelStatus.hasApproved'));
  check('U7.1d approval issues the certificate through the existing engine', review.includes('issueCertificateForStudent(studentEmail, courseCode'));
  check('U7.1e a live course\'s certificate carries its grade label (no scores)', engine.includes('grade:             live.certificateGradeLabel'));
  check('U7.1f the engine still refuses an unknown course', engine.includes('if (!course && !isLiveCourseRow(live)) return { ok: false, error: `Unknown course code: ${code}` }'));
  const tmpl = readFileSync('app/api/admin/certificates/upload-template/route.ts', 'utf8');
  check('U7.1g REFM certificate and badge templates can be uploaded where the engine reads them', tmpl.includes("templates/refm-template.pdf") && tmpl.includes("templates/refm-badge.png") && engine.includes('templates/${data.courseCode.toLowerCase()}-template.pdf'));
  const { COURSES } = await import('../src/hubs/training/config/courses');
  check('U7.1h 3SFM and BVM still have exam sessions in COURSES (so they never take the live branch)', COURSES['3sfm'].sessions.some((s) => s.isFinal) && COURSES['bvm'].sessions.some((s) => s.isFinal));

  if (hasCreds()) {
    const { checkEligibility } = await import('../src/hubs/training/lib/certificates/certificateEligibility');
    const none = await checkEligibility('nobody-verify@example.com', 'REFM');
    check('U7.2a REFM, no progress: not eligible, with the reason and every session listed as missing', !none.eligible && !!none.reason && none.reason !== 'Course not found');
    const unknown = await checkEligibility('nobody-verify@example.com', 'ZZZZ');
    check('U7.2b an unknown course is still "Course not found"', unknown.reason === 'Course not found');
    // Exam courses unchanged: a student holding an issued 3SFM / BVM
    // certificate is still eligible through the exam path.
    const sb = await db();
    for (const code of ['3SFM', 'BVM']) {
      const { data: c } = await sb.from('student_certificates').select('email').eq('course_code', code).eq('cert_status', 'Issued').limit(1).maybeSingle();
      if (!c?.email) { console.log(`        (no issued ${code} certificate on live data to replay)`); continue; }
      const r = await checkEligibility(String(c.email), code.toLowerCase());
      check(`U7.2c an issued ${code} holder still resolves on the exam path (scores, not live sessions)`, r.reason !== 'Not every session is complete (attended live or recording watched)' && (r.finalScore !== null || r.passedSessions.some((t) => t.startsWith(code))), JSON.stringify({ eligible: r.eligible, reason: r.reason }));
    }
  }
}

async function unit8(): Promise<void> {
  console.log('\n=== Public visibility: private live courses (safe live testing) ===\n');
  const PV = await import('../src/hubs/training/lib/liveCourse/publicVisibility');
  check('U8.1a no public course: only standalone sessions are public', PV.publicSessionOrFilter([]) === 'course_code.is.null');
  check('U8.1b a public course\'s sessions are public too', PV.publicSessionOrFilter(['REFM']) === 'course_code.is.null,course_code.in.(REFM)');
  const publicReaders = ['app/api/public/training-sessions/route.ts', 'app/api/public/training-sessions/[id]/route.ts', 'app/sitemap.ts', 'app/training-sessions/page.tsx', 'app/training-sessions/[id]/page.tsx', 'app/api/training/live-sessions/route.ts'];
  const missing = publicReaders.filter((f) => {
    const src = readFileSync(f, 'utf8');
    const queries = (src.match(/\.eq\('is_published', true\)/g) ?? []).length;
    const filtered = (src.match(/\.or\(await publicSessionFilter\(sb\)\)/g) ?? []).length;
    return queries === 0 || filtered < queries;
  });
  check('U8.2a every public session query applies the visibility rule (page, APIs, sitemap, generic lists)', missing.length === 0, missing.join(', '));
  check('U8.2b the session detail route is NOT filtered (enrolled students open private-course sessions)', !readFileSync('app/api/training/live-sessions/[id]/route.ts', 'utf8').includes('publicSessionFilter'));
  const post = readFileSync('app/api/admin/live-sessions/route.ts', 'utf8');
  const patch = readFileSync('app/api/admin/live-sessions/[id]/route.ts', 'utf8');
  // Re-aimed 2026-11-10: stronger now, NO course session (private or public) auto-notifies; the course is announced once.
  check('U8.3a creating a private-course session never emails newsletter subscribers', post.includes('data.is_published && !data.course_code && await isPublicSession(sb, data.course_code)'));
  check('U8.3b publishing or recording a private-course session never emails them either', (patch.match(/if \(announceable && before/g) ?? []).length === 2);
  if (hasCreds()) {
    const sb = await db();
    const codes = await PV.publicCourseCodes(sb);
    check('U8.4a REFM is a public course on live data', codes.includes('REFM'));
    const { error } = await sb.from('live_sessions').select('id').eq('is_published', true).or(await PV.publicSessionFilter(sb)).limit(1);
    check('U8.4b the filter is valid PostgREST on the live database', !error, error?.message ?? '');
  }
}

async function unit9(): Promise<void> {
  console.log('\n=== Live Training: status, admin area, images, time zones, certificates ===\n');
  const cs = await import('../src/hubs/training/lib/liveCourse/courseSettings');
  const ca = await import('../src/hubs/training/lib/liveCourse/courseAdmin');
  const PV = await import('../src/hubs/training/lib/liveCourse/publicVisibility');
  const en = await import('../src/hubs/training/lib/liveCourse/enrolment');
  const tz = await import('../src/hubs/training/lib/liveCourse/timeZones');
  const pr = await import('../src/hubs/training/lib/liveCourse/preview');
  const cm = await import('../src/hubs/training/lib/liveCourse/courseMedia');
  const E = await import('../src/hubs/training/lib/liveCourse/eligibility');
  const SC = await import('../src/hubs/training/lib/liveCourse/sessionCertificate');

  // ── Status ──
  const row = (status: string, extra: Record<string, unknown> = {}) => ({ ...REFM_ROW, course_code: `C${status.slice(0, 3).toUpperCase()}`, status, ...extra });
  const draft = cs.settingsFromRow(row('draft'));
  const pub = cs.settingsFromRow(row('published'));
  const arch = cs.settingsFromRow(row('archived'));
  const closed = cs.settingsFromRow(row('published', { course_code: 'CCLO', enrolment_open: false }));
  check('U9.1a before mig 249: is_public true reads as published, false as draft', cs.statusOf({ is_public: true }) === 'published' && cs.statusOf({ is_public: false }) === 'draft');
  check('U9.1b a Draft course is not public and registration is closed', !cs.isPubliclyVisible(draft) && !cs.canRegister(draft));
  check('U9.1c a Published course is public and open', cs.isPubliclyVisible(pub) && cs.canRegister(pub));
  check('U9.1d an Archived course is hidden, but an enrolled student still opens it', !cs.isPubliclyVisible(arch) && cs.studentCanOpen(arch, true) && !cs.studentCanOpen(arch, false));
  check('U9.1e enrolled students keep access in EVERY status', [draft, pub, arch, closed].every((c) => cs.studentCanOpen(c, true)));
  check('U9.1f Enrolment Closed: public, but Register is blocked', cs.isPubliclyVisible(closed) && !cs.canRegister(closed));

  const { client, tables } = fakeDb({
    training_course_settings: [row('draft'), row('published'), row('archived'), { ...row('published'), course_code: 'CCLO', enrolment_open: false }],
    live_sessions: [],
    training_enrollments: [{ id: 'x', registration_id: 'FMP-ARCH', course_code: 'CARC' }],
  });
  const codes = await PV.publicCourseCodes(client);
  check('U9.2a public pages, APIs, sitemap and newsletter see only published courses', codes.includes('CPUB') && codes.includes('CCLO') && !codes.includes('CDRA') && !codes.includes('CARC'), codes.join(','));
  const send = async () => {};
  check('U9.2b enrolling in a Draft course is refused', !(await en.enrolInLiveCourse(client, { registrationId: 'R1', email: 'a@x.com', courseCode: 'CDRA', source: 'dashboard' }, { send })).ok);
  check('U9.2c enrolling in a closed course is refused with "closed"', /closed/i.test((await en.enrolInLiveCourse(client, { registrationId: 'R1', email: 'a@x.com', courseCode: 'CCLO', source: 'dashboard' }, { send })).error ?? ''));
  check('U9.2d an already enrolled student in an Archived course stays enrolled (idempotent)', (await en.enrolInLiveCourse(client, { registrationId: 'FMP-ARCH', email: 'z@x.com', courseCode: 'CARC', source: 'dashboard' }, { send })).alreadyEnrolled);
  check('U9.2e a Published, open course still enrols', (await en.enrolInLiveCourse(client, { registrationId: 'R2', email: 'b@x.com', courseCode: 'CPUB', source: 'dashboard' }, { send })).ok && tables.training_enrollments.length === 2);

  const reg = readFileSync('app/api/training/register/route.ts', 'utf8');
  check('U9.2f the public register route accepts a course only through canRegister', reg.includes('settings && canRegister(settings)'));
  const page = readFileSync('app/training/live-course/[code]/LiveCoursePage.tsx', 'utf8');
  check('U9.2g the course page is 404 for a signed-out visitor unless published or previewed', page.includes('if (!sess && !visible && !previewOk) notFound();'));
  check('U9.2h the sitemap lists published courses only', readFileSync('app/sitemap.ts', 'utf8').includes("listLiveCourses(sb, { publicOnly: true })"));

  // ── Publish / Unpublish ──
  const toPub = ca.statusUpdate('published', new Date('2026-11-08T10:00:00Z'));
  check('U9.3a Publish writes status published (and the old flag, for the previous deploy)', toPub.status === 'published' && toPub.is_public === true && toPub.published_at === '2026-11-08T10:00:00.000Z');
  const toDraft = ca.statusUpdate('draft');
  check('U9.3b Unpublish writes status draft', toDraft.status === 'draft' && toDraft.is_public === false);
  check('U9.3c Archive stamps archived_at', !!ca.statusUpdate('archived').archived_at);
  check('U9.3d an unknown status is refused', !ca.isCourseStatus('live'));
  const patch = readFileSync('app/api/admin/live-course/[code]/route.ts', 'utf8');
  check('U9.3e the admin PATCH changes status through statusUpdate', patch.includes('Object.assign(update, statusUpdate(body.status))'));
  const adminPage = readFileSync('app/admin/training-hub/live-training/[code]/page.tsx', 'utf8');
  check('U9.3f Publish / Unpublish has a confirm step before the PATCH', adminPage.includes('setConfirmTo(a.to)') && adminPage.includes('course-status-confirm-yes'));
  const u = ca.courseUpdateFromBody({ title: ' REFM ', attendanceThresholdPct: 80, maxSubmissionAttempts: 3, certRoutes: ['live'], timeZones: ['Asia/Riyadh', 'Europe/London'], enrolmentOpen: false, sessionCertificates: false });
  check('U9.3g details and rules validate and map to columns', u.ok && u.update.title === 'REFM' && u.update.attendance_threshold_pct === 80 && u.update.enrolment_open === false && u.update.session_certificates === false && JSON.stringify(u.update.time_zones) === '["Asia/Riyadh","Europe/London"]');
  check('U9.3h a bad zone, a 0% threshold or no route is refused', !ca.courseUpdateFromBody({ timeZones: ['Mars/Base'] }).ok && !ca.courseUpdateFromBody({ attendanceThresholdPct: 0 }).ok && !ca.courseUpdateFromBody({ certRoutes: [] }).ok);
  check('U9.3i a new course starts as a draft', readFileSync('src/hubs/training/lib/liveCourse/courseAdmin.ts', 'utf8').includes("status: 'draft', is_public: false"));

  // ── Preview link ──
  const prevSecret = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = prevSecret || 'verify-secret';
  const tok = pr.previewToken('TEST');
  check('U9.4a the preview link token opens its own course', pr.isValidPreviewToken('TEST', tok));
  check('U9.4b and no other course, and not a forged token', !pr.isValidPreviewToken('REFM', tok) && !pr.isValidPreviewToken('TEST', 'x'.repeat(32)));
  process.env.NEXTAUTH_SECRET = prevSecret;

  // ── Time zones ──
  const dec = tz.zoneTimes('2026-12-01T16:00:00Z', tz.DEFAULT_TIME_ZONES);
  const at = (rows: typeof dec, id: string) => rows.find((r) => r.tz === id)!;
  check('U9.5a 7:00 PM KSA on Tuesday 1 Dec 2026 reads 7:00 PM in Riyadh', at(dec, 'Asia/Riyadh').time === '7:00 PM' && at(dec, 'Asia/Riyadh').weekday === 'Tue');
  check('U9.5b UK 4:00 PM', at(dec, 'Europe/London').time === '4:00 PM');
  check('U9.5c US Eastern 11:00 AM', at(dec, 'America/New_York').time === '11:00 AM');
  check('U9.5d Perth 12:00 AM Wednesday, marked +1 day', at(dec, 'Australia/Perth').time === '12:00 AM' && at(dec, 'Australia/Perth').weekday === 'Wed' && at(dec, 'Australia/Perth').dayMark === '+1 day');
  check('U9.5e Sydney 3:00 AM Wednesday (+1 day)', at(dec, 'Australia/Sydney').time === '3:00 AM' && at(dec, 'Australia/Sydney').weekday === 'Wed' && at(dec, 'Australia/Sydney').dayMark === '+1 day');
  const jul = tz.zoneTimes('2027-07-06T16:00:00Z', tz.DEFAULT_TIME_ZONES);
  check('U9.5f summer: daylight saving applies (UK 5:00 PM, US Eastern 12:00 PM, Sydney 2:00 AM)', at(jul, 'Europe/London').time === '5:00 PM' && at(jul, 'America/New_York').time === '12:00 PM' && at(jul, 'Australia/Sydney').time === '2:00 AM');
  check('U9.5g the default list has the founder\'s 13 regions, in order', tz.DEFAULT_TIME_ZONES.length === 13 && tz.DEFAULT_TIME_ZONES[0].tz === 'Asia/Riyadh' && tz.DEFAULT_TIME_ZONES[12].tz === 'Australia/Sydney');
  check('U9.5h a course\'s own regions replace the default; an invalid zone is dropped', JSON.stringify(tz.regionsFor(['Europe/London', 'Bad/Zone']).map((r) => r.tz)) === '["Europe/London"]' && tz.regionsFor(null).length === 13);
  const ttable = readFileSync('src/hubs/training/components/sessions/TimeZoneTable.tsx', 'utf8');
  check('U9.5i the table has a "Your local time" line from the browser and a collapsible card form', ttable.includes('Your local time') && ttable.includes('resolvedOptions().timeZone') && ttable.includes('See times in your region'));
  const tzUsers = ['app/training/live-course/[code]/CourseLanding.tsx', 'app/training/live-sessions/[id]/page.tsx', 'app/training-sessions/[id]/DetailClient.tsx', 'app/training-sessions/PublicCourseOffers.tsx'];
  // The course page renders the table through its landing layout (side card), since the landing page.
  check('U9.5j the table is on the course page, both session pages and the course card', tzUsers.every((f) => readFileSync(f, 'utf8').includes('<TimeZoneTable')));

  // ── Images ──
  const course = cs.settingsFromRow({ ...REFM_ROW, banner_url: 'https://cdn/x/banner.jpg', banner_alt: 'Hero' });
  const withBanner = cm.withCourseMedia({ course_code: 'REFM', banner_url: null }, course);
  check('U9.6a a session with no image and a course with no card image shows the course banner (and its alt)', withBanner.banner_url === 'https://cdn/x/banner.jpg' && withBanner.banner_alt === 'Hero');
  const withCard = cm.withCourseMedia({ course_code: 'REFM', banner_url: null }, cs.settingsFromRow({ ...REFM_ROW, banner_url: 'https://cdn/x/banner.jpg', card_image_url: 'https://cdn/x/card.jpg', card_image_alt: 'Card' }));
  check('U9.6a2 a session with no image shows the 16:9 course card image first', withCard.banner_url === 'https://cdn/x/card.jpg' && withCard.banner_alt === 'Card');
  check('U9.6b a session\'s own banner wins', cm.withCourseMedia({ course_code: 'REFM', banner_url: 'own.jpg' }, course).banner_url === 'own.jpg');
  check('U9.6c a single session is untouched', JSON.stringify(cm.withCourseMedia({ course_code: null, banner_url: null }, course)) === JSON.stringify({ course_code: null, banner_url: null }));
  const img = readFileSync('app/api/admin/live-course/[code]/image/route.ts', 'utf8');
  check('U9.6d course images are stored in storage with alt text, JPG/PNG/WebP up to 5 MB', img.includes(".from('live-session-banners')") && img.includes('_alt') && img.includes('MAX_BYTES = 5 * 1024 * 1024'));
  const det = readFileSync('app/admin/training-hub/live-training/[code]/CourseDetailsTab.tsx', 'utf8');
  check('U9.6e admin shows the recommended sizes', det.includes('1920 x 640 px') && det.includes('1200 x 675 px') && readFileSync('app/admin/training-hub/live-training/LiveSessionsManager.tsx', 'utf8').includes('1200 x 675 px (16:9)')); // session image slot is 16:9 since 2026-11-08

  // ── Admin area: one area, one editor, old URLs redirect ──
  check('U9.7a /admin/training-hub/live-sessions redirects to Live Training (Single sessions)', readFileSync('app/admin/training-hub/live-sessions/page.tsx', 'utf8').includes("redirect('/admin/training-hub/live-training?tab=sessions')"));
  check('U9.7b /admin/training-hub/live-course redirects to Live Training', readFileSync('app/admin/training-hub/live-course/page.tsx', 'utf8').includes("redirect('/admin/training-hub/live-training')"));
  const home = readFileSync('app/admin/training-hub/live-training/page.tsx', 'utf8');
  // The rule is "one editor, given the course"; a key prop (for refresh) is allowed.
  check('U9.7c both tabs use the ONE session editor (no second editor)', home.includes('<LiveSessionsManager embedded />') && /<LiveSessionsManager[^>]*courseCode=\{course\.courseCode\}[^>]*embedded \/>/.test(adminPage));
  const mgr = readFileSync('app/admin/training-hub/live-training/LiveSessionsManager.tsx', 'utf8');
  check('U9.7d Single sessions lists only sessions with no course; a course tab only its own', mgr.includes('if (courseCode ? sCourse !== courseCode : !!sCourse) return false;'));
  check('U9.7e a new session in a course tab gets the course and the next session number', mgr.includes("course_code: courseCode, course_session_no: String(nextNo)"));
  const nav = readFileSync('src/components/admin/CmsAdminNav.tsx', 'utf8');
  check('U9.7f the menu has one Live Training item (Live Sessions / Live Courses gone)', nav.includes("label: 'Live Training'") && !nav.includes("label: 'Live Sessions'") && !nav.includes("label: 'Live Courses'"));

  // ── Single sessions unchanged ──
  check('U9.8a a single session stays public (standalone sessions pass the filter)', PV.publicSessionOrFilter([]).startsWith('course_code.is.null'));
  const post = readFileSync('app/api/admin/live-sessions/route.ts', 'utf8');
  check('U9.8b a single session still announces to the newsletter (course_code null is public)', (await PV.isPublicSession(client, null)) === true && post.includes('isPublicSession(sb, data.course_code)'));

  // ── Certificates: the same system as 3SFM and BVM ──
  const sessions = [{ id: 's1', course_session_no: 1, title: 'Session 1', scheduled_datetime: '2026-12-01T16:00:00Z', duration_minutes: 150, session_type: 'upcoming' as const, youtube_url: 'https://youtu.be/r1' }];
  const after = new Date('2027-01-01').getTime();
  const live = (p: number) => new Map([['s1', [{ intervals: [] as [string, string][], attended_pct: p, session_seconds: 9000, source: 'graph' }]]]);
  const c75 = E.computeEligibility(pub, sessions, live(75), new Map(), after).sessions[0];
  const c74 = E.computeEligibility(pub, sessions, live(74), new Map(), after).sessions[0];
  check('U9.9a a session certificate is issued at 75% live', SC.sessionCertificateAvailable(pub, c75));
  check('U9.9b and not at 74%', !SC.sessionCertificateAvailable(pub, c74));
  const rec = E.computeEligibility(pub, sessions, new Map(), new Map([['s1', { watch_seconds: 3600, total_seconds: 3600, watch_percentage: 100 }]]), after).sessions[0];
  check('U9.9c a session certificate is issued when the recording is watched in full', SC.sessionCertificateAvailable(pub, rec));
  const off = cs.settingsFromRow({ ...REFM_ROW, session_certificates: false });
  check('U9.9d per-session certificates can be switched off per course', !SC.sessionCertificateAvailable(off, c75));
  const card = (await import('../src/hubs/training/lib/liveSessions/achievementCard')).achievementCardUrl;
  const url = card({ title: 'Session 1', has_assessment: false, duration_minutes: 150 }, 'Ahmad', 'FMP-2026-0001', undefined, '2026-12-01T16:00:00Z', 'REFM Live');
  check('U9.9e the session certificate is the SAME achievement card (route, "Session Completed", name and registration ID)', url.startsWith('/api/training/achievement-image?') && url.includes('has_assessment=false') && url.includes('regId=FMP-2026-0001') && url.includes('name=Ahmad'));
  const large = readFileSync('src/hubs/training/components/dashboard/LiveSessionCardLarge.tsx', 'utf8');
  check('U9.9f the single-session card uses the same shared builder (no second card)', large.includes("from '@/src/hubs/training/lib/liveSessions/achievementCard'") && !large.includes('function achievementCardUrl('));
  const engine = readFileSync('src/hubs/training/lib/certificates/certificateEngine.ts', 'utf8');
  check('U9.9g the course certificate is issued on approval through the same engine', readFileSync('app/api/admin/model-submissions/[id]/review/route.ts', 'utf8').includes('issueCertificateForStudent(') && engine.includes('modelStatus.required && !modelStatus.hasApproved'));
  check('U9.9h every course certificate carries its QR verify page (/verify/<id>)', /\$\{LEARN_URL\}\/verify\/\$\{/.test(engine));
  check('U9.9i the course page links the issued certificate\'s verification page', readFileSync('app/training/live-course/[code]/LiveCourseClient.tsx', 'utf8').includes('view.certificate.verificationUrl'));
  const tmpl = readFileSync('app/api/admin/certificates/upload-template/route.ts', 'utf8');
  check('U9.9j any live course can upload its own certificate and badge templates', tmpl.includes('(cert|badge)$/') && tmpl.includes('templates/${m[1]}-template.pdf'));
  check('U9.9k 3SFM and BVM template slots are unchanged', tmpl.includes("'3sfm-cert':  { bucket: 'certificates', path: 'templates/3sfm-template.pdf'") && tmpl.includes("'bvm-badge':  { bucket: 'badges',       path: 'templates/bvm-badge.png'"));

  if (hasCreds()) {
    const sb = await db();
    const refm = await cs.getLiveCourseSettings(sb, 'REFM');
    check('U9.10a REFM is Published on live data', refm?.status === 'published', refm?.status);
    const test = await cs.getLiveCourseSettings(sb, 'TEST');
    if (test) check('U9.10b TEST is Draft on live data', test.status === 'draft', test.status);
    const { data: raw } = await sb.from('training_course_settings').select('*').eq('course_code', 'REFM').maybeSingle();
    const has249 = !!raw && 'status' in raw;
    console.log(`        (migration 249 ${has249 ? 'APPLIED: status read from its column' : 'NOT YET APPLIED: status derived from is_public'})`);
    if (has249) check('U9.10c mig 249 columns exist (status, enrolment_open, images, time_zones, session_certificates)', ['enrolment_open', 'banner_url', 'card_image_url', 'time_zones', 'session_certificates'].every((k) => k in raw!), Object.keys(raw!).join(','));
  }
}

async function unit10(): Promise<void> {
  console.log('\n=== Course instructors (the live-session instructor records) ===\n');
  const ci = await import('../src/hubs/training/lib/liveCourse/courseInstructors');
  const ca = await import('../src/hubs/training/lib/liveCourse/courseAdmin');
  const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222', C = '33333333-3333-3333-3333-333333333333';
  const rows = [
    { id: B, name: 'Bea', title: 'Analyst', photo_url: 'https://cdn/b.jpg', bio: 'Bio B', active: true },
    { id: A, name: 'Ahmad Din', title: 'Corporate Finance', credentials: 'ACCA, FMVA', active: true },
    { id: C, name: 'Old', title: 'Gone', active: false },
  ];
  const out = ci.orderInstructors([A, B, C, '44444444-4444-4444-4444-444444444444'], rows);
  check('U10.1a several instructors, in the course order', out.map((i) => i.name).join('|') === 'Ahmad Din|Bea');
  check('U10.1b an inactive or deleted instructor is skipped', !out.some((i) => i.name === 'Old') && out.length === 2);
  check('U10.1c name, title, credentials, photo and bio come from the profile', out[1].photoUrl === 'https://cdn/b.jpg' && out[1].bio === 'Bio B' && out[0].credentials === 'ACCA, FMVA');
  const u = ca.courseUpdateFromBody({ instructorIds: [A, B, A] });
  check('U10.2a instructor ids save in order, duplicates removed', u.ok && JSON.stringify(u.update.instructor_ids) === JSON.stringify([A, B]));
  check('U10.2b a free-text value is refused (must come from the list)', !ca.courseUpdateFromBody({ instructorIds: ['Ahmad Din'] }).ok);
  const det = readFileSync('app/admin/training-hub/live-training/[code]/CourseDetailsTab.tsx', 'utf8');
  check('U10.3a the Details tab picks instructors; the free-text Trainer fields are gone', det.includes('<InstructorsField') && !det.includes("text('trainerName'") && det.includes("fetch('/api/admin/instructors')"));
  const view = readFileSync('src/hubs/training/lib/liveCourse/courseView.ts', 'utf8');
  const page = readFileSync('app/training/live-course/[code]/LiveCoursePage.tsx', 'utf8');
  check('U10.3b the course page reads instructors LIVE on every view (public and signed in)', view.includes('loadCourseInstructors(sb, course.instructorIds)') && page.includes('loadCourseInstructors(sb, course.instructorIds)'));
  const offers = readFileSync('app/training-sessions/PublicCourseOffers.tsx', 'utf8');
  check('U10.5a the course card image box is 16:9, the card image size, so nothing is cropped', offers.includes("aspectRatio: '16 / 9'") && !offers.includes('minHeight: 200') && offers.includes('@media (max-width: 720px)'));
  check('U10.3c the public page renders the instructor cards', readFileSync('app/training/live-course/[code]/LiveCourseClient.tsx', 'utf8').includes('<InstructorCard'));
  if (hasCreds()) {
    const sb = await db();
    const { data: def } = await sb.from('instructors').select('id, name').eq('is_default', true).maybeSingle();
    if (def) {
      const live = await ci.loadCourseInstructors(sb, [def.id as string]);
      check('U10.4a the live instructors table reads through the loader', live.length === 1 && live[0].name === def.name);
    }
    const { data: raw } = await sb.from('training_course_settings').select('*').eq('course_code', 'REFM').maybeSingle();
    console.log(`        (migration 250 ${raw && 'instructor_ids' in raw ? 'APPLIED' : 'NOT YET APPLIED: instructor picks cannot be saved yet'})`);
  }
}

async function unit11(): Promise<void> {
  console.log('\n=== REFM sessions: content, materials, reschedule, calendar ===\n');
  const SD = await import('../src/hubs/training/lib/liveCourse/seeds/refmSessions');
  const M = await import('../src/hubs/training/lib/liveCourse/materials');
  const RS = await import('../src/hubs/training/lib/liveCourse/reschedule');
  const RA = await import('../src/hubs/training/lib/liveCourse/rescheduleApply');
  const CAL = await import('../src/hubs/training/lib/liveCourse/calendar');
  const E = await import('../src/hubs/training/lib/liveCourse/eligibility');
  const cs = await import('../src/hubs/training/lib/liveCourse/courseSettings');

  // ── Seed content ──
  const S = SD.REFM_SESSIONS;
  const wantDates = ['2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22', '2027-01-05', '2027-01-12', '2027-01-19', '2027-01-26'];
  check('U11.1a eight sessions, numbered 1 to 8', S.length === 8 && S.every((s, i) => s.no === i + 1));
  check('U11.1b every session starts 16:00 UTC (7:00 PM KSA) on the founder\'s dates, all Tuesdays', S.every((s, i) => s.start === `${wantDates[i]}T16:00:00.000Z` && new Date(s.start).getUTCDay() === 2));
  check('U11.1c every session lasts 150 minutes (to 9:30 PM KSA)', SD.REFM_DURATION_MINUTES === 150);
  check('U11.1d all four content fields are filled on every session', S.every((s) => s.overview.length > 50 && s.learn.length >= 6 && s.outcome.length > 20 && s.claude.length > 20));
  check('U11.1e no session on 29 December', !S.some((s) => s.start.startsWith('2026-12-29')));
  const seed = readFileSync('scripts/seed-refm-sessions.ts', 'utf8');
  check('U11.2a the seed imports no email or newsletter code and calls no sender', !/^import[^\n]*(email|newsletter)/im.test(seed) && !/(sendEmail|sendTemplatedEmail|sendAutoNewsletter|sendEmailPerRecipient)\(/.test(seed));
  check('U11.2b the seed writes rows directly (no admin route side effects) and marks nothing announced', seed.includes(".from('live_sessions').insert(") && seed.includes('announcement_sent: false') && !seed.includes('fetch('));
  check('U11.2c a re-run keeps a rescheduled time unless --reset-times', seed.includes('resetTimes ? { ...content, scheduled_datetime: s.start') && seed.includes(': content;'));
  const teamsRoute = readFileSync('app/api/admin/live-course/[code]/teams-meetings/route.ts', 'utf8');
  check('U11.2d "Create missing Teams meetings" uses the existing integration and sends no email or newsletter', teamsRoute.includes('createCalendarEventWithMeeting(') && !/sendEmail|sendAutoNewsletter|sendTemplatedEmail/.test(teamsRoute));

  // ── Materials release ──
  const sess = { scheduled_datetime: '2026-12-01T16:00:00Z', duration_minutes: 150 };
  check('U11.3a materials are hidden before the session ends (18:29 UTC)', !M.materialsReleased(sess, new Date('2026-12-01T18:29:00Z').getTime()));
  check('U11.3b and visible after (18:31 UTC)', M.materialsReleased(sess, new Date('2026-12-01T18:31:00Z').getTime()));
  check('U11.3c after a reschedule a week later, the release moves with it', !M.materialsReleased({ ...sess, scheduled_datetime: '2026-12-08T16:00:00Z' }, new Date('2026-12-01T18:31:00Z').getTime()));
  const dl = readFileSync('app/api/training/live-sessions/[id]/materials/[materialId]/route.ts', 'utf8');
  check('U11.3d the download route checks access and release before handing out a link', dl.indexOf('studentHasSessionAccess(') < dl.indexOf('createSignedUrl(') && dl.indexOf('materialsReleased(session)') < dl.indexOf('createSignedUrl('));
  check('U11.3e folder names map to session numbers', M.sessionNumberOf('Session_01') === 1 && M.sessionNumberOf('Session_08') === 8 && M.sessionNumberOf('Notes') === null);

  // ── Sync: changed files only, replaced by name ──
  const existing = [{ id: 'm1', session_id: 's1', file_name: 'Slides.pdf', storage_path: 'p1', sha256: 'aaa', size_bytes: 1, mime_type: null, version: 1, versions: [], updated_at: '' }];
  const plan = M.planMaterialSync([{ fileName: 'Slides.pdf', sha: 'aaa' }, { fileName: 'Prompt.txt', sha: 'bbb' }], existing);
  check('U11.4a an unchanged file is skipped, a new one uploaded', plan.find((p) => p.fileName === 'Slides.pdf')?.kind === 'unchanged' && plan.find((p) => p.fileName === 'Prompt.txt')?.kind === 'new');
  check('U11.4b a changed file (same name, new hash) is a replacement', M.planMaterialSync([{ fileName: 'Slides.pdf', sha: 'ccc' }], existing)[0].kind === 'changed');
  const db1 = fakeDb({ live_session_materials: [] });
  const a = await M.putMaterial(db1.client, { sessionId: 's1', fileName: 'Slides.pdf', bytes: Buffer.from('v1'), by: 'test' });
  const b = await M.putMaterial(db1.client, { sessionId: 's1', fileName: 'Slides.pdf', bytes: Buffer.from('v1'), by: 'test' });
  const c = await M.putMaterial(db1.client, { sessionId: 's1', fileName: 'Slides.pdf', bytes: Buffer.from('v2 changed'), by: 'test' });
  const row = db1.tables.live_session_materials[0];
  check('U11.4c first upload is new; the same bytes again change nothing', a.action === 'new' && b.action === 'unchanged' && db1.uploads.length === 2 - 1 + (c.action === 'changed' ? 1 : 0));
  check('U11.4d a changed file replaces by name: same row (same student link), version 2', c.action === 'changed' && db1.tables.live_session_materials.length === 1 && row.version === 2 && row.id === a.row?.id);
  check('U11.4e the previous version is kept (history listed, stored under its own path)', (row.versions as unknown[]).length === 1 && db1.uploads[0].path !== db1.uploads[1].path && db1.uploads.every((u) => u.bucket === 'live-course-materials'));
  const syncSrc = readFileSync('scripts/sync-course-materials.ts', 'utf8');
  check('U11.4f the sync script and the editor share one writer (putMaterial)', syncSrc.includes('putMaterial(') && readFileSync('app/api/admin/live-sessions/[id]/materials/route.ts', 'utf8').includes('putMaterial('));
  check('U11.4g npm run sync:refm-materials points at the REFM folder', JSON.parse(readFileSync('package.json', 'utf8')).scripts['sync:refm-materials'].includes('docs/REFM_Live_Course_Materials'));
  check('U11.4h the materials folder is git-ignored', readFileSync('.gitignore', 'utf8').includes('docs/REFM_Live_Course_Materials/'));

  // ── Reschedule ──
  const eight = S.map((s, i) => ({ id: `s${i + 1}`, course_session_no: s.no, scheduled_datetime: s.start, ics_sequence: 0 }));
  const single = RS.planReschedule(eight, 's3', '2026-12-17T16:00:00.000Z', 'single');
  check('U11.5a single: only session 3 moves', single.ok && single.moves.length === 1 && single.moves[0].newStart === '2026-12-17T16:00:00.000Z');
  const follow = RS.planReschedule(eight, 's4', '2026-12-29T16:00:00.000Z', 'following');
  check('U11.5b following: session 4 and every later one move by the same gap (one week)', follow.ok && follow.moves.length === 5 && follow.moves.every((m) => new Date(m.newStart).getTime() - new Date(m.oldStart).getTime() === 7 * 86_400_000));
  check('U11.5c earlier sessions do not move', !follow.moves.some((m) => ['s1', 's2', 's3'].includes(m.id)));
  const upd = RS.moveUpdate(follow.moves[0]);
  check('U11.5d a move resets the old date\'s reminder and attendance sync, records the previous date, bumps the calendar sequence', upd.day_reminder_sent_at === null && upd.attendance_synced_at === null && upd.rescheduled_from === follow.moves[0].oldStart && upd.ics_sequence === 1);
  check('U11.5e the same time is refused', !RS.planReschedule(eight, 's1', S[0].start, 'single').ok);

  // applyReschedule end to end: rows, Teams, emails to enrolled students only, calendar.
  const sessRows = S.map((s, i) => ({ id: `s${i + 1}`, title: s.title, course_code: 'REFM', course_session_no: s.no, scheduled_datetime: s.start, duration_minutes: 150, ics_sequence: 0, teams_meeting_id: `evt${i + 1}`, live_url: `https://teams/${i + 1}`, is_published: true }));
  const db2 = fakeDb({
    training_course_settings: [REFM_ROW],
    live_sessions: sessRows,
    training_enrollments: [{ id: 'e1', registration_id: 'FMP-1', course_code: 'REFM' }, { id: 'e2', registration_id: 'FMP-2', course_code: 'REFM' }],
    training_registrations_meta: [{ registration_id: 'FMP-1', email: 'a@x.com', name: 'A' }, { registration_id: 'FMP-2', email: 'b@x.com', name: 'B' }, { registration_id: 'FMP-9', email: 'notenrolled@x.com', name: 'N' }],
    session_registrations: [{ id: 'r1', session_id: 's3', student_email: 'notenrolled@x.com' }],
    live_session_reschedules: [],
  });
  const teamsCalls: string[] = [];
  const sent: { to: string; attachments: { name: string; content: string }[] }[] = [];
  const r = await RA.applyReschedule(db2.client, { sessionId: 's3', newStartIso: '2026-12-17T16:00:00.000Z', mode: 'single', by: 'admin@x.com' }, {
    teamsUpdate: async (id, start, end) => { teamsCalls.push(`${id}|${start}|${end}`); return null; },
    send: async (items) => { sent.push(...items); return items.map(() => ({ ok: true })); },
  });
  const moved = db2.tables.live_sessions.find((x) => x.id === 's3')!;
  check('U11.6a the session row moves and keeps its number and id', r.ok && moved.scheduled_datetime === '2026-12-17T16:00:00.000Z' && moved.course_session_no === 3);
  check('U11.6b the Teams meeting moves to the new start and end', teamsCalls[0] === 'evt3|2026-12-17T16:00:00.000Z|2026-12-17T18:30:00.000Z');
  check('U11.6c the email goes to enrolled students only (not a session registrant who is not enrolled)', sent.length === 2 && sent.every((s) => ['a@x.com', 'b@x.com'].includes(s.to)));
  const ics = Buffer.from(sent[0].attachments[0].content, 'base64').toString('utf8');
  check('U11.6d the email carries the updated calendar: same event ID, SEQUENCE 1, new start', ics.includes(`UID:${CAL.eventUid('s3')}`) && /UID:live-session-s3@[^\r]+\r\nSEQUENCE:1\r\n/.test(ics) && ics.includes('DTSTART:20261217T160000Z'));
  check('U11.6e the move is logged', db2.tables.live_session_reschedules.length === 1 && db2.tables.live_session_reschedules[0].emails_sent === 2);
  const db3 = fakeDb({ live_sessions: [{ id: 'solo', course_code: null, scheduled_datetime: S[0].start }] });
  check('U11.6f a single session is not rescheduled by this route (its editor handles its date)', !(await RA.applyReschedule(db3.client, { sessionId: 'solo', newStartIso: S[1].start, mode: 'single', by: null }, { send: async () => [] })).ok);

  // A rescheduled session still counts toward eligibility (same id, new time).
  const course = cs.settingsFromRow(REFM_ROW);
  const moved1 = [{ id: 's3', course_session_no: 3, title: 'S3', scheduled_datetime: '2026-12-17T16:00:00.000Z', duration_minutes: 150, session_type: 'upcoming' as const, youtube_url: null }];
  const el = E.computeEligibility(course, moved1, new Map([['s3', [{ intervals: [], attended_pct: 80, session_seconds: 9000, source: 'graph' }]]]), new Map(), new Date('2027-01-01').getTime());
  check('U11.6g a rescheduled session still counts toward eligibility', el.sessions[0].met && el.submissionUnlocked);

  // ── Calendar file ──
  const base = { courseCode: 'REFM', title: 'REFM Live' };
  const before = CAL.buildCourseIcs(base, [{ id: 's3', title: 'Financing', course_session_no: 3, scheduled_datetime: '2026-12-15T16:00:00Z', duration_minutes: 150, ics_sequence: 0 }]);
  const after = CAL.buildCourseIcs(base, [{ id: 's3', title: 'Financing', course_session_no: 3, scheduled_datetime: '2026-12-17T16:00:00Z', duration_minutes: 150, ics_sequence: 1 }]);
  const uid = (t: string) => /UID:(.+)\r\n/.exec(t)?.[1];
  check('U11.7a the calendar keeps the same event ID after a reschedule', uid(before) === uid(after) && uid(after) === CAL.eventUid('s3'));
  check('U11.7b with a higher SEQUENCE and the new time, so calendars move the event', before.includes('SEQUENCE:0') && after.includes('SEQUENCE:1') && after.includes('DTSTART:20261217T160000Z') && after.includes('DTEND:20261217T183000Z'));
  check('U11.7c the file never contains the meeting link', !after.includes('teams.microsoft.com'));
  check('U11.7d the enrolment email attaches the course calendar', readFileSync('src/hubs/training/lib/liveCourse/enrolment.ts', 'utf8').includes('attachments: [ics]'));
  check('U11.7e enrolled students get "Add to calendar" on the course page', readFileSync('app/training/live-course/[code]/LiveCourseClient.tsx', 'utf8').includes('/calendar') && readFileSync('app/api/training/live-course/[code]/calendar/route.ts', 'utf8').includes('isEnrolled('));

  // ── Public page content ──
  const card = readFileSync('src/hubs/training/components/sessions/CourseSessionCard.tsx', 'utf8');
  check('U11.8a the public page shows each session\'s overview, with the rest behind "See what you will learn"', card.includes('data-testid="session-overview"') && card.includes('See what you will learn') && card.includes('expanded ? details : ('));
  check('U11.8b a rescheduled session shows "Rescheduled" with its previous date', card.includes('Rescheduled · was {formatSessionTime(s.rescheduled_from)}'));
  check('U11.8c each session card has its time zone table', card.includes('<TimeZoneTable iso={s.scheduled_datetime}'));
  check('U11.8d a published course session cannot be deleted (reschedule instead)', readFileSync('app/api/admin/live-sessions/[id]/route.ts', 'utf8').includes('A published course session cannot be deleted'));

  if (hasCreds()) {
    const sb = await db();
    const { data: live, error } = await sb.from('live_sessions').select('id, course_session_no, scheduled_datetime, content_overview, content_learn, content_outcome, content_claude, announcement_sent').eq('course_code', 'REFM').order('course_session_no');
    if (error) { console.log(`        (live REFM sessions not readable yet: ${error.message})`); return; }
    if ((live ?? []).length === 0) { console.log('        (REFM sessions not seeded yet)'); return; }
    check('U11.9a live: 8 REFM sessions, numbered 1 to 8', live!.length === 8 && live!.every((s, i) => s.course_session_no === i + 1));
    check('U11.9b live: correct UTC times (unless moved by a reschedule)', live!.every((s, i) => new Date(s.scheduled_datetime as string).getUTCHours() === 16 && (s.scheduled_datetime as string).startsWith(wantDates[i]) ));
    check('U11.9c live: all four content fields filled', live!.every((s) => s.content_overview && (s.content_learn as string[]).length >= 6 && s.content_outcome && s.content_claude));
    const ids = live!.map((s) => s.id as string);
    const { data: camps } = await sb.from('newsletter_campaigns').select('id').in('source_id', ids);
    check('U11.9d live: seeding sent no newsletter and no announcement', (camps ?? []).length === 0 && live!.every((s) => !s.announcement_sent));
  }
}

async function unit12(): Promise<void> {
  console.log('\n=== Landing page: sections, instructor, countdown, testimonials ===\n');
  const PS = await import('../src/hubs/training/lib/liveCourse/pageSections');
  const CI = await import('../src/hubs/training/lib/liveCourse/courseInstructors');
  const CT = await import('../src/hubs/training/lib/liveCourse/courseTestimonials');
  const RP = await import('../src/hubs/training/lib/liveCourse/seeds/refmPage');

  // ── Instructor: no raw HTML ──
  const bio = CI.safeBio('<p>Twelve years in <strong>corporate finance</strong>.</p><script>alert(1)</script><p onclick="x()">More</p>');
  check('U12.1a an HTML bio is sanitised: formatting kept, script and handlers removed', !!bio && bio.includes('<strong>corporate finance</strong>') && !/script|onclick/i.test(bio));
  check('U12.1b a plain-text bio is unchanged', CI.safeBio('Plain words.') === 'Plain words.');
  const rows = CI.orderInstructors(['a', 'b'], [
    { id: 'a', name: 'Ahmad Din', title: 'x', is_default: true, profile_url: '/about/ahmad-din', bio: '<p>Bio</p>', active: true },
    { id: 'b', name: 'Guest', title: 'y', is_default: false, bio: '<p>Guest <em>bio</em></p>', active: true },
  ]);
  check('U12.1c the founder is flagged (shown with the founder profile block)', rows[0].isFounder && !rows[1].isFounder);
  const client = readFileSync('app/training/live-course/[code]/LiveCourseClient.tsx', 'utf8');
  check('U12.1d an instructor card renders the sanitised bio as formatted text, never as raw tags in text', client.includes('dangerouslySetInnerHTML={{ __html: i.bio }}') && !client.includes("whiteSpace: 'pre-wrap' }}>{i.bio}</p>}"));
  const block = readFileSync('src/hubs/main/components/landing/FounderProfileBlock.tsx', 'utf8');
  check('U12.1e the founder block sanitises every HTML field before rendering', (block.match(/safeProfileHtml\(/g) ?? []).length >= 4 && block.includes('sanitizeArticleHtml'));
  const home = readFileSync('app/(portal)/page.tsx', 'utf8');
  const page = readFileSync('app/training/live-course/[code]/LiveCoursePage.tsx', 'utf8');
  check('U12.1f ONE founder record: the home page block and the course page card read the same CMS record through one resolver', home.includes('<FounderProfileBlock') && !home.includes('<FounderExpand') && page.includes('<FounderShortCard') && page.includes("section_type === 'team'") && readFileSync('src/hubs/main/components/landing/FounderShortCard.tsx', 'utf8').includes('founderProfile(content)')); // the course page shows the SHORT card since 2026-11-08, same record

  // ── Sections switch off ──
  const full = PS.resolvePage(RP.REFM_PAGE);
  const has = { testimonials: 2, sessions: 8, instructors: 1 };
  const fullTesti = { ...full, sections: { ...full.sections, testimonials: { ...full.sections.testimonials, ids: ['manual:x'] } } };
  check('U12.2a REFM: every body section is visible when on', PS.visibleSections(fullTesti, has).length === PS.BODY_SECTIONS.length, PS.visibleSections(fullTesti, has).join(','));
  let allOff = true;
  for (const k of PS.BODY_SECTIONS) {
    const off = { ...fullTesti, sections: { ...fullTesti.sections, [k]: { ...(fullTesti.sections[k] as object), enabled: false } } } as typeof full;
    if (PS.visibleSections(off, has).includes(k)) allOff = false;
  }
  check('U12.2b each body section switched off disappears from the page', allOff);
  const landing = readFileSync('app/training/live-course/[code]/CourseLanding.tsx', 'utf8');
  check('U12.2c the hero and the side card / mobile bar each switch off', landing.includes('{S.hero.enabled && (') && landing.includes('const sideCard = S.sideCard.enabled && (') && landing.includes('{S.sideCard.enabled && (\n        <div className="lc-mobile-bar"'));
  check('U12.2d testimonials hide when none are picked', !PS.visibleSections(full, has).includes('testimonials'));
  check('U12.2e no "What you will build" section exists', !Object.values(PS.SECTION_LABELS).some((l) => /what you will build/i.test(l)));

  // ── FAQ ──
  const saved = PS.pageFromBody({ sections: { faq: { enabled: true, heading: 'FAQ', items: [{ q: 'B?', a: 'b' }, { q: 'A?', a: 'a' }, { q: '', a: 'dropped' }] } }, order: ['faq', 'curriculum'] });
  check('U12.3a FAQ items save in order; an empty question is dropped', saved.ok && saved.page.sections.faq.items.map((f) => f.q).join('|') === 'B?|A?');
  check('U12.3b a reordered page keeps its order, with every other section still present', saved.page.order[0] === 'faq' && saved.page.order[1] === 'curriculum' && saved.page.order.length === PS.BODY_SECTIONS.length);
  check('U12.3c REFM has the 11 FAQ items from the brief', RP.REFM_PAGE.sections.faq.items.length === 11 && RP.REFM_PAGE.sections.faq.items[0].q === 'Is the course really free?');
  check('U12.3d the FAQ renders as an accordion', landing.includes('data-testid="landing-faq-item"') && landing.includes('<details'));
  const adminTab = readFileSync('app/admin/training-hub/live-training/[code]/CoursePageSectionsTab.tsx', 'utf8');
  check('U12.3e admin can add, edit, reorder and delete FAQ items, and save the page', adminTab.includes('+ Add question') && adminTab.includes('Delete') && adminTab.includes('move(items, i, -1)') && adminTab.includes('pageSections: p'));
  check('U12.3f the admin save validates through the same merge the page renders', readFileSync('src/hubs/training/lib/liveCourse/courseAdmin.ts', 'utf8').includes('pageFromBody(body.pageSections)'));

  // ── Countdown ──
  const now = new Date('2026-11-18T12:00:00Z').getTime();
  const sessions = [{ id: 's1', scheduled_datetime: '2026-12-01T16:00:00Z' }, { id: 's2', scheduled_datetime: '2026-12-08T16:00:00Z' }];
  check('U12.4a the countdown reads the next session: 13 days 4 hours before 1 Dec 7 PM KSA', PS.countdownText(PS.nextSession(sessions, now)?.scheduled_datetime, now) === '13 days 4 hours');
  const moved = [{ id: 's1', scheduled_datetime: '2026-12-03T16:00:00Z' }, sessions[1]];
  check('U12.4b after a reschedule it counts to the new time', PS.countdownText(PS.nextSession(moved, now)?.scheduled_datetime, now) === '15 days 4 hours');
  check('U12.4c once a session starts, it counts to the next one', PS.nextSession(sessions, new Date('2026-12-01T17:00:00Z').getTime())?.id === 's2');
  check('U12.4d after the last session it hides', PS.nextSession(sessions, new Date('2027-02-01').getTime()) === null && PS.countdownText(null) === null);

  // ── Enrolled count ──
  check('U12.5a the enrolled count hides below the threshold (24 of 25)', !PS.showEnrolledCount(24, 25));
  check('U12.5b and shows at it (25 of 25)', PS.showEnrolledCount(25, 25));
  check('U12.5c the threshold defaults to 25', PS.DEFAULT_PAGE.sections.sideCard.enrolledThreshold === 25 && RP.REFM_PAGE.sections.sideCard.enrolledThreshold === 25);

  // ── Curriculum image fallback ──
  check('U12.6a a session with no image shows the course card image (session page)', readFileSync('app/training/[courseId]/sessions/[id]/CourseSessionClient.tsx', 'utf8').includes('s.banner_url || course.cardImageUrl'));
  check('U12.6b curriculum cards show the image, number, title, KSA time, overview and the expandable details', readFileSync('src/hubs/training/components/sessions/CourseSessionCard.tsx', 'utf8').includes('data-testid="session-card-image"'));

  // ── Content and testimonials ──
  const S = RP.REFM_PAGE.sections;
  check('U12.7a REFM content: 6 skills, 4 audiences, 3 certification steps, 4 tools', S.skills.items.length === 6 && S.whoFor.items.length === 4 && S.certification.steps.length === 3 && S.tools.items.length === 4);
  check('U12.7b hero facts from the brief', S.hero.facts.join('|') === '8 live sessions|Tuesdays 7:00 PM KSA|Starts 1 Dec 2026|Free|Certificate');
  check('U12.7c auto facts follow the live schedule when none are set', PS.autoFacts(sessions)[0] === '2 live sessions' && PS.autoFacts(sessions).includes('Free'));
  check('U12.7d a testimonial pick is "source:id" from the existing system', !!CT.parsePick('manual:11111111-1111-1111-1111-111111111111') && !CT.parsePick('11111111'));
  check('U12.7e the course page reuses the existing testimonials carousel', page.includes('<TestimonialsCarousel'));
  // Re-aimed 2026-11-10: the template lookup moved into cachedReads (cached per course).
  check('U12.7f sample certificate and badge come from the uploaded templates and hide until they exist', page.includes('courseTemplateSamplesCached(course.courseCode)') && readFileSync('src/hubs/training/lib/liveCourse/cachedReads.ts', 'utf8').includes('templates/${name}') && landing.includes('(d.samples.certificateUrl || d.samples.badgeUrl)'));
  check('U12.7g the mobile layout stacks the side card and adds a fixed Register bar, with no horizontal scroll', landing.includes('@media (max-width: 900px)') && landing.includes("overflowX: 'hidden'"));
}

async function unit13(): Promise<void> {
  console.log('\n=== Teams meeting options and diagnostics ===\n');
  const T = readFileSync('src/integrations/teams/teamsMeetings.ts', 'utf8');
  const T2 = await import('../src/integrations/teams/teamsMeetings');
  check('U13.1 lobby bypass is everyone, dial-in callers included', T2.MEETING_SETTINGS.lobbyBypassSettings.scope === 'everyone' && T2.MEETING_SETTINGS.lobbyBypassSettings.isDialInBypassEnabled === true);
  check('U13.2 every created meeting gets the settings', T.includes('settings: await applyMeetingSettings(created.joinUrl)'));
  check('U13.3 a moved meeting gets them again', T.includes('settings: await applyMeetingSettings(updated.joinUrl)'));
  check('U13.4 applying the settings never throws (cannot block create or move)', /export async function applyMeetingSettings[\s\S]*?catch \(e\)[\s\S]*?return \{ ok: false/.test(T));
  const D = readFileSync('app/api/admin/teams/diagnostics/route.ts', 'utf8');
  check('U13.5 diagnostics is admin only and never returns the join link', D.includes("{ error: 'Forbidden' }, { status: 403 }") && D.includes('hasTeamsLink: !!s.live_url') && !/live_url:\s*s\.live_url/.test(D));
  check('U13.6 diagnostics names a missing application access policy', D.includes('No application access policy found'));

  console.log('\n=== Live course URLs: /training/<CODE> and /training/<CODE>/sessions/<id> ===\n');
  const P = await import('../src/hubs/training/lib/liveCourse/paths');
  check('U13.7 a course is at /training/<CODE>', P.coursePagePath('REFM') === '/training/REFM');
  check('U13.8 a course session is under its course', P.courseSessionPath('REFM', 'abc') === '/training/REFM/sessions/abc');
  const cid = readFileSync('app/training/[courseId]/page.tsx', 'utf8');
  check('U13.9 /training/<CODE> renders the live course page for a live course code, else the exam course page', cid.includes('if (live) return <LiveCoursePage') && cid.includes('getCourseWithLessons(courseId)') && cid.includes("export const dynamic = 'force-dynamic'"));
  const old = readFileSync('app/training/live-course/[code]/page.tsx', 'utf8');
  check('U13.10 the old course URL redirects, keeping its query (enrol, preview)', old.includes('redirect(`${coursePagePath(') && old.includes('URLSearchParams'));
  const oldSess = readFileSync('app/training/live-sessions/[id]/layout.tsx', 'utf8');
  check('U13.11 a course session\'s old URL redirects under its course; a single session stays', oldSess.includes('if (code) redirect(courseSessionPath(code, id))'));
  const newSess = readFileSync('app/training/[courseId]/sessions/[id]/layout.tsx', 'utf8');
  check('U13.12 only a session of THAT course opens under it (single session 404, other course redirected)', newSess.includes('if (!code) notFound()') && newSess.includes('redirect(courseSessionPath(code, id))'));
  let stray = '';
  for (const f of ['src/hubs/training/lib/liveCourse/enrolment.ts', 'src/hubs/training/lib/liveCourse/calendar.ts', 'app/training-sessions/PublicCourseOffers.tsx', 'src/hubs/training/components/dashboard/LiveCourseCards.tsx', 'app/sitemap.ts', 'app/training/live-course/[code]/LiveCourseClient.tsx', 'app/training/live-course/[code]/LiveCoursePage.tsx']) {
    // Page URLs only; /api/training/live-course/ is the API and stays.
    if (/(?<!api)\/training\/live-course\//.test(readFileSync(f, 'utf8'))) stray += f + ' ';
  }
  check('U13.13 no course link, email or calendar builds the old /training/live-course/ URL', stray === '', stray);
  check('U13.14 the hero line carries the short title: "Live course · REFM · Microsoft Teams"', P.courseEyebrow('REFM') === 'Live course · REFM · Microsoft Teams' && P.courseEyebrow('') === 'Live course · Microsoft Teams');
  const offers = readFileSync('app/training-sessions/PublicCourseOffers.tsx', 'utf8');
  const landing2 = readFileSync('app/training/live-course/[code]/CourseLanding.tsx', 'utf8');
  check('U13.15 the course page hero and the Training Sessions card use the same line, and neither hard-codes it', landing2.includes('courseEyebrow(d.shortTitle)') && offers.includes('courseEyebrow(c.shortTitle)') && !landing2.includes('>Live course · Microsoft Teams<') && !offers.includes('>Live course · Microsoft Teams<'));
  const tpl = readFileSync('app/admin/certificate-designer/TemplatesTab.tsx', 'utf8');
  check('U13.16 the templates note says exam-off courses certify on model approval, named from live data', tpl.includes('Courses with exams off') && tpl.includes("approves the student's submitted model") && tpl.includes('c.examsEnabled === false'));
}

async function unit14(): Promise<void> {
  console.log('\n=== REFM sessions live: seed, Training Sessions page, 16:9 images, course tab ===\n');
  const RS = await import('../src/hubs/training/lib/liveCourse/seeds/refmSessions');
  const PL = await import('../src/hubs/training/lib/liveCourse/publicListing');

  // ── The seed, measured on the live database ──
  if (!hasCreds()) { check('U14.1 credentials loaded for the seeded-session probe', false, 'run through npm run verify:suite'); }
  else {
    const sb = await db();
    const { data } = await sb.from('live_sessions')
      .select('id, course_session_no, title, scheduled_datetime, duration_minutes, is_published, live_url, announcement_sent')
      .eq('course_code', RS.REFM_COURSE_CODE).order('course_session_no');
    const rows = (data ?? []) as { id: string; course_session_no: number; title: string; scheduled_datetime: string; duration_minutes: number; is_published: boolean; live_url: string | null; announcement_sent: boolean }[];
    check('U14.1a exactly 8 REFM sessions, numbered 1 to 8', rows.length === 8 && rows.map((r) => r.course_session_no).join(',') === '1,2,3,4,5,6,7,8', `${rows.length} rows`);
    const timesOk = RS.REFM_SESSIONS.every((s) => {
      const r = rows.find((x) => x.course_session_no === s.no);
      return !!r && new Date(r.scheduled_datetime).getTime() === new Date(s.start).getTime() && r.title === s.title && r.duration_minutes === RS.REFM_DURATION_MINUTES;
    });
    check('U14.1b each at its UTC start (16:00 UTC = 7:00 PM KSA), title and 150 minutes', timesOk);
    check('U14.1c all 8 published', rows.every((r) => r.is_published));
    const noLink = rows.filter((r) => !r.live_url).map((r) => r.course_session_no);
    check('U14.1d every session has a Teams link (Live Training > REFM > Sessions > "Create missing Teams meetings")', noLink.length === 0, noLink.length ? `no link yet: sessions ${noLink.join(', ')}` : '');
    check('U14.1e no session was announced (the seed sends nothing)', rows.every((r) => r.announcement_sent === false));
  }
  const seed = readFileSync('scripts/seed-refm-sessions.ts', 'utf8');
  check('U14.2a the seed imports no email, newsletter or announcement code', !/from ['"][^'"]*(email|newsletter|autoNotify|announce)[^'"]*['"]/i.test(seed) && !/sendEmail|sendNewsletter|notifySession/.test(seed));
  check('U14.2b a mistyped flag runs nothing (it refused --dry, which once ran for real)', seed.includes('Unknown flag(s)') && seed.includes('process.exit(1)'));

  // ── Listing on the Training Sessions page ──
  const at = new Date('2026-11-20T12:00:00Z').getTime();
  const course = { session_type: 'upcoming', scheduled_datetime: '2026-12-01T16:00:00Z', duration_minutes: 150, course_code: 'REFM', youtube_url: null };
  check('U14.3a an upcoming REFM session is in Upcoming', PL.listingOf(course, at) === 'upcoming');
  const after = new Date('2026-12-02T12:00:00Z').getTime();
  check('U14.3b once it ends with no recording it is not listed', PL.listingOf(course, after) === 'hidden');
  check('U14.3c with its recording added it moves to Recorded', PL.listingOf({ ...course, youtube_url: 'https://youtu.be/x' }, after) === 'recorded');
  check('U14.3d a single session is listed as before (ended = Recorded)', PL.listingOf({ ...course, course_code: null }, after) === 'recorded');
  check('U14.3e the filter label is "REFM Live Series"', PL.seriesLabel('REFM', 'REFM') === 'REFM Live Series');
  const sc = readFileSync('app/training-sessions/SessionsClient.tsx', 'utf8');
  check('U14.3f the page lists through the one rule, sorts Upcoming by date and offers the series filter', sc.includes('listingOf(s)') && sc.includes("filtered.filter(s => listingOf(s) === 'upcoming')") && sc.includes('value={seriesValue(code)}'));
  check('U14.3g a course session gets the course card; a single session keeps its card', sc.includes('if (!s.course_code) return <SessionCard') && sc.includes('<CourseSessionListingCard'));

  // ── Card buttons go to course enrolment ──
  const base = { courseCode: 'REFM', sessionId: 'S1', enrolmentOpen: true };
  const out = PL.courseCardAction({ ...base, enrolled: false, signedIn: false });
  const inn = PL.courseCardAction({ ...base, enrolled: false, signedIn: true });
  const enr = PL.courseCardAction({ ...base, enrolled: true, signedIn: true });
  // Re-aimed 2026-11-10: one wording, "Enrol in course" (account + enrolment for a visitor).
  check('U14.4a signed out: "Enrol in course" to course registration', out.label === 'Enrol in course' && out.href === '/register?course=REFM');
  check('U14.4b signed in: "Enrol in course" to the course page, which enrols on arrival', inn.label === 'Enrol in course' && inn.href === '/training/REFM?enrol=1');
  check('U14.4c enrolled: "View session" under the course', enr.label === 'View session' && enr.href === '/training/REFM/sessions/S1');
  check('U14.4d no branch goes to single-session registration', [out, inn, enr].every((a) => !a.href.includes('/training-sessions/') && !a.href.includes('/live-sessions/')));
  const card = readFileSync('src/hubs/training/components/sessions/CourseSessionListingCard.tsx', 'utf8');
  // Re-aimed 2026-11-10: course times use the one KSA-first label (CourseTime, unit 20).
  check('U14.4e the card shows "Session X of N", KSA time, Rescheduled and "Part of ... Live Series"', card.includes('Session {s.course_session_no} of {total}') && card.includes('<CourseTime iso={s.scheduled_datetime} />') && card.includes('Rescheduled') && card.includes('Part of {seriesLabel('));
  const detail = readFileSync('app/training-sessions/[id]/page.tsx', 'utf8');
  check('U14.4f a course session\'s public detail page sends visitors to the course', detail.includes('if (session?.course_code) redirect(coursePagePath(session.course_code))'));

  // ── 16:9, whole, no text over the image ──
  const imgOk = (src: string, testid: string) => {
    const i = src.indexOf(`data-testid="${testid}"`);
    const box = src.lastIndexOf("aspectRatio: '16 / 9'", i);
    return i > 0 && box > 0 && i - box < 300 && src.slice(i, i + 300).includes("objectFit: 'contain'");
  };
  const csc = readFileSync('src/hubs/training/components/sessions/CourseSessionCard.tsx', 'utf8');
  check('U14.5a curriculum card image: 16:9 box, whole image (contain)', imgOk(csc, 'session-card-image'));
  check('U14.5b Training Sessions card image: 16:9 box, whole image (contain)', imgOk(card, 'course-session-listing-image'));
  const player = readFileSync('src/hubs/training/components/player/CoursePlayerLayout.tsx', 'utf8');
  const pi = player.indexOf('data-testid="session-page-image"');
  check('U14.5c session page image: full width, natural height, no crop', pi > 0 && player.slice(pi, pi + 200).includes("height: 'auto'") && !player.slice(pi, pi + 200).includes('objectFit'));
  const offers = readFileSync('app/training-sessions/PublicCourseOffers.tsx', 'utf8');
  check('U14.5d the REFM course card image: 16:9 box, whole image', offers.includes("aspectRatio: '16 / 9'") && /cardImageUrl}[^>]*objectFit: 'contain'/.test(offers));
  check('U14.5e the title and details are text below the image, never over it', csc.indexOf('session-card-image') < csc.indexOf('{s.title}') && card.indexOf('course-session-listing-image') < card.indexOf('{s.title}') && !/position: 'absolute'/.test(card));
  const mgr = readFileSync('app/admin/training-hub/live-training/LiveSessionsManager.tsx', 'utf8');
  check('U14.5f the admin image slot asks for 1200 x 675 (16:9)', mgr.includes('Recommended 1200 x 675 px (16:9)') && !mgr.includes('1600 x 600'));

  // ── Course Sessions tab in admin ──
  check('U14.6a a course tab hides the playlist bar, "+ New Playlist" and the playlist filter', mgr.includes('{!courseCode && (\n        <div data-testid="admin-playlist-bar"') && mgr.includes('{!courseCode && (\n              <button style={btnSecondary} onClick={() => { setShowNewPlaylist') && mgr.includes('{/* Playlist filter (single sessions only) */}\n          {!courseCode && ('));
  check('U14.6b a course tab orders its sessions by session number', mgr.includes('filtered.sort((a, b) => noOf(a) - noOf(b))'));

  // ── The course's own playlist ──
  const ids = PL.coursePlaylistIds([{ course_code: 'REFM', playlist_id: 'P1' }, { course_code: null, playlist_id: 'P2' }, { course_code: 'REFM', playlist_id: null }]);
  check('U14.7a a course playlist is one holding course sessions; a single-session playlist is not', ids.has('P1') && !ids.has('P2') && ids.size === 1);
  if (hasCreds()) {
    const sb = await db();
    const { data: pls } = await sb.from('live_playlists').select('id').eq('name', 'REFM Live Series');
    const { data: rs } = await sb.from('live_sessions').select('playlist_id').eq('course_code', 'REFM');
    check('U14.7b exactly one "REFM Live Series" playlist, holding every REFM session', (pls ?? []).length === 1 && (rs ?? []).length === 8 && (rs ?? []).every((r) => r.playlist_id === pls?.[0]?.id), `${(pls ?? []).length} playlist(s)`);
    const CP = await import('../src/hubs/training/lib/liveCourse/coursePlaylist');
    const again = await CP.syncCoursePlaylist(sb, 'REFM');
    check('U14.7c syncing again changes nothing (no second playlist, no session moved)', !!again && !again.created && again.assigned === 0 && again.playlistId === pls?.[0]?.id);
  }
  const routes = readFileSync('app/api/admin/live-sessions/route.ts', 'utf8') + readFileSync('app/api/admin/live-sessions/[id]/route.ts', 'utf8');
  check('U14.7d creating or editing a course session keeps it in its course playlist, without blocking the save', (routes.match(/syncCoursePlaylist\(sb, [a-zA-Z]+\)\.catch\(/g) ?? []).length === 2);
  check('U14.7e the single sessions tab counts and offers only single sessions and their playlists', mgr.includes('All ({singleSessions.length})') && mgr.includes('singlePlaylists.map(pl => {') && mgr.includes('{singlePlaylists.map(pl => <option'));
  check('U14.7f the public page offers the course once (series filter), not again as a playlist', sc.includes('sessions.filter(s => !s.course_code).map(s => s.playlist?.name)'));
  const sessPage = readFileSync('app/training/live-sessions/[id]/page.tsx', 'utf8');
  check('U14.7g the session page sidebar walks the playlist and links course sessions under their course', sessPage.includes('s.course_code ? courseSessionPath(s.course_code, s.id)'));
}

async function unit15(): Promise<void> {
  console.log('\n=== Course layout: sidebar, overview table, session page, short instructor ===\n');
  const CN = await import('../src/hubs/training/lib/liveCourse/courseNav');
  const FSC = readFileSync('src/hubs/main/components/landing/FounderShortCard.tsx', 'utf8');
  const shell = readFileSync('src/hubs/training/components/sessions/CourseShell.tsx', 'utf8');
  const overview = readFileSync('app/training/live-course/[code]/LiveCourseClient.tsx', 'utf8');
  const sessPage = readFileSync('app/training/[courseId]/sessions/[id]/CourseSessionClient.tsx', 'utf8');

  const S = (id: string, no: number | null, when: string, extra: Partial<{ youtube_url: string; rescheduled_from: string }> = {}) =>
    ({ id, title: `T${id}`, course_session_no: no, scheduled_datetime: when, duration_minutes: 150, session_type: 'upcoming', ...extra });
  const list = [S('c', 3, '2026-12-15T16:00:00Z'), S('a', 1, '2026-12-01T16:00:00Z'), S('b', 2, '2026-12-08T16:00:00Z')];

  // ── Sidebar ──
  check('U15.1a the sidebar lists the sessions in course order (by number)', CN.orderSessions(list).map((s) => s.id).join('') === 'abc');
  check('U15.1b it starts with "Course overview" and marks the current page', shell.includes('Course overview') && shell.includes("aria-current={isHere ? 'page' : undefined}") && shell.includes("data-current={isHere ? 'true' : undefined}") && shell.includes('You are here'));
  check('U15.1c a completed session shows a tick (attendance or recording rule met)', shell.includes('data-testid="course-sidebar-done"') && overview.includes('filter((e) => e.met)') && sessPage.includes('filter((x) => x.met)'));
  check('U15.1d sticky, with Hide / Show, and a "Sessions" drawer on phones', shell.includes('position: sticky') && shell.includes('✕ Hide') && shell.includes('☰ Show sessions') && shell.includes('☰ Sessions') && shell.includes('course-sidebar-drawer') && shell.includes('@media (max-width: 900px)'));
  check('U15.1e the overview and the session page both use the one shell', overview.includes('<CourseShell') && overview.includes('current="overview"') && sessPage.includes('<CourseShell') && sessPage.includes('current={sessionId}'));

  // ── Status labels ──
  const before = new Date('2026-11-20T12:00:00Z').getTime();
  const during = new Date('2026-12-01T16:30:00Z').getTime();
  const after = new Date('2026-12-02T12:00:00Z').getTime();
  check('U15.2a upcoming', CN.navStatus(list[1], before) === 'upcoming' && CN.STATUS_LABEL.upcoming === 'Upcoming');
  check('U15.2b rescheduled', CN.navStatus(S('a', 1, '2026-12-01T16:00:00Z', { rescheduled_from: '2026-11-30T16:00:00Z' }), before) === 'rescheduled');
  check('U15.2c live now inside the session', CN.navStatus(list[1], during) === 'live' && CN.STATUS_LABEL.live === 'Live now');
  check('U15.2d recorded once a recording exists, else "Recording coming soon"', CN.navStatus(S('a', 1, '2026-12-01T16:00:00Z', { youtube_url: 'https://youtu.be/x' }), after) === 'recorded' && CN.navStatus(list[1], after) === 'ended' && CN.STATUS_LABEL.ended === 'Recording coming soon');

  // ── Overview ──
  check('U15.3a the overview no longer renders the large curriculum cards or their images', !overview.includes('<CourseSessionCard') && !overview.includes('imageUrl={'));
  check('U15.3b the compact sessions table links each row to its session page', overview.includes('<CourseSessionsTable') && shell.includes('data-testid="course-sessions-row"') && /href=\{courseSessionPath\(courseCode, s\.id\)\} data-testid="course-sessions-row"/.test(shell));
  check('U15.3c the table is the switchable "Sessions table" section', readFileSync('src/hubs/training/lib/liveCourse/pageSections.ts', 'utf8').includes("curriculum: 'Sessions table'"));
  check('U15.3d "Who it is for" text shows only when its cards are off; Prerequisites is one line', overview.includes("...(whoForCardsOn ? [] : [{ title: 'Who it is for'") && overview.includes('data-testid="live-course-prereq"') && !overview.includes("{ title: 'Prerequisites'"));

  // ── Session page main button ──
  const A = (o: Partial<Parameters<typeof CN.sessionMainAction>[0]>) => CN.sessionMainAction({ courseCode: 'REFM', sessionId: 'a', status: 'upcoming', enrolled: false, signedIn: false, canRegister: true, ...o });
  check('U15.4a not enrolled: Register free (signed out) or Enrol (signed in)', A({}).kind === 'register' && A({}).href === '/register?course=REFM' && A({ signedIn: true }).kind === 'enrol' && A({ signedIn: true }).href === '/training/REFM?enrol=1');
  check('U15.4b enrolled, before or inside the join window: Join live', A({ enrolled: true, signedIn: true }).kind === 'join' && A({ enrolled: true, signedIn: true, status: 'live' }).kind === 'join');
  check('U15.4c enrolled, after: Watch recording (the tracked player) or Recording coming soon', A({ enrolled: true, signedIn: true, status: 'recorded' }).href === '/training/REFM/sessions/a/watch' && A({ enrolled: true, signedIn: true, status: 'ended' }).kind === 'recording-soon');
  check('U15.4d enrolment closed is stated, never a dead button', A({ canRegister: false }).kind === 'closed' && A({ canRegister: false }).href === null);
  check('U15.4e the tracked recording player stays, at ./watch', readFileSync('app/training/[courseId]/sessions/[id]/watch/page.tsx', 'utf8').includes("export { default } from '../../../../live-sessions/[id]/page'"));
  // Re-aimed 2026-11-10: the content blocks moved into the shared SessionContentSections (unit 17).
  check('U15.4f the session page: 16:9 whole image (course card fallback), content blocks, collapsed time zones, materials rule, certificate card', sessPage.includes('s.banner_url || course.cardImageUrl') && sessPage.includes("aspectRatio: '16 / 9'") && sessPage.includes("objectFit: 'contain'") && sessPage.includes('<SessionContentSections sections={sections} />') && sessPage.includes('collapsible') && sessPage.includes('Materials will be available after the session.') && sessPage.includes('vs?.materialsReleased') && sessPage.includes('course-session-certificate'));

  // ── Previous / next ──
  const pn = CN.prevNext(list, 'b');
  check('U15.5a Previous and Next are the neighbours in course order', pn.prev?.id === 'a' && pn.next?.id === 'c');
  check('U15.5b the first has no previous and the last no next', CN.prevNext(list, 'a').prev === null && CN.prevNext(list, 'c').next === null);
  check('U15.5c the page links them to their session pages', sessPage.includes('courseSessionPath(course.courseCode, prev.id)') && sessPage.includes('courseSessionPath(course.courseCode, next.id)'));

  // ── Short instructor ──
  const FS = await import('../src/hubs/main/components/landing/FounderShortCard');
  check('U15.6a an empty short bio falls back to the first two sentences of the full bio', FS.firstSentences('<p>One. Two! Three?</p>') === 'One. Two!');
  check('U15.6b the card shows the course short bio when set, with "Read full profile" to the profile page', FSC.includes("(shortBio ?? '').trim() || firstSentences(p.fBio, 2)") && FSC.includes('data-testid="founder-full-profile" href={p.fCtaUrl}') && readFileSync('src/hubs/main/components/landing/FounderProfileBlock.tsx', 'utf8').includes("'/about/ahmad-din'") && existsSync('app/about/ahmad-din'));
  check('U15.6c one founder record: the full block and the short card read the same resolver', FSC.includes('founderProfile(content)') && readFileSync('src/hubs/main/components/landing/FounderProfileBlock.tsx', 'utf8').includes('= founderProfile(content);'));
  check('U15.6d up to three highlights, and the short bio is an admin setting', FSC.includes('.slice(0, 3)') && readFileSync('app/admin/training-hub/live-training/[code]/CoursePageSectionsTab.tsx', 'utf8').includes('data-testid="instructor-short-bio"'));
}

async function unit16(): Promise<void> {
  console.log('\n=== My Model tab and the certificate pending list cover live courses ===\n');
  const panel = readFileSync('src/hubs/training/components/sessions/LiveCourseSubmission.tsx', 'utf8');
  const client = readFileSync('app/training/live-course/[code]/LiveCourseClient.tsx', 'utf8');
  const view = readFileSync('src/hubs/training/components/dashboard/MyModelView.tsx', 'utf8');
  const history = readFileSync('app/api/training/model-submission/history/route.ts', 'utf8');
  const submit = readFileSync('app/api/training/model-submission/route.ts', 'utf8');

  // ONE submission panel, on the course page and in My Model.
  check('U16.1a the submission panel is one shared component', panel.includes('export function LiveCourseSubmission') && !client.includes('function LiveCourseSubmission') && client.includes("from '@/src/hubs/training/components/sessions/LiveCourseSubmission'"));
  check('U16.1b My Model renders that same panel for each live course', view.includes('<LiveCourseSubmission courseCode={c.code}') && view.includes('liveCourses.map'));
  check('U16.1c the panel reads the status route and posts to the submission route', panel.includes('/api/training/model-submission?courseCode=') && panel.includes("fetch('/api/training/model-submission', { method: 'POST'"));
  check('U16.1d the panel shows the eligibility gate, pending review and the attempts lock', ['submission-gate-locked', 'submission-pending', 'submission-attempts-locked', 'submission-upload'].every((t) => panel.includes(t)));
  // The server still enforces every rule, whichever page posts.
  check('U16.1e the server refuses an ineligible, a pending, an approved and an exhausted submission', submit.includes("error: 'not_eligible'") && submit.includes("error: 'pending_review_in_flight'") && submit.includes("error: 'already_approved'") && submit.includes("error: 'attempts_exhausted'"));
  check('U16.1f the history route lists live course attempts and the live courses the student is enrolled in', history.includes('listLiveCourses(') && history.includes(".from('training_enrollments')") && history.includes(".eq('registration_id', session.registrationId)") && history.includes('liveCourses'));
  check('U16.1g the history route still reads only the signed student\'s rows and no storage path', /\.ilike\('email', session\.email/.test(history) && !/storage_path:/.test(history));
  check('U16.1h an attempt an admin reset cleared is listed and marked as reset', history.includes('superseded: !!r.superseded_at') && view.includes('a.superseded &&'));

  // The pending list.
  const CE = await import('../src/hubs/training/lib/certificates/certificateEligibility');
  const issued = new Set(['done@x.com|REFM']);
  const cands = CE.liveCertificateCandidates([
    { email: 'A@x.com', course_code: 'refm', status: 'approved', reviewed_at: '2027-02-01T10:00:00Z', superseded_at: null },
    { email: 'a@x.com', course_code: 'REFM', status: 'approved', reviewed_at: '2027-02-03T10:00:00Z', superseded_at: null },
    { email: 'done@x.com', course_code: 'REFM', status: 'approved', reviewed_at: '2027-02-01T10:00:00Z', superseded_at: null },
    { email: 'reset@x.com', course_code: 'REFM', status: 'approved', reviewed_at: '2027-02-01T10:00:00Z', superseded_at: '2027-02-02T10:00:00Z' },
    { email: 'rej@x.com', course_code: 'REFM', status: 'rejected', reviewed_at: '2027-02-01T10:00:00Z', superseded_at: null },
  ], issued);
  check('U16.2a an approved, uncertified live student is a candidate, once, dated by the latest approval', cands.length === 1 && cands[0].email === 'a@x.com' && cands[0].courseCode === 'REFM' && cands[0].approvedAt === '2027-02-03T10:00:00Z', JSON.stringify(cands));
  check('U16.2b an issued certificate, a reset approval and a rejection are not candidates', !cands.some((c) => ['done@x.com', 'reset@x.com', 'rej@x.com'].includes(c.email)));
  const elig = readFileSync('src/hubs/training/lib/certificates/certificateEligibility.ts', 'utf8');
  check('U16.2c the sweep adds live candidates after the exam view and runs the engine\'s own eligibility on each', elig.includes('liveCertificateCandidates((approved') && elig.includes('const check = await checkEligibility(c.email, c.courseCode)'));
  check('U16.2d the sweep no longer returns nothing when no exam student is pending (live rows still count)', !elig.includes('if (!raws || raws.length === 0) return [];'));
  check('U16.2e issued certificates are read in pages (PostgREST stops at 1000 rows)', /\.range\(from, from \+ 999\)/.test(elig));
  const pendingRoute = readFileSync('app/api/admin/certificates/pending/route.ts', 'utf8');
  check('U16.2f the pending list names a live course by its title and dates it by the approval', pendingRoute.includes('liveTitles.get(courseCode)') && pendingRoute.includes('e.completedAt ??'));
  const issueRoute = readFileSync('app/api/admin/certificates/issue-pending/route.ts', 'utf8');
  check('U16.2g Issue all and Issue now go through the same engine (live courses included)', issueRoute.includes('findAllEligibleFromSupabase()') && issueRoute.includes('issueCertificateForStudent(e.email, e.course'));

  if (hasCreds()) {
    const all = await CE.findAllEligibleFromSupabase();
    check('U16.3a live: the sweep runs against the live database', Array.isArray(all), `${all.length} rows`);
  }
}

async function unit17(): Promise<void> {
  console.log('\n=== Session page content lists, layout, sidebar, fast navigation, side card ===\n');
  const SC = await import('../src/hubs/training/lib/liveCourse/sessionContent');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');

  // ── The content model: eight lists, one reader, older fields mapped in ──
  check('U17.1a eight sections in the founder\'s order', SC.SECTION_KEYS.join(',') === 'overview,learnConcepts,learnHandsOn,flow,build,claude,before,after');
  const legacy = SC.sessionSections({ content_overview: 'Old  paragraph.', content_learn: ['a', ' - b '], content_outcome: 'Out', content_claude: 'Cl' });
  check('U17.1b a session with only the older fields maps them in (overview paragraph becomes the Overview list)', JSON.stringify(legacy.overview) === '["Old paragraph."]' && JSON.stringify(legacy.learnConcepts) === '["a","b"]' && JSON.stringify(legacy.build) === '["Out"]' && JSON.stringify(legacy.claude) === '["Cl"]' && legacy.flow.length === 0);
  const fresh = SC.sessionSections({ content_sections: { overview: ['- x', '', '2. y'], flow: 'one\n\ntwo', junk: ['z'] }, content_overview: 'ignored' });
  check('U17.1c new lists win as a whole; markers and blank lines dropped; unknown keys ignored', JSON.stringify(fresh.overview) === '["x","y"]' && JSON.stringify(fresh.flow) === '["one","two"]' && !('junk' in fresh) && fresh.learnConcepts.length === 0);
  check('U17.1d an empty object is no content (the older fields still show)', SC.sessionSections({ content_sections: {}, content_overview: 'Kept' }).overview[0] === 'Kept');
  check('U17.1e the editor parses one bullet per line', JSON.stringify(SC.linesToList(' a \n\n- b\n3) c')) === '["a","b","c"]');

  const mdPath = 'docs/REFM_Live_Course_Materials/REFM_Session_Content.md';
  const { REFM_SESSION_CONTENT } = await import('../src/hubs/training/lib/liveCourse/seeds/refmSessionContent');
  const committedFull = [1, 2, 3, 4, 5, 6, 7, 8].every((n) => REFM_SESSION_CONTENT[n] && SC.SECTION_KEYS.every((k) => REFM_SESSION_CONTENT[n][k].length > 0));
  check('U17.2a the committed REFM content has all 8 sessions with every section filled', committedFull);
  if (existsSync(mdPath)) {
    const parsed = SC.parseSessionContentMd(readFileSync(mdPath, 'utf8'));
    check('U17.2b the content file parses to sessions 1 to 8, every section filled', parsed.map((p) => p.no).join(',') === '1,2,3,4,5,6,7,8' && parsed.every((p) => SC.SECTION_KEYS.every((k) => p.sections[k].length > 0)));
    check('U17.2c the committed content matches the file (regenerate with scripts/gen-refm-session-content.ts)', parsed.every((p) => JSON.stringify(p.sections) === JSON.stringify(REFM_SESSION_CONTENT[p.no])));
    const { REFM_SESSIONS } = await import('../src/hubs/training/lib/liveCourse/seeds/refmSessions');
    check('U17.2d the file\'s session titles match the seeded titles', parsed.every((p) => REFM_SESSIONS.find((s) => s.no === p.no)?.title === p.title));
  } else {
    console.log('        (content file not on this machine; committed content checked above)');
  }
  const seed = readFileSync('scripts/seed-refm-sessions.ts', 'utf8');
  check('U17.2e the seed writes the lists and still imports no email or newsletter code', seed.includes('content_sections: REFM_SESSION_CONTENT[s.no]') && !/sendEmail|newsletter|autoNotify|notify\//i.test(seed.replace(/No email or newsletter was sent/g, '').replace(/no newsletter auto-notify/gi, '')));

  if (hasCreds()) {
    const sb = await db();
    const { data: rows } = await sb.from('live_sessions').select('course_session_no, content_sections, announcement_sent').eq('course_code', 'REFM').order('course_session_no');
    const bad = (rows ?? []).filter((r) => SC.SECTION_KEYS.some((k) => SC.normaliseSections(r.content_sections)[k].length === 0)).map((r) => r.course_session_no);
    check('U17.2f live: all 8 REFM sessions have every new section filled', (rows ?? []).length === 8 && bad.length === 0, `missing in sessions ${bad.join(', ')}`);
    check('U17.2g live: writing the content announced nothing', (rows ?? []).every((r) => !r.announcement_sent));
  }

  // ── Lists render with visible markers ──
  const { SessionContentSections } = await import('../src/hubs/training/components/sessions/SessionContentSections');
  const html = renderToStaticMarkup(createElement(SessionContentSections, { sections: REFM_SESSION_CONTENT[1] }));
  const items = (html.match(/data-testid="session-list-item"/g) ?? []).length;
  const markers = (html.match(/data-testid="session-list-marker"/g) ?? []).length;
  const total = SC.SECTION_KEYS.reduce((n, k) => n + REFM_SESSION_CONTENT[1][k].length, 0);
  check('U17.3a every list item renders with a visible marker', items === total && markers === total, `${items} items, ${markers} markers, ${total} expected`);
  check('U17.3b What you will learn uses check markers, in two labelled groups', /data-testid="session-list-learnConcepts" data-marker="check"/.test(html) && /data-testid="session-list-learnHandsOn" data-marker="check"/.test(html) && html.includes('>Concepts<') && html.includes('>Hands-on in Excel<'));
  const flowHtml = html.slice(html.indexOf('session-list-flow'), html.indexOf('course-session-build'));
  check('U17.3c Session flow is numbered 1 to N', /data-testid="session-list-flow" data-marker="number"/.test(html) && REFM_SESSION_CONTENT[1].flow.every((_, i) => flowHtml.includes(`>${i + 1}</span>`)));
  check('U17.3d the other lists use bullet markers', ['overview', 'build', 'claude', 'before', 'after'].every((k) => new RegExp(`data-testid="session-list-${k}" data-marker="bullet"`).test(html)));
  const order = ['course-session-overview', 'course-session-learn', 'course-session-flow', 'course-session-build', 'course-session-claude', 'course-session-before', 'course-session-after'].map((t) => html.indexOf(`data-testid="${t}"`));
  check('U17.3e sections render in the founder\'s order', order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), JSON.stringify(order));
  const legacyHtml = renderToStaticMarkup(createElement(SessionContentSections, { sections: legacy }));
  check('U17.3f older content still renders (one learn group, no group labels)', legacyHtml.includes('course-session-overview') && !legacyHtml.includes('>Concepts<'));

  const sessPage = readFileSync('app/training/[courseId]/sessions/[id]/CourseSessionClient.tsx', 'utf8');
  const pos = (needle: string) => sessPage.indexOf(needle);
  const seq = ['data-testid="course-session-image"', 'data-testid="course-session-status"', 'data-testid="course-session-title"', '<TimeZoneTable', '{button}', '<SessionContentSections sections={sections} />', "block('Materials'", 'data-testid="course-session-prevnext"'].map(pos);
  check('U17.4a session page order: image, number and status, title, time and zones, button, content, materials, previous / next', seq.every((v, i) => v >= 0 && (i === 0 || v > seq[i - 1])), JSON.stringify(seq));
  check('U17.4b the title is smaller than a page title (the image shows it)', sessPage.includes("fontSize: 'clamp(18px,2.2vw,22px)'"));
  check('U17.4c the page reads content through the one reader', sessPage.includes('sessionSections(s)') && !sessPage.includes('s.content_overview'));

  // ── Sidebar: fits the screen, scrolls on its own, lists every session ──
  const shell = readFileSync('src/hubs/training/components/sessions/CourseShell.tsx', 'utf8');
  check('U17.5a the sidebar is capped at the screen height and its session list scrolls', shell.includes('max-height: calc(100dvh - 92px)') && /\.cs-list \{[^}]*overflow-y: auto/.test(shell) && /\.cs-list \{[^}]*min-height: 0/.test(shell));
  check('U17.5b it sticks for a signed-in student too (the shell main area clips instead of scrolling, course pages only)', shell.includes('.ts-main:has(.cs-shell) { overflow-x: clip !important; overflow-y: visible !important; }') && readFileSync('src/hubs/training/components/TrainingShell.tsx', 'utf8').includes('className="ts-main"'));
  const { CourseSidebarList } = await import('../src/hubs/training/components/sessions/CourseShell');
  const navSessions = Array.from({ length: 8 }, (_, i) => ({ id: `s${i + 1}`, title: `Session title ${i + 1}`, course_session_no: i + 1, scheduled_datetime: new Date(Date.parse('2026-12-01T16:00:00Z') + i * 7 * 864e5).toISOString(), duration_minutes: 150, session_type: 'upcoming' as const }));
  let navHtml = '';
  try { navHtml = renderToStaticMarkup(createElement(CourseSidebarList, { courseCode: 'REFM', courseTitle: 'REFM', sessions: navSessions, current: 's1', now: Date.parse('2026-11-10T00:00:00Z') })); } catch (e) { navHtml = `render failed: ${String(e)}`; }
  check('U17.5c the sidebar lists all 8 sessions, Session 8 included', (navHtml.match(/data-testid="course-sidebar-session"/g) ?? []).length === 8 && navHtml.includes('Session title 8'), navHtml.slice(0, 120));

  // ── Navigation is fast: cached reads, prefetched links ──
  const cached = readFileSync('src/hubs/training/lib/liveCourse/cachedReads.ts', 'utf8');
  check('U17.6a course and session reads are cached per request and across requests, tagged', cached.includes("from 'react'") && cached.includes('unstable_cache(') && cached.includes('tags: [LIVE_COURSE_CACHE_TAG]'));
  const readers = { 'session page': 'app/training/[courseId]/sessions/[id]/page.tsx', 'session layout': 'app/training/[courseId]/sessions/[id]/layout.tsx', 'course route': 'app/training/[courseId]/page.tsx', 'overview page': 'app/training/live-course/[code]/LiveCoursePage.tsx' };
  const notCached = Object.entries(readers).filter(([, f]) => !readFileSync(f, 'utf8').includes('cachedReads')).map(([k]) => k);
  check('U17.6b the session page, its layout and the overview read through the cache', notCached.length === 0, notCached.join(', '));
  check('U17.6c the course pages no longer read the settings directly', !readFileSync(readers['overview page'], 'utf8').includes('getLiveCourseSettings(') && !readFileSync(readers['session page'], 'utf8').includes('getLiveCourseSettings(') && !readFileSync(readers['course route'], 'utf8').includes('getLiveCourseSettings('));
  const writers = ['app/api/admin/live-course/route.ts', 'app/api/admin/live-course/[code]/route.ts', 'app/api/admin/live-course/[code]/image/route.ts', 'app/api/admin/live-sessions/route.ts', 'app/api/admin/live-sessions/[id]/route.ts', 'app/api/admin/live-sessions/[id]/reschedule/route.ts'];
  const noInvalidate = writers.filter((f) => !readFileSync(f, 'utf8').includes('invalidateLiveCourseCache()'));
  check('U17.6d every admin write to a course or its sessions clears the cache, so an edit shows at once', noInvalidate.length === 0, noInvalidate.join(', '));
  check('U17.6e sidebar, previous, next and Course overview links are prefetched', (shell.match(/<Link href=\{[^}]+\}\s+prefetch/g) ?? []).length >= 2 && sessPage.includes('<Link prefetch data-testid="course-session-prev"') && sessPage.includes('<Link prefetch data-testid="course-session-next"') && sessPage.includes('<Link prefetch data-testid="course-session-overview-link"'));
  check('U17.6f an exam course (3SFM, BVM) still renders its own page (the live check returns null)', readFileSync(readers['course route'], 'utf8').includes('if (live) return <LiveCoursePage') && readFileSync(readers['course route'], 'utf8').includes('getCourseWithLessons(courseId)'));

  // ── Editor, routes, other readers ──
  const editor = readFileSync('app/admin/training-hub/live-training/LiveSessionsManager.tsx', 'utf8');
  check('U17.7a the session editor has one textarea per section, one bullet per line, prefilled through the reader', editor.includes('SECTION_KEYS.map((k) => (') && editor.includes('admin-session-content-${k}') && editor.includes('sessionSections(s as unknown as SessionContentRow)') && editor.includes('linesToList(form.content_sections[k])'));
  check('U17.7b create and edit store the lists through the one normaliser', readFileSync('app/api/admin/live-sessions/[id]/route.ts', 'utf8').includes('updates[k] = normaliseSections(body[k])') && readFileSync('app/api/admin/live-sessions/route.ts', 'utf8').includes('content_sections: normaliseSections(body.content_sections)'));
  check('U17.7c page metadata and the calendar file read the overview through the reader', readFileSync('app/training/[courseId]/sessions/[id]/page.tsx', 'utf8').includes('overviewText(d.session)') && readFileSync('src/hubs/training/lib/liveCourse/calendar.ts', 'utf8').includes('overviewText(s)'));
  check('U17.7d the session read tolerates a database without mig 253, then 251', readFileSync('src/hubs/training/lib/liveCourse/courseSettings.ts', 'utf8').includes('run(COURSE_SESSION_251_COLUMNS)'));

  // ── Overview side card ──
  const PS = await import('../src/hubs/training/lib/liveCourse/pageSections');
  check('U17.8a the next line reads "Next: Session 1, Tue 1 Dec 2026, 7:00 PM KSA"', PS.nextSessionLine({ no: 1, startIso: '2026-12-01T16:00:00Z' }) === 'Next: Session 1, Tue 1 Dec 2026, 7:00 PM KSA', PS.nextSessionLine({ no: 1, startIso: '2026-12-01T16:00:00Z' }));
  const facts = PS.scheduleFacts(navSessions);
  check('U17.8b key facts: 8 live sessions, 2.5 hours each, Tuesdays 7:00 to 9:30 PM KSA, Free, Certificate', JSON.stringify(facts) === JSON.stringify(['8 live sessions', '2.5 hours each', 'Tuesdays 7:00 to 9:30 PM KSA', 'Free', 'Certificate']), JSON.stringify(facts));
  check('U17.8c mixed lengths or days leave that fact out rather than state a wrong one', JSON.stringify(PS.scheduleFacts([{ scheduled_datetime: '2026-12-01T16:00:00Z', duration_minutes: 150 }, { scheduled_datetime: '2026-12-03T16:00:00Z', duration_minutes: 90 }])) === JSON.stringify(['2 live sessions', 'Free', 'Certificate']));
  const landing = readFileSync('app/training/live-course/[code]/CourseLanding.tsx', 'utf8');
  const client = readFileSync('app/training/live-course/[code]/LiveCourseClient.tsx', 'utf8');
  check('U17.8d the side card shows the next line, the facts, Prerequisites and Add to calendar (enrolled)', landing.includes('{nextSessionLine(d.next)}') && landing.includes('data-testid="landing-side-facts"') && landing.includes('data-testid="landing-side-prereq"') && landing.includes('data-testid="landing-side-calendar"') && client.includes('sideFacts: scheduleFacts(sessions)') && client.includes("calendarHref={enrolled ?"));
  check('U17.8e the old "Next session (1):" wording is gone', !landing.includes('Next session{d.next.no'));
}

async function unit18(): Promise<void> {
  console.log('\n=== Guests without a Microsoft account: the name note and matching by name ===\n');
  const NM = await import('../src/hubs/training/lib/liveCourse/nameMatch');
  const joiners = [
    { email: 'jane@x.com', name: 'Jane Doe' },
    { email: 'omar@x.com', name: "Omar Al-Farsi" },
    { email: 'ali1@x.com', name: 'Ali Khan' },
    { email: 'ali2@x.com', name: 'Ali Khan' },
    { email: 'sara@x.com', name: 'Sara Ahmed' },
  ];
  // ── The matching rule ──
  const exact = NM.matchByName('  Jane   Doe ', joiners);
  check('U18.1a an exact name (spaces trimmed) links the one student', exact.studentEmail === 'jane@x.com' && exact.how === 'exact');
  const close = NM.matchByName('omar alfarsi', joiners);
  check('U18.1b a close name (case, spaces, punctuation ignored) links the one student', close.studentEmail === 'omar@x.com' && close.how === 'close');
  check('U18.1c accents are ignored in a close match', NM.matchByName('Sára Ahméd', joiners).studentEmail === 'sara@x.com');
  const twin = NM.matchByName('Ali Khan', joiners);
  check('U18.1d two students with the same name: NOT linked, both suggested', twin.studentEmail === null && twin.suggestions.length === 2 && twin.suggestions.every((s) => s.reason === 'exact'));
  const partial = NM.matchByName('Jane', joiners);
  check('U18.1e a partial name is NOT linked; the likely student is suggested', partial.studentEmail === null && partial.suggestions[0]?.email === 'jane@x.com' && partial.suggestions[0]?.reason === 'partial');
  const none = NM.matchByName('Guest 4471', joiners);
  check('U18.1f no likely student: unmatched with no suggestion', none.studentEmail === null && none.suggestions.length === 0);
  check('U18.1g an empty or punctuation-only name never matches', NM.matchByName('', joiners).studentEmail === null && NM.matchByName('...', joiners).studentEmail === null);
  check('U18.1h a candidate who is not a joiner cannot match (only the session\'s join clicks are candidates)', NM.matchByName('Jane Doe', []).studentEmail === null);
  check('U18.1i the admin labels: by email, by name, by hand', NM.MATCHED_BY_LABEL.email === 'By email' && NM.MATCHED_BY_LABEL.name === 'By name' && NM.MATCHED_BY_LABEL.manual === 'By hand');

  // ── The sync, end to end on the in-memory database ──
  const S = await import('../src/hubs/training/lib/liveCourse/attendanceSync');
  const A = await import('../src/hubs/training/lib/liveCourse/attendance');
  const row = (email: string | null, name: string, pct = 80): import('../src/hubs/training/lib/liveCourse/attendance').AttendanceRow =>
    ({ attendee_email: A.attendeeKey(email, name), attendee_name: name, role: 'Attendee', intervals: [], attended_seconds: Math.round(pct * 90), session_seconds: 9000, attended_pct: pct });
  const seed = () => ({
    live_sessions: [{ id: 'g1', live_url: 'x', scheduled_datetime: '2026-12-01T16:00:00Z', duration_minutes: 150, graph_online_meeting_id: null, course_code: 'REFM' }],
    training_registrations_meta: joiners.map((j, i) => ({ registration_id: `FMP-${i}`, email: j.email, name: j.name })).concat([{ registration_id: 'FMP-9', email: 'notjoined@x.com', name: 'Nadia Noor' }]),
    live_session_join_clicks: joiners.map((j) => ({ session_id: 'g1', student_email: j.email })),
    student_email_aliases: [] as Row[],
    live_session_attendance: [] as Row[],
  });
  const db1 = fakeDb(seed());
  const res = await S.applyAttendanceRows(db1.client, 'g1', [row('jane@x.com', 'Jane D'), row(null, 'Omar Al Farsi'), row(null, 'Ali Khan'), row(null, 'Nadia Noor'), row(null, 'Jane Doe')], 'graph');
  const at = (key: string) => db1.tables.live_session_attendance.find((r) => r.attendee_email === key)!;
  check('U18.2a an attendee with an email still matches by email', at('jane@x.com').student_email === 'jane@x.com' && at('jane@x.com').matched_by === 'email');
  check('U18.2b a guest whose name matches one joiner is linked, recorded as matched by name', at('noemail:omar al farsi').student_email === 'omar@x.com' && at('noemail:omar al farsi').matched_by === 'name' && at('noemail:jane doe').matched_by === 'name');
  check('U18.2c an ambiguous guest name stays unmatched', at('noemail:ali khan').student_email == null);
  check('U18.2d a name belonging to a student who did not click Join stays unmatched', at('noemail:nadia noor').student_email == null);
  check('U18.2e the result counts name matches', res.byName === 2 && res.unmatched === 2 && res.nameMatchesHeld === 0, JSON.stringify(res));

  // Before mig 254: the column refuses 'name'; the sync must not fail, and keeps the record unmatched.
  const db2 = fakeDb(seed());
  const strict = {
    ...db2.client,
    from: (t: string) => {
      const q = (db2.client as unknown as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> }).from(t);
      if (t !== 'live_session_attendance') return q;
      const up = q.upsert;
      q.upsert = (p: unknown, o: unknown) => ((p as Row).matched_by === 'name'
        ? { then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: { message: 'new row for relation "live_session_attendance" violates check constraint "live_session_attendance_matched_by_check"' } }).then(r) }
        : up(p, o));
      return q;
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
  let threw = false; let res2: Awaited<ReturnType<typeof S.applyAttendanceRows>> | null = null;
  try { res2 = await S.applyAttendanceRows(strict, 'g1', [row(null, 'Omar Al Farsi')], 'graph'); } catch { threw = true; }
  check('U18.2f before migration 254, a name match is held as unmatched and the sync does not fail', !threw && res2?.nameMatchesHeld === 1 && db2.tables.live_session_attendance.find((r) => r.attendee_email === 'noemail:omar al farsi')?.student_email == null);

  // The admin's choice is saved as an alias and matches the same name later.
  await S.matchAttendee(db1.client, { sessionId: 'g1', attendeeEmail: 'noemail:ali khan', studentEmail: 'ali2@x.com', remember: true, by: 'admin@x.com' });
  check('U18.3a the admin\'s match is recorded as by hand', at('noemail:ali khan').student_email === 'ali2@x.com' && at('noemail:ali khan').matched_by === 'manual');
  check('U18.3b "remember" saves the guest name as an alias', db1.tables.student_email_aliases.some((a) => a.alias_email === 'noemail:ali khan' && a.student_email === 'ali2@x.com'));
  db1.tables.live_sessions.push({ id: 'g2', live_url: 'x', scheduled_datetime: '2026-12-08T16:00:00Z', duration_minutes: 150, graph_online_meeting_id: null, course_code: 'REFM' });
  await S.applyAttendanceRows(db1.client, 'g2', [row(null, 'Ali Khan')], 'graph');
  const later = db1.tables.live_session_attendance.find((r) => r.session_id === 'g2' && r.attendee_email === 'noemail:ali khan');
  check('U18.3c in a later session the same guest name matches through the saved alias', later?.student_email === 'ali2@x.com' && later?.matched_by === 'alias');

  // ── The admin and the Join button ──
  const route = readFileSync('app/api/admin/live-sessions/[id]/attendance/route.ts', 'utf8');
  const panel = readFileSync('app/admin/training-hub/live-training/[code]/CourseAttendancePanel.tsx', 'utf8');
  check('U18.4a the admin route suggests likely students for each unmatched guest, from the session\'s joiners', route.includes('loadSessionJoiners(sb, id)') && route.includes('matchByName(g.attendee_name') && route.includes('suggestions'));
  // Re-aimed 2026-11-10: only an exact or close full-name match is pre-selected (U26.3c).
  check('U18.4b the admin shows how each record was matched (email, name, hand) and the suggestions', panel.includes('MATCHED_BY_LABEL[r.matched_by') && panel.includes('data-testid="admin-name-suggestions"') && panel.includes("useState(preselectable(suggestions[0]) ? suggestions[0].email : '')"));
  const btn = readFileSync('src/hubs/training/components/sessions/JoinLiveButton.tsx', 'utf8');
  const { joinNameNote } = await import('../src/hubs/training/components/sessions/JoinLiveButton');
  check('U18.5a the Join button opens a note first, and Continue opens Teams through the logged join route', btn.includes('onClick={() => setNoteOpen(true)}') && btn.includes('data-testid="join-name-continue" href={joinUrl}') && !/data-testid="join-live"\s+href=/.test(btn));
  check('U18.5b the note reads "When Teams asks for your name, type your full name as registered: <name>"', joinNameNote('Jane Doe') === 'When Teams asks for your name, type your full name as registered: Jane Doe' && btn.includes('When Teams asks for your name, type your full name as registered: <strong'));
  check('U18.5c the name is the registered one (course page passes it; otherwise the signed student\'s own, from the server)', readFileSync('app/training/[courseId]/sessions/[id]/CourseSessionClient.tsx', 'utf8').includes('studentName={view?.student.name ?? null}') && readFileSync('app/api/training/registered-name/route.ts', 'utf8').includes("eq('email', sess.email.toLowerCase())"));
  check('U18.6 migration 254 widens matched_by to include name (written, not applied by Claude)', readFileSync('supabase/migrations/254_attendance_matched_by_name.sql', 'utf8').includes("CHECK (matched_by IN ('email', 'alias', 'name', 'manual'))"));
}

async function unit19(): Promise<void> {
  console.log('\n=== Course meeting options (course only) and compressed images ===\n');
  // ── Teams: lobby bypass Everyone and organizer-only presenters, on COURSE meetings only ──
  const T = readFileSync('src/integrations/teams/teamsMeetings.ts', 'utf8');
  const TM = await import('../src/integrations/teams/teamsMeetings');
  check('U19.1a course meeting options: everyone (dial-in too) bypasses the lobby, only the organizer presents, record and transcribe automatically', TM.MEETING_SETTINGS.lobbyBypassSettings.scope === 'everyone' && TM.MEETING_SETTINGS.lobbyBypassSettings.isDialInBypassEnabled === true && TM.MEETING_SETTINGS.allowedPresenters === 'organizer' && TM.MEETING_SETTINGS.recordAutomatically === true);
  const ts = readFileSync('app/api/admin/live-course/[code]/teams-settings/route.ts', 'utf8');
  check('U19.1d "Apply meeting options to all sessions" applies them to every course meeting, reads each back from Teams and reports per meeting (saved for re-reading)', ts.includes('await applyMeetingSettings(url)') && ts.includes('readMeetingSettings(await resolveOnlineMeetingIdByJoinUrl(url))') && ts.includes('row.dialInBypass') && ts.includes('row.recordAutomatically') && ts.includes("from('training_settings').upsert") && readFileSync('app/admin/training-hub/live-training/[code]/TeamsMeetingsButton.tsx', 'utf8').includes('data-testid="apply-teams-options"'));
  check('U19.1b they are applied ONLY when the meeting is a course meeting (create and move)', T.includes('return params.courseMeeting ? { ...created, settings: await applyMeetingSettings(created.joinUrl) } : created;') && T.includes('return updates.courseMeeting ? { ...updated, settings: await applyMeetingSettings(updated.joinUrl) } : updated;'));
  const callers = {
    'course create (Create missing Teams meetings)': ['app/api/admin/live-course/[code]/teams-meetings/route.ts', 'courseMeeting: true,'],
    'session create': ['app/api/admin/live-sessions/route.ts', 'courseMeeting: !!courseFields(body).course_code,'],
    'session edit (move)': ['app/api/admin/live-sessions/[id]/route.ts', 'courseMeeting: !!courseCode,'],
    'reschedule': ['app/api/admin/live-sessions/[id]/reschedule/route.ts', 'courseMeeting: true });'],
  };
  const missing = Object.entries(callers).filter(([, [f, s]]) => !readFileSync(f, 'utf8').includes(s)).map(([k]) => k);
  check('U19.1c every create and move says whether it is a course meeting (a single session keeps the Teams defaults)', missing.length === 0, missing.join(', '));

  // ── Images: compressed on upload, original kept ──
  const OI = await import('../src/shared/storage/optimizeImage');
  const sharp = (await import('sharp')).default;
  const noise = Buffer.alloc(2400 * 1350 * 3); for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
  const bigPng = await sharp(noise, { raw: { width: 2400, height: 1350, channels: 3 } }).png().toBuffer();
  const out = await OI.optimizeImage(bigPng, 'image/png', { maxWidth: OI.IMAGE_WIDTH.session });
  const outMeta = await sharp(out.buffer).metadata();
  check('U19.2a a large PNG becomes a WebP at or under the target size, no wider than the display width at 2x', out.optimized && out.contentType === 'image/webp' && out.buffer.length <= OI.TARGET_MAX_BYTES && (outMeta.width ?? 9999) <= OI.IMAGE_WIDTH.session, `${bigPng.length} -> ${out.buffer.length} bytes, ${outMeta.width}px`);
  check('U19.2b aspect ratio is kept (never cropped)', Math.abs((outMeta.width! / outMeta.height!) - 2400 / 1350) < 0.01);
  const small = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#1B4F8A' } }).jpeg().toBuffer();
  const tiny = await OI.optimizeImage(small, 'image/jpeg', { maxWidth: 1600 });
  check('U19.2c a small JPG already under the target is left as uploaded (never enlarged)', !tiny.optimized && tiny.buffer === small);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  check('U19.2d SVG and GIF are left as uploaded', !(await OI.optimizeImage(svg, 'image/svg+xml', { maxWidth: 1600 })).optimized && !(await OI.optimizeImage(small, 'image/gif', { maxWidth: 1600 })).optimized);
  const { client, uploads } = fakeDb({});
  const stored = await OI.storeImage(client, { bucket: 'live-session-banners', path: 'banners/s1.png', buffer: bigPng, contentType: 'image/png', maxWidth: OI.IMAGE_WIDTH.session });
  check('U19.2e the original is kept at originals/<path> and the compressed copy is served', !stored.error && stored.path === 'banners/s1.webp' && uploads.some((u) => u.path === 'originals/banners/s1.png' && u.bytes === bigPng.length) && uploads.some((u) => u.path === 'banners/s1.webp'));
  const routes = {
    'media library': ['app/api/admin/media/route.ts', 'storeImage(sb, { bucket, path, buffer'],
    'course banner and card': ['app/api/admin/live-course/[code]/image/route.ts', "storeImage(sb, { bucket: 'live-session-banners'"],
    'session image': ['app/api/admin/live-sessions/route.ts', "storeImage(sb, { bucket: 'live-session-banners', path, buffer: bytes"],
    'student avatar': ['app/api/training/upload-avatar/route.ts', 'optimizeImage(original, file.type, { maxWidth: IMAGE_WIDTH.avatar })'],
    'user avatar': ['app/api/user/avatar/route.ts', 'optimizeImage(original, file.type, { maxWidth: IMAGE_WIDTH.avatar })'],
  };
  const notWired = Object.entries(routes).filter(([, [f, s]]) => !readFileSync(f, 'utf8').includes(s)).map(([k]) => k);
  check('U19.2f every image upload route compresses through the one helper', notWired.length === 0, notWired.join(', '));
  check('U19.2g the existing founder photos and session images have a re-compress script that keeps the originals', readFileSync('scripts/optimize-uploaded-images.ts', 'utf8').includes('withExt(`optimized/${loc.path}`, img.ext)'));
  if (hasCreds()) {
    const sb = await db();
    const { data: s } = await sb.from('live_sessions').select('banner_url').eq('course_code', 'REFM').not('banner_url', 'is', null);
    const { data: f } = await sb.from('instructors').select('photo_url').eq('is_default', true).maybeSingle();
    check('U19.3a live: every REFM session image and the founder photo now point at compressed copies', (s ?? []).length > 0 && (s ?? []).every((r) => String(r.banner_url).includes('/optimized/')) && String(f?.photo_url ?? '').includes('/optimized/'));
  }
}

async function unit20(): Promise<void> {
  console.log('\n=== Dashboard: My Courses progress, Live Sessions, recording unlock, KSA-first times ===\n');
  const RA = await import('../src/hubs/training/lib/liveCourse/recordingAccess');
  const E = (no: number, liveMet: boolean, recordingMet: boolean) => ({ sessionId: `s${no}`, no, liveMet, recordingMet, met: liveMet || recordingMet });

  // ── Progress count ──
  const elig = { courseCode: 'REFM', sessions: [E(1, true, false), E(2, false, true), E(3, true, false), E(4, false, false), E(5, false, false), E(6, false, false), E(7, false, false), E(8, false, false)] } as unknown as import('../src/hubs/training/lib/liveCourse/eligibility').Eligibility;
  const pr = RA.courseProgress(elig);
  check('U20.1a progress is sessions complete over the course\'s sessions (3/8)', pr.completed === 3 && pr.total === 8);
  const api = readFileSync('app/api/training/live-course/route.ts', 'utf8');
  const dash = readFileSync('app/training/dashboard/page.tsx', 'utf8');
  check('U20.1b the dashboard API returns it for an enrolled student, through the one eligibility rule', api.includes('const elig = enrolled ? await loadStudentEligibility(sb, sess.email, c.courseCode) : null;') && api.includes('progress: elig ? courseProgress(elig) : null'));
  // Re-aimed 2026-11-10: the course opens INSIDE the dashboard now (unit 24).
  check('U20.1c My Courses lists enrolled live courses beside 3SFM and BVM, with the count, opening the course and its sessions', dash.includes('myLiveCourses.map(lc =>') && dash.includes("badge={lc.enrolled ? `${p.completed}/${p.total}` : 'Enrol free'}") && dash.includes("onClick={() => navigateTo('live-course', lc.courseCode)}") && dash.indexOf('myLiveCourses.map(lc =>') > dash.indexOf("(['3sfm', 'bvm'] as const).map(cId =>"));

  // ── Live Sessions: a course session leaves once its recording is added ──
  const future = new Date(Date.now() + 7 * 864e5).toISOString();
  const past = new Date(Date.now() - 7 * 864e5).toISOString();
  const base = { course_code: 'REFM', session_type: 'upcoming', duration_minutes: 150 };
  check('U20.2a an upcoming course session is under Live Sessions', RA.showInLiveSessions({ ...base, scheduled_datetime: future, youtube_url: null }));
  check('U20.2b once its recording is added it leaves Live Sessions (it is in the course under My Courses)', !RA.showInLiveSessions({ ...base, scheduled_datetime: past, session_type: 'recorded', youtube_url: 'https://youtu.be/x' }) && !RA.showInLiveSessions({ ...base, scheduled_datetime: future, youtube_url: 'https://youtu.be/x' }));
  check('U20.2c an ended course session with no recording yet is not under Live Sessions either', !RA.showInLiveSessions({ ...base, scheduled_datetime: past, youtube_url: null }));
  check('U20.2d a single session is unchanged (a recorded one still lists)', RA.showInLiveSessions({ course_code: null, scheduled_datetime: past, session_type: 'recorded', youtube_url: 'https://youtu.be/x' }));
  check('U20.2e the Live Sessions API applies the rule', readFileSync('app/api/training/live-sessions/route.ts', 'utf8').includes('.filter((s) => showInLiveSessions(s, now))'));

  // ── The unlock rule ──
  const rec = [E(1, false, true), E(2, false, false), E(3, false, false), E(4, false, false)];
  const s3 = RA.recordingUnlock(rec, 's3');
  check('U20.3a a recording-only student is blocked from Session 3 until 1 and 2 are complete', !s3.unlocked && s3.message === 'Complete Session 2 to unlock' && s3.blockedBy === 2);
  check('U20.3b ... and Session 3 unlocks once Session 2 is complete', RA.recordingUnlock([E(1, false, true), E(2, false, true), E(3, false, false)], 's3').unlocked);
  check('U20.3c Session 1 is always open to an enrolled student (nothing earlier)', RA.recordingUnlock(rec, 's1').unlocked);
  const live4 = [E(1, true, false), E(2, true, false), E(3, false, false), E(4, true, false), E(5, false, false)];
  check('U20.3d a live attendee of Session 4 opens it even with Session 3 incomplete (and Session 5 waits on Session 3)', RA.recordingUnlock(live4, 's4').unlocked && RA.recordingUnlock(live4, 's5').message === 'Complete Session 3 to unlock');
  check('U20.3e the lock names the FIRST earlier session not complete', RA.recordingUnlock([E(1, false, false), E(2, false, false), E(3, false, false)], 's3').message === 'Complete Session 1 to unlock');

  // ── Enforced on the server: the player's session API, watch progress, materials ──
  const { client } = fakeDb({
    training_course_settings: [REFM_ROW],
    live_sessions: [1, 2, 3, 4].map((n) => ({ id: `s${n}`, title: `S${n}`, course_code: 'REFM', course_session_no: n, is_published: true, session_type: 'recorded', scheduled_datetime: new Date(Date.now() - (10 - n) * 864e5).toISOString(), duration_minutes: 150, youtube_url: `https://youtu.be/v${n}` })),
    training_enrollments: [{ registration_id: 'FMP-R', course_code: 'REFM' }, { registration_id: 'FMP-L', course_code: 'REFM' }],
    session_registrations: [],
    live_session_attendance: [{ id: 'a4', session_id: 's4', student_email: 'live@x.com', intervals: [], attended_pct: 90, session_seconds: 9000, source: 'manual' }],
    session_watch_history: [{ id: 'w1', session_id: 's1', student_email: 'rec@x.com', watch_seconds: 9000, total_seconds: 9000, watch_percentage: 100 }],
  });
  const sess = (n: number) => ({ id: `s${n}`, course_code: 'REFM', live_url: null, scheduled_datetime: null, duration_minutes: 150 });
  const recS3 = await RA.loadRecordingUnlock(client, { email: 'rec@x.com', registrationId: 'FMP-R' }, sess(3));
  const liveS4 = await RA.loadRecordingUnlock(client, { email: 'live@x.com', registrationId: 'FMP-L' }, sess(4));
  const liveS3 = await RA.loadRecordingUnlock(client, { email: 'live@x.com', registrationId: 'FMP-L' }, sess(3));
  const stranger = await RA.loadRecordingUnlock(client, { email: 'x@x.com', registrationId: 'FMP-X' }, sess(1));
  const anon = await RA.loadRecordingUnlock(client, null, sess(1));
  check('U20.4a server: the recording-only student is refused Session 3 ("Complete Session 2 to unlock")', !recS3.unlocked && recS3.message === 'Complete Session 2 to unlock', JSON.stringify(recS3));
  check('U20.4b server: the live attendee of Session 4 is allowed it, and still refused Session 3', liveS4.unlocked && !liveS3.unlocked, JSON.stringify({ liveS4, liveS3 }));
  check('U20.4c server: someone not enrolled, or not signed in, is refused', !stranger.unlocked && !anon.unlocked);
  const matRoute = readFileSync('app/api/training/live-sessions/[id]/materials/[materialId]/route.ts', 'utf8');
  check('U20.4d locked materials are refused by the server (the download route runs the same unlock before any link)', matRoute.includes('const unlock = await loadRecordingUnlock(sb, sess, session as SessionForAccess);') && matRoute.indexOf('loadRecordingUnlock(') < matRoute.indexOf('createSignedUrl('));
  const detail = readFileSync('app/api/training/live-sessions/[id]/route.ts', 'utf8');
  check('U20.4e the player\'s session API hands out a course recording only when unlocked, else the marker and the reason', detail.includes('const unlock = await loadRecordingUnlock(sb, await getTrainingCookieSession(), session);') && detail.includes('row = withoutCourseRecordingLink(row); recordingLocked = unlock.message;'));
  check('U20.4f watch progress for a locked course recording is refused', readFileSync('app/api/training/live-sessions/[id]/watched/route.ts', 'utf8').includes("if (!unlock.unlocked) return NextResponse.json({ success: false, error: unlock.message ?? 'This recording is locked.' }, { status: 403 });"));
  const CS = await import('../src/hubs/training/lib/liveCourse/courseSettings');
  const listed = await CS.listCourseSessions(client, 'REFM');
  check('U20.4g course recording links never travel in the session list (marker only; "a recording exists" stays true)', listed.length === 4 && listed.every((s) => s.youtube_url === RA.RECORDING_MARKER));
  const leaks = ['app/api/public/training-sessions/route.ts', 'app/api/public/training-sessions/[id]/route.ts', 'app/training-sessions/page.tsx', 'app/api/training/live-sessions/route.ts'].filter((f) => !readFileSync(f, 'utf8').includes('withoutCourseRecordingLink('));
  check('U20.4h nor in the public APIs, the Training Sessions page or the Live Sessions list', leaks.length === 0, leaks.join(', '));
  const nav = await import('../src/hubs/training/lib/liveCourse/courseNav');
  const act = nav.sessionMainAction({ courseCode: 'REFM', sessionId: 's3', status: 'recorded', enrolled: true, signedIn: true, canRegister: true, recordingLocked: 'Complete Session 2 to unlock' });
  check('U20.4i the session page button shows the lock instead of Watch recording', act.kind === 'locked' && act.label === 'Complete Session 2 to unlock' && act.href === null);

  // ── Times: KSA first, plus the viewer's own when it differs ──
  const TM = await import('../src/hubs/training/lib/liveCourse/time');
  check('U20.5a a course session time reads KSA first: "Tue 1 Dec, 7:00 PM KSA"', TM.courseTimeLabel('2026-12-01T16:00:00Z') === 'Tue 1 Dec, 7:00 PM KSA');
  check('U20.5b plus "(9:00 PM your time)" when the viewer\'s zone differs, nothing in KSA, the day when it changes', TM.viewerTimeSuffix('2026-12-01T16:00:00Z', 'Asia/Karachi') === '(9:00 PM your time)' && TM.viewerTimeSuffix('2026-12-01T16:00:00Z', 'Asia/Riyadh') === '' && TM.viewerTimeSuffix('2026-12-01T16:00:00Z', 'Asia/Tokyo') === '(Wed 2 Dec, 1:00 AM your time)');
  const card = readFileSync('src/hubs/training/components/dashboard/LiveSessionCard.tsx', 'utf8');
  check('U20.5c the dashboard card shows a course session KSA first; a single session keeps its own format', card.includes('.course_code ? <CourseTime iso={session.scheduled_datetime} /> : formatDateTime(session.scheduled_datetime)'));
  const surfaces = ['src/hubs/training/components/dashboard/LiveSessionCardLarge.tsx', 'src/hubs/training/components/sessions/CourseSessionListingCard.tsx', 'src/hubs/training/components/dashboard/LiveCourseCards.tsx', 'app/training/[courseId]/sessions/[id]/CourseSessionClient.tsx', 'src/hubs/training/components/sessions/CourseShell.tsx'].filter((f) => !readFileSync(f, 'utf8').includes('<CourseTime iso='));
  check('U20.5d every course session time surface uses the one KSA-first label', surfaces.length === 0, surfaces.join(', '));
}

async function unit21(): Promise<void> {
  console.log('\n=== Course sessions: enrolment is the registration ===\n');
  const SA = await import('../src/hubs/training/lib/liveCourse/sessionAccess');
  const sessions = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: 'c' + n, course_code: 'REFM', course_session_no: n, live_url: 'https://teams.example/x', scheduled_datetime: new Date(Date.now() + n * 7 * 864e5).toISOString(), duration_minutes: 150 }));
  const { client } = fakeDb({
    training_enrollments: [{ registration_id: 'FMP-E', course_code: 'REFM' }],
    // An OLD per-session row on a course session (8 exist on live): must be ignored.
    session_registrations: [{ session_id: 'c3', student_email: 'stray@x.com' }, { session_id: 'single1', student_email: 'single@x.com' }],
  });
  const enrolled = { email: 'enrolled@x.com', registrationId: 'FMP-E' };
  const access = await Promise.all(sessions.map((x) => SA.studentHasSessionAccess(client, enrolled, x)));
  check('U21.1a one enrolment gives access to all 8 sessions (no per-session row exists to create, so later sessions are covered too)', access.every(Boolean), JSON.stringify(access));
  const inWindow = { ...sessions[0], scheduled_datetime: new Date(Date.now() + 5 * 60_000).toISOString() };
  const st = SA.joinStatusFrom(await SA.studentHasSessionAccess(client, enrolled, inWindow), inWindow, 15);
  check('U21.1b ... and Join live inside the join window', st.canJoinNow && !!st.joinUrl);
  check('U21.1c an old per-session row on a course session gives NO access without enrolment', !(await SA.studentHasSessionAccess(client, { email: 'stray@x.com', registrationId: 'FMP-S' }, sessions[2])));
  const single = { id: 'single1', course_code: null, live_url: 'https://teams.example/s', scheduled_datetime: sessions[0].scheduled_datetime, duration_minutes: 90 };
  check('U21.1d a single session still needs its own registration', (await SA.studentHasSessionAccess(client, { email: 'single@x.com', registrationId: 'FMP-1' }, single)) && !(await SA.studentHasSessionAccess(client, enrolled, single)));

  // No Register on course sessions.
  const act = readFileSync('src/hubs/training/components/sessions/CourseSessionAction.tsx', 'utf8');
  check('U21.2a the course session button: Enrol in course / Join live / Enrolled with the date and Add to calendar, never Register', act.includes('Enrol in course') && act.includes('<JoinLiveButton ') && act.includes('Enrolled</span>') && act.includes('<CourseTime iso={p.scheduledIso} />') && act.includes('Add to calendar') && !/>\s*Register/.test(act));
  const cards = ['src/hubs/training/components/dashboard/LiveSessionCard.tsx', 'src/hubs/training/components/dashboard/LiveSessionCardLarge.tsx', 'app/training/live-sessions/[id]/page.tsx'].filter((f) => !readFileSync(f, 'utf8').includes('<CourseSessionAction courseCode='));
  check('U21.2b dashboard cards, Live Sessions and the session player page use it for a course session', cards.length === 0, cards.join(', '));
  check('U21.2c the course session page uses it in place of Join', readFileSync('app/training/[courseId]/sessions/[id]/CourseSessionClient.tsx', 'utf8').includes("if (action.kind === 'join') return <CourseSessionAction"));
  const reg = readFileSync('app/api/training/live-sessions/[id]/register/route.ts', 'utf8');
  const guard = reg.indexOf('if (session.course_code) {');
  check('U21.2d registering for a course session is refused before any row or email', guard > 0 && guard < reg.indexOf('.upsert({') && guard < reg.indexOf('await sendEmail(') && reg.includes("error: 'course_session'"));
  check('U21.2e no per-session count on a course session (status API, Training Sessions page, public API)', reg.includes('registrationCount: session.course_code ? null : count ?? 0') && readFileSync('app/training-sessions/page.tsx', 'utf8').includes('registration_count: s.course_code ? 0 :') && readFileSync('app/api/public/training-sessions/route.ts', 'utf8').includes('course_code ? 0 : regCounts'));
  check('U21.2f the batch status counts a course session as registered exactly when enrolled', readFileSync('app/api/training/live-sessions/registration-status-batch/route.ts', 'utf8').includes('const registered = session.course_code ? enrolled.has(session.course_code) : regSet.has(id);'));

  // Reminders and reschedule emails go to every enrolled student.
  const cron = readFileSync('app/api/cron/session-reminders/route.ts', 'utf8');
  check('U21.3a no per-session reminder for a course session, in the 24-hour AND the 1-hour pass', (cron.match(/if \(session\.course_code\) continue;/g) ?? []).length === 2);
  check('U21.3b the session-day reminder and the reschedule email go to the course\'s enrolled students', readFileSync('src/hubs/training/lib/liveCourse/dayReminder.ts', 'utf8').includes('listEnrolledStudents(sb, course.courseCode)') && readFileSync('src/hubs/training/lib/liveCourse/rescheduleApply.ts', 'utf8').includes('listEnrolledStudents(sb, course.courseCode)'));
  const ES = await import('../src/hubs/training/lib/liveCourse/enrolledStudents');
  const db2 = fakeDb({ training_enrollments: [{ registration_id: 'A', course_code: 'REFM' }, { registration_id: 'B', course_code: 'REFM' }, { registration_id: 'C', course_code: 'BVM' }], training_registrations_meta: [{ registration_id: 'A', email: 'a@x.com', name: 'A' }, { registration_id: 'B', email: 'b@x.com', name: 'B' }, { registration_id: 'C', email: 'c@x.com', name: 'C' }], session_registrations: [{ session_id: 'c1', student_email: 'stray@x.com' }] });
  const recips = (await ES.listEnrolledStudents(db2.client, 'REFM')).map((r) => r.email).sort();
  check('U21.3c recipients are every enrolled student and only them (not a per-session registrant)', JSON.stringify(recips) === JSON.stringify(['a@x.com', 'b@x.com']), JSON.stringify(recips));
  check('U21.4 the enrolment email still attaches the course calendar (all sessions)', readFileSync('src/hubs/training/lib/liveCourse/enrolment.ts', 'utf8').includes('icsAttachment(buildCourseIcs(settings, sessions), settings.courseCode)'));
}

async function unit22(): Promise<void> {
  console.log('\n=== Training Sessions page: course sessions enrol in the course, KSA-first time, enrolment count ===\n');
  const PL = await import('../src/hubs/training/lib/liveCourse/publicListing');
  const client = readFileSync('app/training-sessions/SessionsClient.tsx', 'utf8');
  const a = PL.courseCardAction({ courseCode: 'REFM', sessionId: 's1', enrolled: false, signedIn: true, enrolmentOpen: true });
  const v = PL.courseCardAction({ courseCode: 'REFM', sessionId: 's1', enrolled: true, signedIn: true, enrolmentOpen: true });
  check('U22.1a a course session\'s Enrol goes to the course page, which creates the COURSE enrolment (never a session registration)', a.kind === 'enrol' && a.href === '/training/REFM?enrol=1' && readFileSync('app/training/live-course/[code]/LiveCourseClient.tsx', 'utf8').includes("enrol('dashboard')") && readFileSync('app/api/training/enroll/route.ts', 'utf8').includes('enrolInLiveCourse('));
  check('U22.1b an enrolled student sees View session', v.kind === 'view' && v.label === 'View session' && v.href === '/training/REFM/sessions/s1');
  check('U22.1c the Next session card uses the same course action for a course session', client.includes('const nextAction = nextSession?.course_code') && client.includes('courseCardAction({ courseCode: nextSession.course_code') && client.includes('href={nextAction ? nextAction.href : registerUrl(nextSession.id)}'));
  const TM = await import('../src/hubs/training/lib/liveCourse/time');
  check('U22.2a the time reads "Tue 1 Dec 2026, 7:00 PM KSA" (KSA, not the viewer\'s clock labelled Riyadh)', TM.courseTimeLabel('2026-12-01T16:00:00Z', { year: true }) === 'Tue 1 Dec 2026, 7:00 PM KSA');
  check('U22.2b a viewer in KSA sees no "Your time"; a viewer in Pakistan sees "Your time: 9:00 PM"', TM.viewerClock('2026-12-01T16:00:00Z', 'Asia/Riyadh') === '' && TM.viewerClock('2026-12-01T16:00:00Z', 'Asia/Karachi') === '9:00 PM' && readFileSync('src/hubs/training/components/sessions/CourseTime.tsx', 'utf8').includes('Your time: {clock}'));
  check('U22.2c the Next session card shows a course session that way; a single session in its own zone', client.includes('<CourseTime iso={nextSession.scheduled_datetime} year variant="line" />') && client.includes('fmtTime(nextSession.scheduled_datetime, nextSession.timezone)') && /hour12: true, \.\.\.\(timeZone \? \{ timeZone \} : \{\}\)/.test(client));
  check('U22.2d the player page header reads the session\'s own zone too (KSA for a course session)', readFileSync('src/hubs/training/components/player/CoursePlayerLayout.tsx', 'utf8').includes("const tzLabel = timezone === 'Asia/Riyadh' ? 'KSA' : timezone;") && readFileSync('src/hubs/training/components/player/CoursePlayerLayout.tsx', 'utf8').includes('hour12: true, ...tzOpt'));
  const PS = await import('../src/hubs/training/lib/liveCourse/pageSections');
  check('U22.3a the enrolment count follows the threshold (24 of 25 hidden, 25 shown)', !PS.showEnrolledCount(24, 25) && PS.showEnrolledCount(25, 25));
  check('U22.3b a course session shows "X enrolled" from the course, never "people registered"', client.includes('showEnrolledCount(offer.enrolledCount ?? 0, offer.enrolledThreshold ?? 25)') && client.includes('{offer.enrolledCount} enrolled') && client.indexOf('{nextSession.course_code ? (() => {') < client.indexOf('people registered'));
  check('U22.3c the page reads the count and the admin threshold per course', readFileSync('app/training-sessions/page.tsx', 'utf8').includes('enrolledThreshold: c.page.sections.sideCard.enrolledThreshold'));
}

async function unit23(): Promise<void> {
  console.log('\n=== Announcements: one per course, none per course session, audiences, the daily budget and its queue ===\n');
  // ── One announcement per course; none per course session ──
  const courseRoute = readFileSync('app/api/admin/live-course/[code]/announce/route.ts', 'utf8');
  check('U23.1a the course announcement is ONE email with the whole schedule (every session, KSA), sent once per POST', (courseRoute.match(/dispatchAnnouncement\(/g) ?? []).length === 1 && courseRoute.includes("sessions: d.sessions.map((s, i) => ({ label: ") && courseRoute.includes('courseTimeLabel(s.scheduled_datetime, { year: true })') && courseRoute.includes("kind: 'course'"));
  // Re-aimed 2026-11-10: a TEST to the admin may preview a draft; a real announcement still needs a published course.
  check('U23.1b only a published course is announced', courseRoute.includes("if (!isTest && !isPubliclyVisible(d.course)) return NextResponse.json({ error: 'Publish the course before announcing it.' }"));
  const testAt = courseRoute.indexOf('if (isTest) {');
  check('U23.1d "Send test to me": the same email to the signed-in admin only, one SYSTEM email (sendEmail), before any audience, queue or job', testAt > 0 && courseRoute.slice(testAt, testAt + 600).includes('await sendEmail({ to: by,') && testAt < courseRoute.lastIndexOf('await resolveAudience(') && testAt < courseRoute.indexOf('dispatchAnnouncement(d.sb') && !courseRoute.slice(testAt, testAt + 600).includes("kind: 'announcement'"));
  check('U23.1e the test records nothing as announced (no job, no send log) and the Announce tab offers it', !courseRoute.slice(testAt, testAt + 600).includes('enqueueJob') && readFileSync('app/admin/training-hub/live-training/[code]/CourseAnnounceTab.tsx', 'utf8').includes('data-testid="course-announce-test"') && readFileSync('app/admin/training-hub/live-training/[code]/CourseAnnounceTab.tsx', 'utf8').includes('body: JSON.stringify({ test: true })'));
  check('U23.1f a direct send counts as one system email', readFileSync('src/shared/email/sendEmail.ts', 'utf8').includes("await recordEmailSent('system', Array.isArray(opts.to) ? opts.to.length : 1);"));
  if (hasCreds()) {
    const T = await import('../src/shared/email/templates/liveCourseAnnouncement');
    const t = await T.liveCourseAnnouncementTemplate({ courseTitle: 'REFM', tagline: 'Tag', startDate: 'Tue 1 Dec 2026', sessions: Array.from({ length: 8 }, (_, i) => ({ label: 'Session ' + (i + 1), title: 'T' + (i + 1), when: 'Tue 1 Dec 2026, 7:00 PM KSA' })), courseUrl: 'https://learn.example/training/REFM', cta: 'Enrol in the course' });
    check('U23.1c the email lists all 8 sessions with KSA times, the Enrol link and a {{name}} greeting', [1, 2, 3, 4, 5, 6, 7, 8].every((n) => t.html.includes('Session ' + n)) && t.html.includes('7:00 PM KSA') && t.html.includes('https://learn.example/training/REFM') && t.html.includes('{{name}}'));
  }
  const notify = readFileSync('app/api/admin/live-sessions/[id]/notify/route.ts', 'utf8');
  check('U23.2a a course session cannot send its own announcement (GET and POST refuse it)', (notify.match(/if \(\w+\.course_code\) return NextResponse\.json\(\{ error: 'course_session'/g) ?? []).length === 2);
  check('U23.2b nor trigger the newsletter auto-notify, on create, publish or recording', readFileSync('app/api/admin/live-sessions/route.ts', 'utf8').includes('data.is_published && !data.course_code && await isPublicSession(') && readFileSync('app/api/admin/live-sessions/[id]/route.ts', 'utf8').includes('const announceable = !courseCode && await isPublicSession('));
  check('U23.2c reschedule sends no announcement (only the enrolled students\' reschedule email)', !/sendAutoNewsletter|notify/.test(readFileSync('app/api/admin/live-sessions/[id]/reschedule/route.ts', 'utf8')) && !/sendAutoNewsletter/.test(readFileSync('src/hubs/training/lib/liveCourse/rescheduleApply.ts', 'utf8')));
  check('U23.2d the admin hides Announce on a course session and offers Announce on the course', readFileSync('app/admin/training-hub/live-training/LiveSessionsManager.tsx', 'utf8').includes('!(s as unknown as { course_code?: string | null }).course_code && (') && readFileSync('app/admin/training-hub/live-training/[code]/page.tsx', 'utf8').includes("{ key: 'announce', label: 'Announce' }"));

  // ── Audiences ──
  const A = await import('../src/hubs/training/lib/announcements/audience');
  const now = Date.parse('2026-11-10T12:00:00Z');
  const d = (n: number) => now - n * 864e5;
  const st = (email: string, o: Partial<import('../src/hubs/training/lib/announcements/audience').StudentSignals>) => ({ email, name: email, registrationId: null, createdAt: d(400), lastActivityAt: null, hasCertificate: false, courses: new Set<string>(), ...o });
  const students = [
    st('new@x.com', { createdAt: d(5) }),
    st('watcher@x.com', { lastActivityAt: d(10) }),
    st('cert@x.com', { hasCertificate: true }),
    st('old@x.com', { lastActivityAt: d(60), courses: new Set(['3SFM']) }),
    st('refm@x.com', { lastActivityAt: d(20), courses: new Set(['REFM']) }),
  ];
  const emails = (l: { email: string }[]) => l.map((x) => x.email).sort().join(',');
  check('U23.3a active = signed up, active, or certified in the last 30 days', emails(A.selectAudience(students, { kind: 'active' }, now, 30)) === 'cert@x.com,new@x.com,refm@x.com,watcher@x.com');
  check('U23.3b all students', A.selectAudience(students, { kind: 'all' }, now, 30).length === 5);
  check('U23.3c enrolled in a course / not yet enrolled in it', emails(A.selectAudience(students, { kind: 'enrolled', courseCode: 'refm' }, now, 30)) === 'refm@x.com' && A.selectAudience(students, { kind: 'not_enrolled', courseCode: 'REFM' }, now, 30).length === 4);
  check('U23.3d active in the last N days (custom)', emails(A.selectAudience(students, { kind: 'active_days', days: 7 }, now, 30)) === 'cert@x.com,new@x.com' && A.selectAudience(students, { kind: 'active_days', days: 90 }, now, 30).length === 5);
  const ex = A.applyExclusions(students, { unsubscribed: new Set(['new@x.com']), bounced: new Set(['old@x.com']) });
  check('U23.3e unsubscribed and bounced are always excluded, and counted', ex.kept.length === 3 && ex.excludedUnsubscribed === 1 && ex.excludedBounced === 1);
  check('U23.3f the session and course announcements resolve the audience through the one resolver', notify.includes('await resolveAudience(sb, spec,') && courseRoute.includes('await resolveAudience(d.sb, spec, usage.activeDays)'));

  // ── The daily budget ──
  const B = await import('../src/shared/email/emailBudget');
  check('U23.4a announcements get the cap left, never more than the daily limit left (system emails keep their room)', B.announcementAllowance({ announcementCap: 200, announcement: 150, dailyLimit: 300, total: 280 }) === 20 && B.announcementAllowance({ announcementCap: 200, announcement: 0, dailyLimit: 300, total: 300 }) === 0 && B.announcementAllowance({ announcementCap: 200, announcement: 0, dailyLimit: 300, total: 50 }) === 200);
  const send = readFileSync('src/shared/email/sendEmail.ts', 'utf8');
  check('U23.4b every email is counted: a direct send as system, announcement batches as announcement', send.includes("await recordEmailSent('system',") && send.includes("await recordEmailSent(opts.kind ?? 'system',") && notify.includes("sendEmailBatch(slice, { kind: 'announcement' })") && readFileSync('src/hubs/training/lib/announcements/realDeps.ts', 'utf8').includes("{ kind: 'announcement' }"));
  check('U23.4c system emails are never held back by the budget (only announcements read the allowance)', !/announcementAllowance|todayUsage/.test(send));

  // ── The queue carries over to the next day, oldest first ──
  const Q = await import('../src/hubs/training/lib/announcements/queue');
  const db = fakeDb({ announcement_jobs: [], announcement_job_items: [] });
  const sent: string[] = [];
  let budget = 2;
  const deps = { allowance: async () => budget, send: async (items: { to: string; html: string }[]) => { for (const i of items) sent.push(i.to + (i.html.includes('{{name}}') ? '!token' : '')); budget -= items.length; return items.map(() => ({ ok: true })); } };
  const job = { kind: 'course' as const, ref: 'REFM', label: 'REFM course announcement', audience: {}, subject: 'S', html: '<p>Hi {{name}}</p>' };
  const r1 = await Q.dispatchAnnouncement(db.client, deps, job, ['a', 'b', 'c', 'd', 'e'].map((x) => ({ email: x + '@x.com', name: x })));
  check('U23.5a day 1: today\'s allowance goes now, the rest is queued', r1.sentNow === 2 && r1.queued === 3 && r1.queueAvailable && sent.join() === 'a@x.com,b@x.com');
  // Day 2: a newer job arrives; the older job's items go first.
  for (const j of db.tables.announcement_jobs) j.created_at ??= '2026-11-10T09:00:00Z'; // the database default
  db.tables.announcement_jobs.push({ id: 'zz-newer', created_at: '2999-01-01T00:00:00Z', kind: 'session', ref: 's', label: 'newer', subject: 'S2', html: 'Hi {{name}}', from_address: null, status: 'queued', total: 1, sent: 0, failed: 0 });
  db.tables.announcement_job_items.push({ id: 999, job_id: 'zz-newer', email: 'z@x.com', name: 'z', status: 'pending' });
  budget = 2;
  const r2 = await Q.processAnnouncementQueue(db.client, deps, new Date('2026-11-11T07:00:00Z'));
  check('U23.5b day 2: the queue continues within the new day\'s allowance, OLDEST job first', r2.sent === 2 && sent.slice(2).join() === 'c@x.com,d@x.com' && r2.remaining === 2);
  budget = 10;
  const r3 = await Q.processAnnouncementQueue(db.client, deps, new Date('2026-11-12T07:00:00Z'));
  const firstJob = db.tables.announcement_jobs.find((j) => j.id !== 'zz-newer')!;
  check('U23.5c day 3: the rest goes, the older job finishes before the newer one, each marked done', r3.sent === 2 && sent.slice(4).join() === 'e@x.com,z@x.com' && firstJob.status === 'done' && firstJob.sent === 5 && r3.remaining === 0);
  check('U23.5d every queued email had the name filled (no {{name}} left)', !sent.some((x) => x.endsWith('!token')));
  budget = 0;
  const r4 = await Q.processAnnouncementQueue(db.client, deps);
  check('U23.5e no allowance, nothing sent', r4.sent === 0);
  const noQueue = { ...db.client, from: (t: string) => t === 'announcement_jobs' ? { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'relation "announcement_jobs" does not exist' } }) }) }) } : (db.client as unknown as { from: (t: string) => unknown }).from(t) } as unknown as import('@supabase/supabase-js').SupabaseClient;
  budget = 1; sent.length = 0;
  const r5 = await Q.dispatchAnnouncement(noQueue, deps, job, ['p', 'q', 'r'].map((x) => ({ email: x + '@x.com', name: x })));
  check('U23.5f before migration 255: today\'s allowance is sent, the rest reported as not sent (nothing fails)', !r5.queueAvailable && r5.sentNow === 1 && r5.notSent === 2);
  check('U23.5g the daily cron sends the queue, after the 06:00 system reminders', readFileSync('app/api/cron/newsletter-scheduled/route.ts', 'utf8').includes('processAnnouncementQueue(sb, realQueueDeps(sb))') && /"\/api\/cron\/newsletter-scheduled",\s*"schedule": "0 7 \* \* \*"/.test(readFileSync('vercel.json', 'utf8')) && /"\/api\/cron\/session-reminders",\s*"schedule": "0 6 \* \* \*"/.test(readFileSync('vercel.json', 'utf8')));
  check('U23.6 the admin shows active / inactive students and today\'s usage against the limit', readFileSync('app/admin/training-hub/live-training/AnnouncementAudience.tsx', 'utf8').includes('data-testid="email-budget-students"') && readFileSync('app/admin/training-hub/live-training/AnnouncementAudience.tsx', 'utf8').includes('data-testid="email-budget-usage"') && readFileSync('app/admin/training-hub/live-training/page.tsx', 'utf8').includes('<EmailBudgetPanel />'));
}

async function unit24(): Promise<void> {
  console.log('\n=== Dashboard: REFM in My Courses for everyone, the course view, recordings on their sessions, Live Sessions grouped ===\n');
  const dash = readFileSync('app/training/dashboard/page.tsx', 'utf8');
  const api = readFileSync('app/api/training/live-course/route.ts', 'utf8');
  check('U24.1a My Courses lists every live course offered to the student, enrolled or not', dash.includes('setMyLiveCourses(j.courses ?? [])') && !dash.includes('.filter(c => c.enrolled)') && api.includes('if (!enrolled && !isPubliclyVisible(c)) return null;'));
  check('U24.1b not enrolled: "Enrol free"; enrolled: sessions completed / total; both open the course view in the dashboard', dash.includes("badge={lc.enrolled ? `${p.completed}/${p.total}` : 'Enrol free'}") && dash.includes("onClick={() => navigateTo('live-course', lc.courseCode)}") && dash.includes('<LiveCourseDashboardView key={activeLiveCourse} courseCode={activeLiveCourse}'));
  const view = readFileSync('src/hubs/training/components/dashboard/LiveCourseDashboardView.tsx', 'utf8');
  check('U24.1c the course view: Enrol free at the top (creates the course enrolment), progress once enrolled', view.includes('data-testid="live-course-dashboard-enrol"') && view.includes("fetch('/api/training/enroll'") && view.includes('data-testid="live-course-dashboard-progress"'));
  check('U24.1d each row: number, title, KSA-first time, status, What is in this session (Overview, learn, flow) and a link to the full page', view.includes('<CourseTime iso={s.scheduled_datetime} />') && view.includes('What&apos;s in this session') && view.includes('overview: sec.overview, learnConcepts: sec.learnConcepts, learnHandsOn: sec.learnHandsOn, flow: sec.flow') && view.includes('courseSessionPath(course.courseCode, s.id)'));
  check('U24.1e buttons: Enrol in course / Join live (the shared button), Watch recording, or the lock message; materials after the session for enrolled students', view.includes('<CourseSessionAction ') && view.includes('Watch recording') && view.includes("action.kind === 'locked'") && view.includes('enrolled && s.materialsReleased && s.materials.length > 0'));
  const V = await import('../src/hubs/training/components/dashboard/LiveCourseDashboardView');
  const S = (o: Partial<Parameters<typeof V.dashboardSessionStatus>[0]>) => V.dashboardSessionStatus({ nav: 'upcoming', met: false, enrolled: true, locked: false, ...o });
  check('U24.2a statuses: Upcoming, Live now, Recording available, Locked, Completed', S({}) === 'upcoming' && S({ nav: 'live' }) === 'live' && S({ nav: 'recorded' }) === 'recording' && S({ nav: 'recorded', locked: true }) === 'locked' && S({ nav: 'recorded', met: true }) === 'completed');
  check('U24.2b a visitor (not enrolled) sees a recording as available, never Completed or Locked', S({ nav: 'recorded', enrolled: false, locked: true, met: true }) === 'recording');
  const nav = await import('../src/hubs/training/lib/liveCourse/courseNav');
  const RA = await import('../src/hubs/training/lib/liveCourse/recordingAccess');
  const past = new Date(Date.now() - 3 * 864e5).toISOString();
  const before = { id: 's1', title: 'S1', course_session_no: 1, scheduled_datetime: past, duration_minutes: 150, session_type: 'recorded', youtube_url: null };
  const after = { ...before, youtube_url: RA.RECORDING_MARKER };
  const aBefore = nav.sessionMainAction({ courseCode: 'REFM', sessionId: 's1', status: nav.navStatus(before), enrolled: true, signedIn: true, canRegister: true });
  const aAfter = nav.sessionMainAction({ courseCode: 'REFM', sessionId: 's1', status: nav.navStatus(after), enrolled: true, signedIn: true, canRegister: true });
  check('U24.3a before upload the session says Recording coming soon; after, Watch recording on that same session', aBefore.kind === 'recording-soon' && aAfter.kind === 'watch' && aAfter.href === '/training/REFM/sessions/s1/watch');
  check('U24.3b Live Sessions still shows upcoming and live course sessions for quick joining (and not a recorded one)', RA.showInLiveSessions({ course_code: 'REFM', session_type: 'upcoming', scheduled_datetime: new Date(Date.now() + 864e5).toISOString(), duration_minutes: 150, youtube_url: null }) && !RA.showInLiveSessions({ course_code: 'REFM', session_type: 'recorded', scheduled_datetime: past, duration_minutes: 150, youtube_url: 'x' }));
  const E = (no: number, liveMet: boolean, recordingMet: boolean) => ({ sessionId: 's' + no, no, liveMet, recordingMet, met: liveMet || recordingMet });
  check('U24.3c the unlock rule is unchanged (in order for recording-only, any qualified session for a live attendee)', RA.recordingUnlock([E(1, false, true), E(2, false, false), E(3, false, false)], 's3').message === 'Complete Session 2 to unlock' && RA.recordingUnlock([E(1, true, false), E(2, true, false), E(3, false, false), E(4, true, false)], 's4').unlocked);
  const G = await import('../src/hubs/training/lib/liveCourse/liveSessionsGroups');
  const g = G.groupCourseSessions([{ id: 'a', course_code: 'REFM', course_session_no: 2 }, { id: 'single' }, { id: 'b', course_code: 'REFM', course_session_no: 1 }], [{ courseCode: 'REFM', title: 'Real Estate Financial Modeling', sessionCount: 8 }]);
  check('U24.4a course sessions are grouped under "Real Estate Financial Modeling, 8 sessions", in order; single sessions stay apart', g.courses.length === 1 && g.courses[0].heading === 'Real Estate Financial Modeling, 8 sessions' && g.courses[0].sessions.map((x) => x.id).join() === 'b,a' && g.singles.map((x) => x.id).join() === 'single');
  const panel = readFileSync('src/hubs/training/components/dashboard/LiveSessionsPanel.tsx', 'utf8');
  check('U24.4b the Live Sessions page renders the groups, then single sessions in their usual grid', panel.includes('data-testid="live-sessions-course-group"') && panel.includes('{grouped.singles.map(s => ('));
  if (hasCreds()) {
    const sb = await db();
    const CV = await import('../src/hubs/training/lib/liveCourse/courseView');
    const SC = await import('../src/hubs/training/lib/liveCourse/sessionContent');
    const v = await CV.loadCourseView(sb, { email: 'not-enrolled-verify@example.com', registrationId: 'FMP-NOT-ENROLLED' }, 'REFM');
    check('U24.5a live: a student who is not enrolled opens REFM in the dashboard (not enrolled)', !!v && v.enrolled === false);
    check('U24.5b live: the course view lists all 8 sessions, each with its content, before any recording', !!v && v.sessions.length === 8 && v.sessions.every((x) => { const c = SC.sessionSections(x); return c.overview.length > 0 && c.flow.length > 0; }) && v.sessions.every((x) => !x.youtube_url || x.youtube_url === RA.RECORDING_MARKER));
  }
}

async function unit25(): Promise<void> {
  console.log('\n=== Admin course Sessions list: KSA times, no per-session Registered / Announced ===\n');
  const TM = await import('../src/hubs/training/lib/liveCourse/time');
  check('U25.1 the admin course list reads "1 Dec 2026, 7:00 PM KSA"', TM.adminKsaLabel('2026-12-01T16:00:00Z') === '1 Dec 2026, 7:00 PM KSA');
  const m = readFileSync('app/admin/training-hub/live-training/LiveSessionsManager.tsx', 'utf8');
  check('U25.2 a course Sessions tab shows that label; a single session keeps its own date and time', m.includes('{adminKsaLabel((s as unknown as { scheduled_datetime?: string | null }).scheduled_datetime)}') && m.includes("s.date ? `${s.date} ${s.time ?? ''}`"));
  check('U25.3 a course Sessions tab has no Registered or Announced column; single sessions keep both', m.includes("(courseCode ? ['Title', 'Type', 'Date / Time (KSA)', 'Playlist', 'YouTube', 'Published', 'Actions'] : ['Title', 'Type', 'Date / Time', 'Playlist', 'Registered', 'YouTube', 'Published', 'Announced', 'Actions'])") && (m.match(/\{!courseCode && \(\n\s+<td style=\{\{ padding: '10px 10px' \}\}>/g) ?? []).length === 2);
}

async function unit26(): Promise<void> {
  console.log('\n=== Training Hub device switch, email logo, attendance: host and assistants are not students ===\n');
  const dt = readFileSync('src/shared/auth/deviceTrust.ts', 'utf8');
  check('U26.1a the Training Hub has its own device switch, read ONLY by the Training Hub sign-in; On applies the existing flow unchanged', dt.includes("TRAINING_DEVICE_VERIFICATION_SETTING_KEY = 'training_device_verification'") && dt.includes('return isDeviceVerificationRequired();') && readFileSync('app/api/training/validate/route.ts', 'utf8').includes('if (!trusted && await isTrainingDeviceVerificationRequired())'));
  check('U26.1b Modeling Hub and admin sign-in never read it (they keep the shared rule)', !readFileSync('src/shared/auth/nextauth.ts', 'utf8').includes('isTrainingDeviceVerificationRequired') && readFileSync('src/shared/auth/nextauth.ts', 'utf8').includes('isDeviceVerificationRequired()'));
  check('U26.1c the switch is in admin (Launch Settings, the device verification cards), defaulting On when unset', readFileSync('app/admin/modules/page.tsx', 'utf8').includes('<DeviceVerificationCard onMessage={showToast} scope="training" />') && dt.includes("if ((data?.value ?? 'true') === 'false') return false;"));
  const base = readFileSync('src/shared/email/templates/_base.ts', 'utf8');
  check('U26.2 the email header logo: an https PNG, width as attribute and style, no border, white alt text on the navy band', base.includes('/^https:\\/\\//i.test(b.logo_url)') && base.includes('width="${logoWidth}" border="0"') && base.includes('color:#ffffff;font-family:Arial'));
  const NM = await import('../src/hubs/training/lib/liveCourse/nameMatch');
  check('U26.3a the organizer, a co-organizer and the host account are Host', NM.isHostAttendee({ role: 'Organizer' }) && NM.isHostAttendee({ role: 'Coorganizer' }) && NM.isHostAttendee({ email: 'Host@FMP.com' }, 'host@fmp.com') && !NM.isHostAttendee({ role: 'Attendee', email: 'a@x.com' }, 'host@fmp.com'));
  check('U26.3b assistants, note-takers, Copilot, recorders, facilitators and bots are not students (and a surname like Abbott is not a bot)', ["Ahmad's Assistant", 'Otter Notetaker', 'Note Taker', 'Copilot', 'Meeting Recorder', 'Facilitator', 'Fireflies Bot'].every((n) => NM.isBotAttendee({ name: n })) && NM.isBotAttendee({ email: 'meeting.bot@x.com' }) && !NM.isBotAttendee({ name: 'Sarah Abbott' }) && !NM.isBotAttendee({ name: 'Ahmad Din' }));
  check('U26.3c only an exact or close full-name match is pre-selected; a partial match is a hint', NM.preselectable({ reason: 'exact' }) && NM.preselectable({ reason: 'close' }) && !NM.preselectable({ reason: 'partial' }) && !NM.preselectable(undefined));
  const S = await import('../src/hubs/training/lib/liveCourse/attendanceSync');
  const A = await import('../src/hubs/training/lib/liveCourse/attendance');
  const row = (email: string | null, name: string, role = 'Attendee') => ({ attendee_email: A.attendeeKey(email, name), attendee_name: name, role, intervals: [] as [string, string][], attended_seconds: 7200, session_seconds: 9000, attended_pct: 80 });
  const db = fakeDb({ live_sessions: [{ id: 'h1', course_code: 'REFM' }], training_registrations_meta: [{ registration_id: 'R1', email: 'ahmad@x.com', name: 'Ahmad Din' }], live_session_join_clicks: [{ session_id: 'h1', student_email: 'ahmad@x.com' }], student_email_aliases: [], live_session_attendance: [] });
  const prevHost = process.env.TEAMS_HOST_USER_EMAIL; process.env.TEAMS_HOST_USER_EMAIL = 'ahmad@x.com';
  const res = await S.applyAttendanceRows(db.client, 'h1', [row('ahmad@x.com', 'Ahmad Din', 'Organizer'), row(null, "Ahmad's Assistant"), row(null, 'Ahmad Din')], 'graph');
  if (prevHost === undefined) delete process.env.TEAMS_HOST_USER_EMAIL; else process.env.TEAMS_HOST_USER_EMAIL = prevHost;
  const at = (k: string) => db.tables.live_session_attendance.find((r) => r.attendee_email === k)!;
  check('U26.4a the host is never matched to a student, even when the host account is also a student', at('ahmad@x.com').student_email == null);
  check('U26.4b "Ahmad\'s Assistant" is not matched to Ahmad Din (bot), while a guest typing the full name still is', at("noemail:ahmad's assistant").student_email == null && at('noemail:ahmad din').student_email === 'ahmad@x.com');
  check('U26.4c host and assistants are counted apart, not as unmatched', res.excluded === 2 && res.unmatched === 0, JSON.stringify(res));
  const panel = readFileSync('app/admin/training-hub/live-training/[code]/CourseAttendancePanel.tsx', 'utf8');
  check('U26.4d the admin lists them under Host and assistants, never in Unmatched, and pre-selects only a full-name match', panel.includes('data-testid="admin-not-students"') && panel.includes('!r.student_email && !r.excluded') && panel.includes("useState(preselectable(suggestions[0]) ? suggestions[0].email : '')") && readFileSync('app/api/admin/live-sessions/[id]/attendance/route.ts', 'utf8').includes('!r.excluded && String(r.attendee_email).startsWith('));
}

(async () => {
  await unit0();
  await unit1();
  await unit1b();
  await unit2();
  await unit3();
  await unit4();
  await unit5();
  await unit6();
  await unit7();
  await unit8();
  await unit9();
  await unit10();
  await unit11();
  await unit12();
  await unit13();
  await unit14();
  await unit15();
  await unit16();
  await unit17();
  await unit18();
  await unit19();
  await unit20();
  await unit21();
  await unit22();
  await unit23();
  await unit24();
  await unit25();
  await unit26();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('Failed:'); for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });

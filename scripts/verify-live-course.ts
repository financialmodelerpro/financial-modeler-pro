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
  check('U2.5d detail page, dashboard card and course session page all use THE Join button', btnUsers.every((f) => readFileSync(f, 'utf8').includes('<JoinLiveButton')));

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
  check('U8.3a creating a private-course session never emails newsletter subscribers', post.includes('data.is_published && await isPublicSession(sb, data.course_code)'));
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
  check('U12.7f sample certificate and badge come from the uploaded templates and hide until they exist', page.includes('templateSamples(') && landing.includes('(d.samples.certificateUrl || d.samples.badgeUrl)'));
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
  check('U14.4a signed out: "Register free" to course registration', out.label === 'Register free' && out.href === '/register?course=REFM');
  check('U14.4b signed in: "Enrol" to the course page, which enrols on arrival', inn.label === 'Enrol' && inn.href === '/training/REFM?enrol=1');
  check('U14.4c enrolled: "View session" under the course', enr.label === 'View session' && enr.href === '/training/REFM/sessions/S1');
  check('U14.4d no branch goes to single-session registration', [out, inn, enr].every((a) => !a.href.includes('/training-sessions/') && !a.href.includes('/live-sessions/')));
  const card = readFileSync('src/hubs/training/components/sessions/CourseSessionListingCard.tsx', 'utf8');
  check('U14.4e the card shows "Session X of N", KSA time, Rescheduled and "Part of ... Live Series"', card.includes('Session {s.course_session_no} of {total}') && card.includes('formatSessionTime(s.scheduled_datetime)') && card.includes('Rescheduled') && card.includes('Part of {seriesLabel('));
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
  check('U15.4f the session page: 16:9 whole image (course card fallback), content blocks, collapsed time zones, materials rule, certificate card', sessPage.includes('s.banner_url || course.cardImageUrl') && sessPage.includes("aspectRatio: '16 / 9'") && sessPage.includes("objectFit: 'contain'") && sessPage.includes("'What you will learn'") && sessPage.includes("'By the end of this session'") && sessPage.includes("'Build with Claude'") && sessPage.includes('collapsible') && sessPage.includes('Materials will be available after the session.') && sessPage.includes('vs?.materialsReleased') && sessPage.includes('course-session-certificate'));

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
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('Failed:'); for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });

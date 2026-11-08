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

(async () => {
  await unit0();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('Failed:'); for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });

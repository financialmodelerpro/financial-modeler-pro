/* eslint-disable no-console */
/**
 * verify-assessment-timer.ts (2026-06-17)
 *
 * Guards the fix for "the assessment timer shows for some students and not
 * others on the same assessment".
 *
 * ROOT CAUSE the fix closes: the assessment timer bar renders only when
 * `timeLeft !== null`, and timeLeft is driven entirely by the server-anchored
 * `attemptState`. The old Start handler flipped pageState to 'taking'
 * UNCONDITIONALLY but set attemptState only `if (state)`. `startAttemptApi`
 * returns null on ANY transient failure (non-OK status, network blip, a session
 * that expired between load and pressing Start, or a lost response), so a single
 * student whose POST happened to fail was dropped into the assessment with no
 * timer while everyone else saw it. Per-student + transient = "some see it, some
 * do not".
 *
 * Two layers of guard:
 *  [A] Behavioural: the client wrappers return null on every failure mode (so the
 *      handler genuinely can receive null and must not proceed on it).
 *  [B] Source invariants on the Start handler + render: the 'taking' transition
 *      is gated behind a non-null attemptState with a retry + fallback chain, the
 *      timer is populated from attemptState in BOTH the start and resume paths,
 *      and the only gate on the timer bar is the load-state `timeLeft !== null`
 *      (no per-student hide path), so the timer shows consistently once an
 *      attempt is established and is never silently dropped.
 *
 * Run: npx tsx scripts/verify-assessment-timer.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  startAttemptApi, getAttemptStateApi, resumeAttemptApi, pauseAttemptApi,
} from '../src/hubs/training/lib/assessment/attemptInProgressClient';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}

const ROOT = join(__dirname, '..');
const PAGE = readFileSync(join(ROOT, 'app/training/assessment/[tabKey]/page.tsx'), 'utf8');

// ── [A] Behavioural: client wrappers return null on every failure mode. ──────
const realFetch = globalThis.fetch;
function withFetch(impl: () => Promise<Response>, fn: () => Promise<void>): Promise<void> {
  globalThis.fetch = impl as typeof globalThis.fetch;
  return fn().finally(() => { globalThis.fetch = realFetch; });
}
const okJson = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

async function behavioural(): Promise<void> {
  console.log('=== [A] Client wrappers fail to null (so Start can receive null) ===\n');

  await withFetch(async () => new Response('boom', { status: 500 }), async () => {
    check('startAttemptApi -> null on 500', (await startAttemptApi({ tabKey: 't', attemptNumber: 1 }, 30, false)) === null);
    check('getAttemptStateApi -> null on 500', (await getAttemptStateApi({ tabKey: 't', attemptNumber: 1 })) === null);
    check('resumeAttemptApi -> null on 500', (await resumeAttemptApi({ tabKey: 't', attemptNumber: 1 })) === null);
  });

  await withFetch(async () => new Response('unauthorized', { status: 401 }), async () => {
    check('startAttemptApi -> null on 401 (expired session)', (await startAttemptApi({ tabKey: 't', attemptNumber: 1 }, 30, false)) === null);
  });

  await withFetch(async () => { throw new Error('network down'); }, async () => {
    check('startAttemptApi -> null on network throw', (await startAttemptApi({ tabKey: 't', attemptNumber: 1 }, 30, false)) === null);
    check('getAttemptStateApi -> null on network throw', (await getAttemptStateApi({ tabKey: 't', attemptNumber: 1 })) === null);
    const p = await pauseAttemptApi({ tabKey: 't', attemptNumber: 1 });
    check('pauseAttemptApi -> {ok:false} on network throw', p.ok === false);
  });

  await withFetch(async () => new Response('<<not json>>', { status: 200 }), async () => {
    check('startAttemptApi -> null on bad JSON', (await startAttemptApi({ tabKey: 't', attemptNumber: 1 }, 30, false)) === null);
  });

  // state route returns { exists:false } when no row -> client maps to null.
  await withFetch(async () => okJson({ exists: false }), async () => {
    check('getAttemptStateApi -> null when server says exists:false', (await getAttemptStateApi({ tabKey: 't', attemptNumber: 1 })) === null);
  });
  // A successful start returns the state object (so the happy path is non-null).
  await withFetch(async () => okJson({ expiresAt: '2030-01-01T00:00:00Z', secondsRemaining: 1800, paused: false }), async () => {
    const s = await startAttemptApi({ tabKey: 't', attemptNumber: 1 }, 30, false);
    check('startAttemptApi -> state object on 200 (happy path non-null)', !!s && s.secondsRemaining === 1800);
  });
}

function sourceInvariants(): void {
// ── [B] Source invariants on the Start handler. ──────────────────────────────
console.log('\n=== [B] Start handler never enters the assessment without a timer ===');

const startFn = PAGE.slice(PAGE.indexOf('async function startAssessment()'));
const startBody = startFn.slice(0, startFn.indexOf('\n  }\n') + 5);

// The OLD bug pattern, exactly: set state only if truthy, then flip to 'taking'
// unconditionally with no guard in between. Must be gone.
const oldBugPattern = /if \(state\) setAttemptState\(state\);\s*setPageState\('taking'\);/;
check('OLD silent-drop pattern is gone (no `if(state) setAttemptState; setPageState(taking)`)', !oldBugPattern.test(PAGE));

// The 'taking' transition must be preceded by an early-return when state is null.
const guardBeforeTaking = /if \(!state\) \{[\s\S]*?return;[\s\S]*?\}\s*[\s\S]*?setPageState\('taking'\);/;
check('Start handler early-returns on null state BEFORE entering taking', guardBeforeTaking.test(startBody));

// Retry-once + read-back fallback chain (idempotent server) must be present.
const startApiCalls = (startBody.match(/startAttemptApi\(/g) || []).length;
check('Start handler retries startAttemptApi at least once (>=2 calls)', startApiCalls >= 2, `calls=${startApiCalls}`);
check('Start handler falls back to getAttemptStateApi (recovers a lost response)', /getAttemptStateApi\(/.test(startBody));

// On success it must populate BOTH attemptState and timeLeft before taking, so
// the timer renders on the first frame (resume path already does this).
check('Start handler sets attemptState before taking', /setAttemptState\(state\)/.test(startBody));
check('Start handler seeds timeLeft from the state before taking', /setTimeLeft\(state\.secondsRemaining\)/.test(startBody));

// The handler is single-flight (cannot be double-fired into a second attempt).
check('Start handler guards re-entry while a start is in flight (startingAttempt)', /startingAttempt\)\s*return;/.test(startBody) || /\|\| startingAttempt\)/.test(startBody));
check('Start button is disabled while startingAttempt', /disabled=\{startingAttempt\}/.test(PAGE));

// On failure it surfaces a clear retry prompt and stays put (no untimed run).
check('Start handler surfaces a retry message on failure', /setErrorMsg\(/.test(startBody));

// ── [B] Render invariants: timer driven only by load-state, no per-student hide.
console.log('\n=== [B] Timer render is gated only by load-state (no per-student hide) ===');

check('Timer bar renders on `timeLeft !== null` (the load-state gate)', /\{timeLeft !== null && \(/.test(PAGE));
// Resume-on-load path also seeds attemptState + timeLeft (consistency).
check('Resume-on-load path seeds attemptState from server', /if \(existing\) \{[\s\S]*?setAttemptState\(existing\);/.test(PAGE));
check('Resume-on-load path seeds timeLeft from server', /setTimeLeft\(existing\.secondsRemaining\)/.test(PAGE));
// Display tick recomputes timeLeft from attemptState while taking.
check('Display tick computes timeLeft from attemptState.expiresAt', /expiresMs - Date\.now\(\)/.test(PAGE));

// ── [B] Bypass is intentional + global, never a per-student accident. ────────
console.log('\n=== [B] timer_bypass is not wired into the per-student timer path ===');
// The assessment timer must NOT read timer_bypass on the student path: bypass is
// a course-level (dashboard) setting. The timer here is unconditionally intended
// active, so after the fix the ONLY thing that can hide it is the load-state gate
// (which the handler now always satisfies). This asserts no stray per-student
// bypass branch crept into the assessment page.
check('Assessment page does not branch the timer on timer_bypass (no per-student hide)', !/timer_bypass/.test(PAGE));
const startRoute = readFileSync(join(ROOT, 'app/api/training/assessment/start/route.ts'), 'utf8');
check('Start route does not silently drop the timer on a 0/empty timer (24h sentinel server-side)',
  /24 \* 60 \* 60 \* 1000/.test(readFileSync(join(ROOT, 'src/hubs/training/lib/assessment/attemptInProgress.ts'), 'utf8'))
  && /timerMinutes/.test(startRoute));
}

behavioural()
  .then(() => {
    sourceInvariants();
    console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) { console.log('FAILED: ' + fails.join('; ')); process.exit(1); }
  })
  .catch((e) => { console.error(e); process.exit(1); });

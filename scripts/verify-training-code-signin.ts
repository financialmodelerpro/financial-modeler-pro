/**
 * verify-training-code-signin.ts (2026-09-26)
 *
 * A student who signs in with the emailed device code must be signed in on the
 * SERVER too. Until 2026-09-26 only the trusted-device path set the
 * `training_session` cookie; the code path stored a localStorage session alone,
 * so every cookie-gated API answered 401 and the assessment page said "check
 * your connection" (measured: 190 of 200 starts in seven days were 401; one
 * student signed in by code eleven times and never started).
 *
 *   A. ONE ISSUER: the session cookie is set only through
 *      setTrainingSessionCookie, and BOTH sign-in paths call it.
 *   B. THE CODE IS A SECOND FACTOR, NOT A BYPASS: device-verify issues a
 *      session only with validate's signed pending cookie for the same email;
 *      the rule is RUN on a real, a forged, an expired, a wrong-email and a
 *      missing cookie, and the check sits BEFORE the code is looked up or spent.
 *   C. THE PAGE TELLS THE TRUTH: the assessment page reads the session through
 *      the shared reader (which honours expiry) and says "sign in again" on a
 *      401 instead of blaming the connection, and does not retry a 401.
 *
 * The live end-to-end (real code sign-in on production, then a timed start) is
 * scripts/probe-training-code-signin-live.ts, which writes and removes rows.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-training-code-signin.ts
 *
 * No em dashes in this file.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

process.env.NEXTAUTH_SECRET ??= 'verify-training-code-signin-secret';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const src = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'node_modules' && !n.startsWith('.')) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(n)) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

(async () => {
  const mod = await import('../src/hubs/training/lib/session/issueTrainingSession');
  const validate = src('app/api/training/validate/route.ts');
  const verify = src('app/api/training/device-verify/route.ts');

  console.log('=== A. One issuer, called by both sign-in paths ===');
  check('A1 validate issues the session through the shared issuer', /setTrainingSessionCookie\(response, email, regId\)/.test(validate));
  check('A2 device-verify issues the SAME session on a correct code',
    /setTrainingSessionCookie\(response, pending\.email, pending\.registrationId\)/.test(verify));
  const setters = [...walk('app'), ...walk('src')].filter((f) =>
    /cookies\.set\(\s*['"]training_session['"]/.test(src(f)) || /cookies\.set\(\s*TRAINING_SESSION_COOKIE/.test(src(f)));
  check('A3 nothing else sets the session cookie itself', setters.length === 1 && setters[0].endsWith('issueTrainingSession.ts'), setters.join(', '));
  const res = NextResponse.json({});
  mod.setTrainingSessionCookie(res, 'a@b.test', 'REG1');
  const c = res.cookies.get('training_session');
  check('A4 the cookie is httpOnly, path /, one hour, and carries the email and id the start route reads',
    !!c && c.httpOnly === true && c.path === '/' && c.maxAge === 3600
    && JSON.parse(c.value).email === 'a@b.test' && JSON.parse(c.value).registrationId === 'REG1');

  console.log('\n=== B. The code finishes a password sign-in, it never replaces one ===');
  const pend = NextResponse.json({});
  const t0 = 1_800_000_000_000;
  mod.setDevicePendingCookie(pend, 'Student@X.test', 'REG9', t0);
  const pc = pend.cookies.get(mod.DEVICE_PENDING_COOKIE);
  check('B1 validate\'s pending cookie is httpOnly, scoped to /api/training, short-lived',
    !!pc && pc.httpOnly === true && pc.path === '/api/training' && (pc.maxAge ?? 0) > 600 && (pc.maxAge ?? 0) <= 1800);
  const good = mod.readDevicePending(pc?.value, 'student@x.test', t0 + 60_000);
  check('B2 a real cookie for the same email reads back its email and id', good?.email === 'student@x.test' && good?.registrationId === 'REG9');
  const [payload, sig] = String(pc?.value).split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ e: 'student@x.test', r: 'OTHER', x: t0 + 9e9 })).toString('base64url');
  check('B3 a forged payload is refused', mod.readDevicePending(`${forgedPayload}.${sig}`, 'student@x.test', t0) === null);
  check('B4 a tampered signature is refused', mod.readDevicePending(`${payload}.${sig.slice(0, -2)}xx`, 'student@x.test', t0) === null);
  check('B5 an expired cookie is refused', mod.readDevicePending(pc?.value, 'student@x.test', t0 + 16 * 60_000) === null);
  check('B6 a cookie for another email is refused', mod.readDevicePending(pc?.value, 'someone@else.test', t0) === null);
  check('B7 no cookie, or garbage, is refused',
    mod.readDevicePending(undefined, 'student@x.test', t0) === null && mod.readDevicePending('abc', 'student@x.test', t0) === null);
  const iPending = verify.indexOf('readDevicePending(');
  const iOtp = verify.indexOf(".from('training_email_otps')", verify.indexOf("action === 'check'"));
  check('B8 device-verify checks the pending cookie BEFORE it looks up or spends the code', iPending > 0 && iOtp > iPending);
  check('B9 validate sets the pending cookie exactly where it asks for the code',
    /requiresDeviceVerification: true,[\s\S]{0,120}\}\);\s*setDevicePendingCookie\(pending, email, regId\);\s*return pending;/.test(validate));
  check('B10 the session identity comes from the pending cookie, not the request body',
    !/setTrainingSessionCookie\([^)]*body\./.test(verify) && !/registrationId, code \} = body/.test(verify));

  console.log('\n=== C. The assessment page tells the truth ===');
  const page = src('app/training/assessment/[tabKey]/page.tsx');
  check('C1 it reads the session through the shared reader, which honours expiry',
    /const getTrainingSession = readTrainingSession;/.test(page) && !/localStorage\.getItem\('training_session'\)/.test(page));
  check('C2 a 401 says "sign in again", clears the stale local session, and is not retried',
    /result\.signedOut/.test(page) && /Please sign in again to start the assessment/.test(page)
    && /clearTrainingSession\(\)/.test(page) && /if \(!result\.state && !result\.signedOut\) result = await startAttemptResult/.test(page));
  check('C3 the connection message is kept for what it means, a failure that is not a 401',
    /if \(!state\) \{\s*setErrorMsg\('We could not start your timed attempt\. Please check your connection/.test(page));
  const client = src('src/hubs/training/lib/assessment/attemptInProgressClient.ts');
  check('C4 the client reports a 401 as signed out, and startAttemptApi keeps its shape for the live-session page',
    /res\.status === 401\) return \{ state: null, signedOut: true \}/.test(client)
    && /return \(await startAttemptResult\(idn, timerMinutes, isFinal\)\)\.state;/.test(client));

  console.log('\n=== G. House rules ===');
  for (const f of ['src/hubs/training/lib/session/issueTrainingSession.ts', 'app/api/training/validate/route.ts',
    'app/api/training/device-verify/route.ts', 'app/training/assessment/[tabKey]/page.tsx',
    'src/hubs/training/lib/assessment/attemptInProgressClient.ts', 'scripts/verify-training-code-signin.ts']) {
    check(`G ${f} has no em dashes`, !src(f).includes(String.fromCharCode(0x2014)));
  }

  console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
  if (failed) { console.log(fails.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
})();

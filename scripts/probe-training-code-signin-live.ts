/**
 * probe-training-code-signin-live.ts (2026-09-26)
 *
 * End to end ON PRODUCTION, as a probe student who signs in with a password on
 * a NEW device and the emailed code, then presses Start on a timed assessment.
 * Every step goes through production's own routes: the password step is
 * production's validate, so the pending cookie is signed with production's
 * secret (a locally minted one is refused, which is the point of signing it).
 *
 *   0. validate with the right password on an untrusted device asks for the
 *      code and sets the pending cookie;
 *   1. device-verify WITHOUT the password step's pending cookie is refused, and
 *      the code is NOT spent (the code is a second factor, not a bypass);
 *   2. device-verify WITH it signs the probe in on the server (training_session
 *      cookie set, which is exactly what was missing);
 *   3. that cookie starts the assessment: a row is written with the timer the
 *      page would send, and the state route's clock counts down;
 *   4. everything the probe wrote is removed, and the removal is re-read.
 *
 * WRITES to production, all removed and re-read as gone: one probe student
 * (registration meta + password hash), one code, one attempt row. The probe
 * email is on the reserved .invalid domain, so no mail can be delivered and it
 * cannot collide with a student; the code is written straight to the table,
 * never sent. Not in the suite: run it on purpose.
 *
 * Run: npx tsx --env-file=.env.local scripts/probe-training-code-signin-live.ts
 *   BASE (default https://learn.financialmodelerpro.com), TAB (default 3SFM_S1)
 *
 * No em dashes in this file.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { DEVICE_PENDING_COOKIE } from '../src/hubs/training/lib/session/issueTrainingSession';

const BASE = process.env.BASE ?? 'https://learn.financialmodelerpro.com';
const TAB = process.env.TAB ?? '3SFM_S1';
const EMAIL = 'probe-code-signin@fmp-verify.invalid';
const REG = 'PROBE-CODESIGNIN';

let passed = 0, failed = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function cleanup(): Promise<void> {
  await sb.from('assessment_attempts_in_progress').delete().eq('email', EMAIL);
  await sb.from('training_email_otps').delete().eq('email', EMAIL);
  await sb.from('trusted_devices').delete().eq('identifier', EMAIL);
  await sb.from('training_passwords').delete().eq('registration_id', REG);
  await sb.from('training_registrations_meta').delete().eq('registration_id', REG);
}

(async () => {
  console.log(`Probe against ${BASE}, assessment ${TAB}\n`);
  await cleanup();
  try {
    const password = crypto.randomBytes(18).toString('base64url');
    const meta = await sb.from('training_registrations_meta').insert({
      registration_id: REG, email: EMAIL, name: 'Probe Code Sign-in', phone: '+00000000000',
      city: 'Probe', country: 'Probe', email_confirmed: true, confirmed_at: new Date().toISOString(),
    });
    const pw = await sb.from('training_passwords').insert({ registration_id: REG, password_hash: await bcrypt.hash(password, 10) });
    check('0a probe student written', !meta.error && !pw.error, meta.error?.message ?? pw.error?.message);

    const val = await fetch(`${BASE}/api/training/validate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: EMAIL, password, secondField: REG }),
    });
    const valJson = await val.json().catch(() => ({})) as { requiresDeviceVerification?: boolean; error?: string };
    const pendingSet = val.headers.getSetCookie().find((c) => c.startsWith(`${DEVICE_PENDING_COOKIE}=`));
    check('0b the right password on a new device asks for the code and sets production\'s pending cookie',
      valJson.requiresDeviceVerification === true && !!pendingSet
      && !val.headers.getSetCookie().some((c) => c.startsWith('training_session=')),
      `status ${val.status} ${JSON.stringify(valJson).slice(0, 160)}`);
    if (!pendingSet) throw new Error('no pending cookie from validate, cannot continue');
    const pendingValue = pendingSet.split(';')[0].slice(DEVICE_PENDING_COOKIE.length + 1);

    const code = String(crypto.randomInt(100000, 999999));
    const ins = await sb.from('training_email_otps').insert({
      email: EMAIL, code, used: false, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    check('0 probe code written', !ins.error, ins.error?.message);

    const body = JSON.stringify({ action: 'check', email: EMAIL, registrationId: REG, code, trustDevice: false });
    const noPending = await fetch(`${BASE}/api/training/device-verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const unspent = await sb.from('training_email_otps').select('used').eq('email', EMAIL).eq('code', code).maybeSingle();
    check('1 a code with no password step is refused (401) and NOT spent',
      noPending.status === 401 && unspent.data?.used === false, `status ${noPending.status}, used ${unspent.data?.used}`);

    const ok = await fetch(`${BASE}/api/training/device-verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `${DEVICE_PENDING_COOKIE}=${pendingValue}` }, body,
    });
    const okJson = await ok.json().catch(() => ({})) as { success?: boolean; error?: string };
    const setCookies = ok.headers.getSetCookie();
    const session = setCookies.find((c) => c.startsWith('training_session='));
    check('2 with the password step, the code signs the probe in ON THE SERVER (training_session set)',
      ok.status === 200 && okJson.success === true && !!session, `status ${ok.status} ${okJson.error ?? ''} cookies: ${setCookies.map((c) => c.split('=')[0]).join(',')}`);
    check('2b the session is httpOnly and the pending cookie is cleared',
      !!session && /HttpOnly/i.test(session) && setCookies.some((c) => c.startsWith(`${DEVICE_PENDING_COOKIE}=;`) || /training_device_pending=;|training_device_pending=(?:;|$)/.test(c)));
    if (!session) throw new Error('no session cookie, cannot continue');
    const cookie = session.split(';')[0];

    const q = await fetch(`${BASE}/api/training/questions?tabKey=${TAB}&email=${encodeURIComponent(EMAIL)}&regId=${REG}&shuffle=false`, { headers: { Cookie: cookie } });
    const qj = await q.json().catch(() => ({})) as { timeLimit?: number; questions?: unknown[]; isFinal?: boolean };
    const timerMin = qj.timeLimit || qj.questions?.length || 30;
    console.log(`     (the page would send a ${timerMin}-minute timer: timeLimit ${qj.timeLimit ?? 'none'}, ${qj.questions?.length ?? 0} questions)`);

    const start = await fetch(`${BASE}/api/training/assessment/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ tabKey: TAB, attemptNumber: 1, timerMinutes: timerMin, isFinal: qj.isFinal ?? false }),
    });
    const sj = await start.json().catch(() => ({})) as { secondsRemaining?: number; expiresAt?: string; startedAt?: string; error?: string };
    check('3 Start returns 200 with the timer running', start.status === 200 && typeof sj.secondsRemaining === 'number'
      && sj.secondsRemaining > timerMin * 60 - 30 && sj.secondsRemaining <= timerMin * 60,
      `status ${start.status} ${sj.error ?? ''} secondsRemaining ${sj.secondsRemaining}`);

    const row = await sb.from('assessment_attempts_in_progress').select('*').eq('email', EMAIL).eq('tab_key', TAB).maybeSingle();
    const span = row.data ? (new Date(row.data.expires_at).getTime() - new Date(row.data.started_at).getTime()) / 60_000 : NaN;
    check('3b a row is written for the probe with the timer as its deadline', !!row.data && Math.abs(span - timerMin) < 0.01, `span ${span} min`);

    await new Promise((r) => setTimeout(r, 2500));
    const st = await fetch(`${BASE}/api/training/assessment/state?tabKey=${TAB}&attemptNumber=1`, { headers: { Cookie: cookie } });
    const stj = await st.json().catch(() => ({})) as { exists?: boolean; secondsRemaining?: number };
    check('3c the server clock counts down', st.status === 200 && stj.exists === true
      && typeof stj.secondsRemaining === 'number' && stj.secondsRemaining < (sj.secondsRemaining ?? 0),
      `${sj.secondsRemaining} -> ${stj.secondsRemaining}`);
  } catch (e) {
    check('probe ran to the end', false, e instanceof Error ? e.message : String(e));
  } finally {
    await cleanup();
    const counts = await Promise.all([
      sb.from('assessment_attempts_in_progress').select('id', { count: 'exact', head: true }).eq('email', EMAIL),
      sb.from('training_email_otps').select('id', { count: 'exact', head: true }).eq('email', EMAIL),
      sb.from('trusted_devices').select('id', { count: 'exact', head: true }).eq('identifier', EMAIL),
      sb.from('training_passwords').select('registration_id', { count: 'exact', head: true }).eq('registration_id', REG),
      sb.from('training_registrations_meta').select('registration_id', { count: 'exact', head: true }).eq('registration_id', REG),
    ]);
    const left = counts.map((c) => c.count);
    check('4 everything the probe wrote is gone (attempts, codes, trusted devices, password, student re-read as zero)',
      left.every((n) => n === 0), `${left.join(', ')}`);
    console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
  }
})();

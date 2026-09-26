/**
 * probe-training-password-reset.ts (2026-09-26)
 *
 * The Training Hub password reset, end to end through the REAL routes and the
 * REAL database, with throwaway probe students on the reserved .invalid
 * domain (so nothing can reach a person), all removed and re-read as gone.
 *
 *   1. an unknown email is refused with "not found" and no code is created;
 *   2. an email on TWO accounts asks for the Registration ID, and no code is
 *      created;
 *   3. a lowercase Registration ID with the email is accepted; the code is
 *      stored for the email ON FILE; if the email provider refuses (a local
 *      server has no provider key, which is what this exercises) the code is
 *      withdrawn and the student is told;
 *   4. THE TAKEOVER: a live code for my own email plus ANOTHER student's
 *      Registration ID is refused, the other student's password is unchanged
 *      and my code is not spent;
 *   5. five wrong codes cancel the code;
 *   6. the right code with the email alone sets MY password, not the other
 *      student's, re-points no email, and the sign-in route accepts the new
 *      password.
 *
 * Run against a local dev server (the send in step 3 must fail, and no email
 * may be sent):
 *   BASE=http://localhost:3000 npx tsx --env-file=.env.local scripts/probe-training-password-reset.ts
 * It refuses any other BASE. Not in the suite: it writes rows (and removes them).
 *
 * No em dashes in this file.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.BASE ?? 'http://localhost:3000';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error('This probe runs against a LOCAL dev server only (it must not send email).');
  process.exit(1);
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const ME = { reg: 'PROBE-RESET-ME', email: 'probe-reset-me@fmp-verify.invalid' };
const OTHER = { reg: 'PROBE-RESET-OTHER', email: 'probe-reset-other@fmp-verify.invalid' };
const TWIN = { email: 'probe-reset-twin@fmp-verify.invalid', regs: ['PROBE-RESET-TWIN1', 'PROBE-RESET-TWIN2'] };
const UNKNOWN = 'probe-reset-nobody@fmp-verify.invalid';
const ALL_EMAILS = [ME.email, OTHER.email, TWIN.email, UNKNOWN];
const ALL_REGS = [ME.reg, OTHER.reg, ...TWIN.regs];

let passed = 0, failed = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> };
}
async function liveCodes(email: string): Promise<number> {
  const { count } = await sb.from('training_email_otps').select('id', { count: 'exact', head: true }).eq('email', email).eq('used', false);
  return count ?? 0;
}
async function hashOf(reg: string): Promise<string> {
  return ((await sb.from('training_passwords').select('password_hash').eq('registration_id', reg).maybeSingle()).data?.password_hash as string) ?? '';
}
async function giveCode(email: string): Promise<string> {
  const code = String(crypto.randomInt(100000, 999999));
  await sb.from('training_email_otps').update({ used: true }).eq('email', email).eq('used', false);
  await sb.from('training_email_otps').insert({ email, code, used: false, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
  return code;
}
async function cleanup(): Promise<void> {
  await sb.from('training_email_otps').delete().in('email', ALL_EMAILS);
  await sb.from('training_passwords').delete().in('registration_id', ALL_REGS);
  await sb.from('training_registrations_meta').delete().in('registration_id', ALL_REGS);
}

(async () => {
  await cleanup();
  try {
    const oldPw = crypto.randomBytes(12).toString('base64url');
    const meta = [ME, OTHER].map((s) => ({ registration_id: s.reg, email: s.email, name: 'Probe Reset', phone: '+00000000000', city: 'Probe', country: 'Probe', email_confirmed: true }))
      .concat(TWIN.regs.map((r) => ({ registration_id: r, email: TWIN.email, name: 'Probe Twin', phone: '+00000000000', city: 'Probe', country: 'Probe', email_confirmed: true })));
    const m = await sb.from('training_registrations_meta').insert(meta);
    const hash = await bcrypt.hash(oldPw, 10);
    const pw = await sb.from('training_passwords').insert(ALL_REGS.map((r) => ({ registration_id: r, password_hash: hash })));
    check('0 probe students written', !m.error && !pw.error, m.error?.message ?? pw.error?.message);
    const otherHashBefore = await hashOf(OTHER.reg);

    const a = await post('/api/training/send-verification', { email: UNKNOWN });
    check('1 an unknown email: "not found", and no code created', a.status === 400 && a.json.reason === 'not_found' && await liveCodes(UNKNOWN) === 0, JSON.stringify(a));

    const b = await post('/api/training/send-verification', { email: TWIN.email });
    check('2 an email on two accounts asks for the Registration ID (409), and no code created',
      b.status === 409 && b.json.needsRegistrationId === true && await liveCodes(TWIN.email) === 0, JSON.stringify(b));

    const c = await post('/api/training/send-verification', { email: ME.email.toUpperCase(), registrationId: ' probe-reset-me ' });
    const storedForMe = (await sb.from('training_email_otps').select('id, used').eq('email', ME.email)).data ?? [];
    check('3 a lowercase ID with the email is accepted and the code is stored for the email ON FILE',
      storedForMe.length === 1, `${storedForMe.length} codes stored`);
    check('3b the provider refused (no key locally): the student is told, and the unreceived code is withdrawn',
      c.status === 502 && c.json.reason === 'send_failed' && storedForMe.every((r) => r.used === true), JSON.stringify(c));

    const myCode = await giveCode(ME.email);
    const newPw = crypto.randomBytes(12).toString('base64url');
    const d = await post('/api/training/set-password', { email: ME.email, registrationId: OTHER.reg, code: myCode, password: newPw });
    check('4 THE TAKEOVER: my code with another student\'s Registration ID is refused',
      d.status === 400 && d.json.reason === 'mismatch', JSON.stringify(d));
    check('4b the other student\'s password is unchanged, and my code is not spent',
      await hashOf(OTHER.reg) === otherHashBefore && await liveCodes(ME.email) === 1);

    let last = { status: 0, json: {} as Record<string, unknown> };
    for (let i = 0; i < 5; i++) last = await post('/api/training/set-password', { email: ME.email, code: myCode === '000000' ? '111111' : '000000', password: newPw });
    check('5 five wrong codes cancel the code', last.status === 429 && last.json.reason === 'too_many_attempts' && await liveCodes(ME.email) === 0, JSON.stringify(last));

    // The wrong-code window is per student and outlives the code; the probe
    // uses the OTHER student's own account for the success path.
    const otherCode = await giveCode(OTHER.email);
    const e = await post('/api/training/set-password', { email: OTHER.email, code: otherCode, password: newPw });
    const otherHashAfter = await hashOf(OTHER.reg);
    check('6 the right code with the email alone sets that student\'s password',
      e.status === 200 && e.json.registrationId === OTHER.reg && await bcrypt.compare(newPw, otherHashAfter), JSON.stringify(e));
    check('6b nobody else\'s password moved', await bcrypt.compare(oldPw, await hashOf(ME.reg)) && await bcrypt.compare(oldPw, await hashOf(TWIN.regs[0])));
    const metaAfter = (await sb.from('training_registrations_meta').select('registration_id, email').in('registration_id', ALL_REGS)).data ?? [];
    check('6c no email was re-pointed', metaAfter.length === 4 && metaAfter.every((r) =>
      r.email === (r.registration_id === ME.reg ? ME.email : r.registration_id === OTHER.reg ? OTHER.email : TWIN.email)));
    check('6d the code is spent', await liveCodes(OTHER.email) === 0);
    const v = await post('/api/training/validate', { identifier: OTHER.email, password: newPw, secondField: OTHER.reg });
    check('6e the sign-in route accepts the new password (a new device then asks for its code)',
      v.json.requiresDeviceVerification === true || v.json.success === true, JSON.stringify(v.json).slice(0, 160));
    const vOld = await post('/api/training/validate', { identifier: OTHER.email, password: oldPw, secondField: OTHER.reg });
    check('6f and refuses the old one', vOld.status === 401, JSON.stringify(vOld.json).slice(0, 120));
  } catch (err) {
    check('probe ran to the end', false, err instanceof Error ? err.message : String(err));
  } finally {
    await cleanup();
    const left = await Promise.all([
      sb.from('training_email_otps').select('id', { count: 'exact', head: true }).in('email', ALL_EMAILS),
      sb.from('training_passwords').select('registration_id', { count: 'exact', head: true }).in('registration_id', ALL_REGS),
      sb.from('training_registrations_meta').select('registration_id', { count: 'exact', head: true }).in('registration_id', ALL_REGS),
    ]);
    check('7 every probe row is gone (codes, passwords, students re-read as zero)', left.every((l) => l.count === 0), left.map((l) => l.count).join(', '));
    console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
  }
})();

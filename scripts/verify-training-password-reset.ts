/**
 * verify-training-password-reset.ts (2026-09-26)
 *
 * Students reported "I try to reset my password and never get the email".
 * Measured over seven days: 11 of 13 reset and forgot-ID requests were
 * refused BEFORE any email was sent. This pins the rebuild:
 *
 *   A. ONE identity rule (studentLookup.resolveStudent), RUN: the email alone
 *      identifies a student on one account; a lowercase Registration ID still
 *      matches; two accounts on one email ask for the ID instead of "not
 *      found"; an ID with another student's email is refused with the SAME
 *      words as not-found (never confirming the ID exists).
 *   B. set-password sets the password ONLY for the verified email's own
 *      account, never for a Registration ID taken from the request, and never
 *      re-points an email (the account-takeover hole); a code is claimed
 *      atomically; wrong codes are capped and then the code is withdrawn.
 *   C. send-verification sends to the email ON FILE, says where (masked),
 *      withdraws a code nobody received, is rate limited, logs every refusal
 *      with its reason, and uses the password-reset wording.
 *   D. resend-id finds EVERY account on an email.
 *   E. The reset email says it is a password reset; the default wording is
 *      unchanged for any other caller. RENDERED.
 *   F. The page asks for the email alone, and says where the code went and to
 *      check spam.
 *
 * The live half (a probe student through the real routes and database) is
 * scripts/probe-training-password-reset.ts.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-training-password-reset.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import { resolveStudent, maskEmail, LOOKUP_MESSAGES, type StudentRow } from '../src/hubs/training/lib/auth/studentLookup';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const src = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

(async () => {
  console.log('=== A. One identity rule, RUN ===');
  const rows: StudentRow[] = [
    { registration_id: 'FMP-2026-0001', email: 'solo@x.test' },
    { registration_id: 'FMP-2026-0002', email: 'twin@x.test' },
    { registration_id: 'FMP-2026-0003', email: 'twin@x.test' },
  ];
  const r1 = resolveStudent(rows, { email: '  Solo@X.test ' });
  check('A1 the email alone identifies a student on one account (trimmed, any case)', r1.ok && r1.student.registration_id === 'FMP-2026-0001');
  const r2 = resolveStudent(rows, { email: 'solo@x.test', registrationId: ' fmp-2026-0001 ' });
  check('A2 a Registration ID typed in lowercase with spaces still matches', r2.ok && r2.student.registration_id === 'FMP-2026-0001');
  const r3 = resolveStudent(rows, { email: 'twin@x.test' });
  check('A3 two accounts on one email: "ambiguous" (ask for the ID), never "not found"', !r3.ok && r3.reason === 'ambiguous' && r3.accounts === 2);
  const r4 = resolveStudent(rows, { email: 'twin@x.test', registrationId: 'FMP-2026-0003' });
  check('A4 the ID then picks the account', r4.ok && r4.student.registration_id === 'FMP-2026-0003');
  const r5 = resolveStudent(rows, { email: 'solo@x.test', registrationId: 'FMP-2026-0002' });
  check('A5 an ID that belongs to another email is refused', !r5.ok && r5.reason === 'mismatch');
  check('A6 and the refusal reads exactly like not-found (it never confirms the ID exists)', LOOKUP_MESSAGES.mismatch === LOOKUP_MESSAGES.not_found);
  const r6 = resolveStudent(rows, { email: 'nobody@x.test' });
  check('A7 an unknown email is not found, and nothing else', !r6.ok && r6.reason === 'not_found');
  check('A8 nothing typed is missing input', (() => { const r = resolveStudent(rows, {}); return !r.ok && r.reason === 'missing_input'; })());
  check('A9 the ID alone also works (the email on file is used)', (() => { const r = resolveStudent(rows, { registrationId: 'fmp-2026-0002' }); return r.ok && r.student.email === 'twin@x.test'; })());
  check('A10 a masked address is recognisable and not the full address', maskEmail('student.name@gmail.com') === 'st***@gmail.com');
  check('A11 every refusal tells the student what to do next', Object.values(LOOKUP_MESSAGES).every((m) => m.length > 30));

  console.log('\n=== B. set-password: only the verified email\'s own account ===');
  const sp = src('app/api/training/set-password/route.ts');
  check('B1 identity comes from the one rule', /const found = await lookupStudent\(sb, body\);/.test(sp));
  check('B2 the code is looked up for the email ON FILE', /const email = found\.student\.email\.trim\(\)\.toLowerCase\(\);/.test(sp) && /\.eq\('email', email\)/.test(sp));
  check('B3 the password is set for that student\'s own Registration ID, never one from the request',
    /const regId = found\.student\.registration_id;/.test(sp) && /upsert\(\{ registration_id: regId, password_hash: hash \}/.test(sp)
    && !/body\.registrationId/.test(sp.replace(/\/\*[\s\S]*?\*\//g, '')));
  check('B4 no email is ever re-pointed (the takeover hole: training_registrations_meta is never written)',
    !/from\('training_registrations_meta'\)/.test(sp));
  check('B5 the code is claimed atomically (only the request that flips it wins)',
    /\.update\(\{ used: true \}\)\.eq\('id', otp\.id\)\.eq\('used', false\)\.select\('id'\)/.test(sp));
  check('B6 wrong codes are capped per student, and the code is then withdrawn',
    /rateLimited\('training-reset-wrong-code', regId, MAX_WRONG_CODES - 1/.test(sp) && /too_many_attempts/.test(sp));

  console.log('\n=== C. send-verification: to the email on file, and says where ===');
  const sv = src('app/api/training/send-verification/route.ts');
  check('C1 identity comes from the one rule and the code goes to the email ON FILE',
    /const found = await lookupStudent\(sb, body\);/.test(sv) && /const email = found\.student\.email\.trim\(\)\.toLowerCase\(\);/.test(sv)
    && /sendEmail\(\{ to: email,/.test(sv));
  check('C2 the answer says where it went, masked', /sentTo: maskEmail\(email\)/.test(sv));
  check('C3 two accounts on one email ask for the ID (409), not "not found"', /needsRegistrationId: found\.reason === 'ambiguous'/.test(sv) && /status: found\.reason === 'ambiguous' \? 409 : 400/.test(sv));
  check('C4 a code nobody received is withdrawn', /A code nobody received must not stay live/.test(sv) && /\.eq\('email', email\)\.eq\('code', code\)/.test(sv));
  check('C5 rate limited per address and per student', /rateLimited\('training-reset-send-ip'/.test(sv) && /rateLimited\('training-reset-send-email', email/.test(sv));
  check('C6 every refusal and every send is logged with its reason', /console\.warn\(`\[send-verification\] refused: \$\{found\.reason\}/.test(sv) && /console\.info\(`\[send-verification\] sent/.test(sv));
  check('C7 it uses the password-reset wording', /purpose: 'password_reset'/.test(sv));

  console.log('\n=== D. resend-id: every account on the email ===');
  const ri = src('app/api/training/resend-id/route.ts');
  check('D1 all accounts are read (a single-row lookup returned NOTHING for two)', /accountsForEmail\(sb, email\)/.test(ri) && !/maybeSingle/.test(ri));
  check('D2 every ID is sent', /registrationId: ids\.join\(', '\)/.test(ri));
  check('D3 the two callers\' shape is kept ({ success }, { notFound: true })', /notFound: true/.test(ri) && /success: true/.test(ri));

  console.log('\n=== E. The emails, RENDERED ===');
  const { otpVerificationTemplate } = await import('../src/shared/email/templates/otpVerification');
  const reset = await otpVerificationTemplate({ code: '123456', expiresMinutes: 10, purpose: 'password_reset' });
  const plain = await otpVerificationTemplate({ code: '654321', expiresMinutes: 10 });
  check('E1 the reset email says password reset in the subject and the body, with the code',
    /password reset code/i.test(reset.subject) && /Reset your password/.test(reset.html) && reset.html.includes('123456') && /password has not changed/.test(reset.text));
  check('E2 the default wording is unchanged for any other caller',
    plain.subject === 'Your Financial Modeler Pro Verification Code' && /Email Verification Code/.test(plain.html) && !/Reset your password/.test(plain.html));

  console.log('\n=== F. The page ===');
  const form = src('app/training/set-password/SetPasswordForm.tsx');
  check('F1 the email alone is required; the Registration ID is asked for only when needed',
    /if \(!email\.trim\(\)\) \{ setSendErr/.test(form) && !/if \(!regId\.trim\(\) \|\| !email\.trim\(\)\)/.test(form)
    && /if \(json\.needsRegistrationId\) setNeedsRegId\(true\);/.test(form));
  check('F2 the Registration ID is sent uppercased, or not at all', (form.match(/regId\.trim\(\)\.toUpperCase\(\) \|\| undefined/g) ?? []).length === 2);
  check('F3 it says where the code went and to check spam', /sentTo \|\| 'your registered email'/.test(form) && /check Spam and Promotions/.test(form));

  console.log('\n=== G. House rules ===');
  for (const f of ['src/hubs/training/lib/auth/studentLookup.ts', 'app/api/training/send-verification/route.ts', 'app/api/training/set-password/route.ts',
    'app/api/training/resend-id/route.ts', 'src/shared/email/templates/otpVerification.ts', 'app/training/set-password/SetPasswordForm.tsx']) {
    check(`G ${f} has no em dashes`, !src(f).includes(String.fromCharCode(0x2014)));
  }

  console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
  if (failed) { console.log(fails.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
})();

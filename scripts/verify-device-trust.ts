/**
 * scripts/verify-device-trust.ts
 *
 * Pins the device trust rules (founder, 2026-11-12; src/shared/auth/deviceTrust.ts):
 *   A. The cookie: 30 days, HttpOnly, SameSite=Lax, Path=/, Secure in
 *      production, Domain=.financialmodelerpro.com on every FMP host (so one
 *      verification covers www/admin, app. and learn.) and host-only on
 *      localhost and preview URLs. Clearing clears BOTH the domain and the old
 *      host-only cookie.
 *   B. Every value of the cookie is read from the raw header (an old host-only
 *      cookie and the new domain one can both be sent under one name).
 *   C. LIVE (real database, a probe email, cleaned up): several devices are
 *      trusted at once; a new verification never revokes another device; a
 *      trust made on one hub counts on the other; the email is matched
 *      case-insensitively; the 30-day window is stored; an expired row does
 *      not count; revokeTrustedDevices removes every device for that email and
 *      no other email's.
 *   D. Source: both sign-in gates read every cookie value and no hub; both
 *      verify routes write the shared cookie with the request host and trust
 *      by default; only "sign out everywhere", a password change and the two
 *      password resets revoke, and nothing in the sign-in path does; the
 *      settings page has the button; the Training Hub switch is unchanged.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-device-trust.ts
 * No em dashes in this file.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  buildTrustCookieHeader, clearTrustCookieHeaders, readTrustTokens, trustCookieDomain,
  normaliseTrustIdentifier, trustDevice, isDeviceTrusted, revokeTrustedDevices,
  COOKIE_MAX_AGE, TRUST_TTL_MS, DEVICE_COOKIE_NAME,
} from '../src/shared/auth/deviceTrust';

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0; let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}

async function main() {
  console.log('A. The trust cookie');
  check('A1 30 days is 2,592,000 seconds', COOKIE_MAX_AGE === 30 * 24 * 60 * 60 && TRUST_TTL_MS === COOKIE_MAX_AGE * 1000);
  for (const host of ['app.financialmodelerpro.com', 'learn.financialmodelerpro.com', 'www.financialmodelerpro.com', 'financialmodelerpro.com', 'APP.financialmodelerpro.com:443']) {
    check(`A2 ${host} shares .financialmodelerpro.com`, trustCookieDomain(host) === '.financialmodelerpro.com');
  }
  for (const host of ['localhost:3000', 'financial-modeler-pro-git-x.vercel.app', 'evilfinancialmodelerpro.com', 'financialmodelerpro.com.evil.io', '', null]) {
    check(`A3 ${String(host) || '(empty)'} stays host-only`, trustCookieDomain(host) === null);
  }
  const prod = buildTrustCookieHeader('ab'.repeat(32), { host: 'app.financialmodelerpro.com', secure: true });
  check('A4 production cookie: name, HttpOnly, Lax, Path=/, 30 days, Domain, Secure',
    prod.startsWith(`${DEVICE_COOKIE_NAME}=${'ab'.repeat(32)};`) && prod.includes('HttpOnly') && prod.includes('SameSite=Lax')
    && prod.includes('Path=/') && prod.includes(`Max-Age=${COOKIE_MAX_AGE}`) && prod.includes('Domain=.financialmodelerpro.com') && prod.includes('Secure'), prod);
  const local = buildTrustCookieHeader('cd'.repeat(32), { host: 'localhost:3000', secure: false, maxAge: 7200 });
  check('A5 localhost cookie is host-only and not Secure; the short trust is honoured', !local.includes('Domain=') && !local.includes('Secure') && local.includes('Max-Age=7200'), local);
  check('A6 the cookie is never a session cookie (it always carries Max-Age)', /Max-Age=\d+/.test(prod) && /Max-Age=\d+/.test(local));
  const clears = clearTrustCookieHeaders('learn.financialmodelerpro.com', true);
  check('A7 clearing on production clears the domain cookie AND the old host-only one',
    clears.length === 2 && clears.every((c) => c.includes('Max-Age=0') && c.startsWith(`${DEVICE_COOKIE_NAME}=;`))
    && clears.some((c) => c.includes('Domain=.financialmodelerpro.com')) && clears.some((c) => !c.includes('Domain=')));
  check('A8 clearing on localhost clears the one host-only cookie', clearTrustCookieHeaders('localhost:3000', false).length === 1);

  console.log('B. Reading the cookie');
  const t1 = '1'.repeat(64); const t2 = 'a'.repeat(64);
  check('B1 both values of a duplicated cookie are read', JSON.stringify(readTrustTokens(`x=1; ${DEVICE_COOKIE_NAME}=${t1}; next-auth.session-token=zz; ${DEVICE_COOKIE_NAME}=${t2}`)) === JSON.stringify([t1, t2]));
  check('B2 no header, no cookie, an empty or a malformed value read as no tokens',
    readTrustTokens(null).length === 0 && readTrustTokens('a=b').length === 0 && readTrustTokens(`${DEVICE_COOKIE_NAME}=`).length === 0 && readTrustTokens(`${DEVICE_COOKIE_NAME}=x,y'or`).length === 0);
  check('B3 a similarly named cookie is not read', readTrustTokens(`x${DEVICE_COOKIE_NAME}=${t1}`).length === 0);
  check('B4 the identifier rule trims and lowercases', normaliseTrustIdentifier('  Probe@Example.COM ') === 'probe@example.com');

  console.log('C. Live database');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    check('C0 credentials loaded (run with --env-file=.env.local)', false, 'SUPABASE_SERVICE_ROLE_KEY is not set');
  } else {
    const { getServerClient } = await import('../src/core/db/supabase');
    const sb = getServerClient();
    const probe = `verify-device-trust-${Date.now()}@example.invalid`;
    const other = `verify-device-trust-other-${Date.now()}@example.invalid`;
    try {
      const laptop = await trustDevice(probe, 'modeling');
      const phone  = await trustDevice(probe.toUpperCase(), 'modeling');
      const learn  = await trustDevice(probe, 'training');
      const otherT = await trustDevice(other, 'modeling');
      check('C1 the laptop stays trusted after the phone verifies (several devices at once)', await isDeviceTrusted([laptop], probe) && await isDeviceTrusted([phone], probe));
      check('C2 a typed capital is stored lowercased and still matches', await isDeviceTrusted(phone, probe.toUpperCase()));
      check('C3 a Training Hub trust counts on the Modeling Hub and the reverse (one cookie, every site)', await isDeviceTrusted([learn], probe) && await isDeviceTrusted([laptop], probe));
      check('C4 one stale token beside a live one still passes (old host-only + new domain cookie)', await isDeviceTrusted(['f'.repeat(64), laptop], probe));
      check("C5 a token never passes for another user's email", !(await isDeviceTrusted([otherT], probe)) && !(await isDeviceTrusted([laptop], other)));
      check('C6 no token, no trust', !(await isDeviceTrusted([], probe)) && !(await isDeviceTrusted(undefined, probe)));
      const { data: row } = await sb.from('trusted_devices').select('identifier, created_at, expires_at').eq('device_token', laptop).maybeSingle();
      const days = row ? (new Date(row.expires_at).getTime() - Date.now()) / 864e5 : 0;
      check('C7 the stored window is 30 days', days > 29.99 && days <= 30.01, `days=${days}`);
      await sb.from('trusted_devices').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('device_token', learn);
      check('C8 an expired trust does not count', !(await isDeviceTrusted([learn], probe)));
      const removed = await revokeTrustedDevices(probe.toUpperCase());
      check('C9 sign out everywhere removes every device for the email, on every hub', removed === 3 && !(await isDeviceTrusted([laptop, phone], probe)), `removed=${removed}`);
      check("C10 it leaves another email's devices alone", await isDeviceTrusted([otherT], other));
    } finally {
      await sb.from('trusted_devices').delete().in('identifier', [probe, other]);
    }
  }

  console.log('D. Source');
  const nextauth = read('src/shared/auth/nextauth.ts');
  const validate = read('app/api/training/validate/route.ts');
  check('D1 the Modeling Hub / admin gate reads every cookie value and passes no hub', nextauth.includes("isDeviceTrusted(readTrustTokens(headerStore.get('cookie')), user.email)"));
  check('D2 the Training Hub gate reads every cookie value and passes no hub', validate.includes("isDeviceTrusted(readTrustTokens(req.headers.get('cookie')), email)"));
  const mv = read('app/api/auth/device-verify/route.ts');
  const tv = read('app/api/training/device-verify/route.ts');
  check('D3 both verify routes set the cookie with the request host (the shared domain)', [mv, tv].every((s) => s.includes("host: req.headers.get('host')")));
  check('D4 both verify routes trust for 30 days unless the box was unticked', mv.includes('body.trustDevice !== false') && tv.includes('body.trustDevice !== false'));
  check('D5 the Modeling Hub verify route keys on the email, never a user id', !mv.includes('userId') && mv.includes("trustDevice(email, 'modeling'"));
  check('D6 the trust box defaults to ticked on all three sign-in forms',
    read('app/modeling/signin/SignInForm.tsx').includes('useState(true);') && /trustChecked,\s+setTrustChecked\]\s+=\s+useState\(true\)/.test(read('app/training/signin/SignInForm.tsx'))
    && /trustChecked,\s+setTrustChecked\]\s+=\s+useState\(true\)/.test(read('app/admin/AdminLoginClient.tsx')));
  // Revocation is explicit only: find every file that deletes trusted devices.
  const walk = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(rel);
    return /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
  });
  const files = [...walk('app'), ...walk('src')];
  const revokers = files.filter((f) => read(f).includes('revokeTrustedDevices(')).filter((f) => !f.endsWith('deviceTrust.ts')).sort();
  const expected = ['app/api/auth/reset-password/route.ts', 'app/api/training/set-password/route.ts', 'app/api/user/password/route.ts', 'app/api/user/sign-out-everywhere/route.ts'];
  check('D7 only sign out everywhere, a password change and the two password resets revoke', JSON.stringify(revokers) === JSON.stringify(expected), revokers.join(', '));
  const rawDeletes = files.filter((f) => /from\('trusted_devices'\)[\s\S]{0,40}\.delete\(/.test(read(f)) && !f.endsWith('deviceTrust.ts'));
  check('D8 nothing else deletes trusted devices except account deletion', JSON.stringify(rawDeletes) === JSON.stringify(['src/shared/account/deleteUserAccount.ts']), rawDeletes.join(', '));
  const signInPath = [nextauth, validate, mv, tv].join('\n');
  check('D9 nothing in the sign-in or verify path revokes', !signInPath.includes('revokeTrustedDevices') && !/trusted_devices'\)[\s\S]{0,40}\.delete/.test(signInPath));
  const settings = read('app/settings/page.tsx');
  check('D10 the settings page has the Sign out everywhere button wired to its route', settings.includes('data-testid="sign-out-everywhere"') && settings.includes("fetch('/api/user/sign-out-everywhere'"));
  const soe = read('app/api/user/sign-out-everywhere/route.ts');
  check('D11 the route requires a session, revokes the email on file and clears this device', soe.includes('getServerSession(authOptions)') && soe.includes("from('users').select('email')") && soe.includes('clearTrustCookieHeaders('));
  const dt = read('src/shared/auth/deviceTrust.ts');
  check('D12 the Training Hub device switch is unchanged',
    dt.includes("TRAINING_DEVICE_VERIFICATION_SETTING_KEY = 'training_device_verification'") && dt.includes('return isDeviceVerificationRequired();')
    && validate.includes('if (!trusted && await isTrainingDeviceVerificationRequired())'));
  check('D13 the shared Modeling Hub / admin switch still gates the Modeling Hub', nextauth.includes('if (!trusted && await isDeviceVerificationRequired())'));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

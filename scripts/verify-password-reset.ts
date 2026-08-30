/**
 * scripts/verify-password-reset.ts
 *
 * Pins the 2026-08-30 password-reset rebuild:
 *   A. Honest failure: neither route can swallow an infrastructure error into
 *      a success or an "invalid link"; the store is availability-checked
 *      BEFORE the user lookup so the degraded state cannot leak which emails
 *      exist; a failed email send is told to the user AND kills its token.
 *   B. Token hygiene: only a SHA-256 hash is stored, expiry is enforced,
 *      single use is claimed ATOMICALLY (conditional update on used_at IS
 *      NULL), and a successful reset revokes the user's other tokens.
 *   C. The email escapes the user-supplied name (behavioral render, offline).
 *   D. The forgot page surfaces a non-OK response instead of false success.
 *   E. Migration 222 creates the table the code needs: 008's shape PLUS
 *      used_at (which the code always read and 008 never declared).
 *
 * Run: npx tsx scripts/verify-password-reset.ts   (offline, no env needed)
 *
 * No em dashes in this file.
 */
import * as fs from 'fs';
import * as path from 'path';
import { passwordResetTemplate } from '../src/shared/email/templates/passwordReset';

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

async function main() {
  const forgot = src('app/api/auth/forgot-password/route.ts');
  const reset = src('app/api/auth/reset-password/route.ts');

  console.log('A. Honest failure, no enumeration leak');
  check('A1 store availability checked BEFORE the user lookup',
    forgot.indexOf("from('password_reset_tokens').select('id').limit(0)") !== -1
    && forgot.indexOf("from('password_reset_tokens').select('id').limit(0)") <
       forgot.indexOf("from('users').select('id, name')"));
  check('A1b the availability guard is a GET, never HEAD (a HEAD on an absent table is a silent 204)',
    !/head:\s*true/.test(forgot));
  check('A2 unavailable store answers 503 with a message, never ok:true',
    /status: 503/.test(forgot) && /UNAVAILABLE/.test(forgot));
  check('A3 token insert error is CHECKED and fails the request',
    /const \{ error: insErr \}/.test(forgot) && /if \(insErr\)/.test(forgot));
  check('A4 a failed send returns an error AND removes the dead token',
    /status: 502/.test(forgot)
    && /delete\(\)\.eq\('token_hash', tokenHash\)/.test(forgot));
  check('A5 known and unknown emails share one success response',
    /return NextResponse\.json\(\{ ok: true \}\);\s*}\s*$/.test(forgot));
  check('A6 reset route separates infrastructure (503) from bad link (400)',
    /readErr/.test(reset) && /status: 503/.test(reset)
    && /Invalid or expired reset link/.test(reset));

  console.log('B. Token hygiene');
  check('B1 only the SHA-256 hash is stored',
    /createHash\('sha256'\)/.test(forgot) && /token_hash: tokenHash/.test(forgot)
    && !/plainToken(?![\w])/.test(forgot.split('resetUrl')[0].split('token_hash')[1] ?? ''));
  check('B2 expiry enforced in the reset route',
    /new Date\(row\.expires_at\) < new Date\(\)/.test(reset));
  check('B3 single use claimed ATOMICALLY (conditional update on used_at IS NULL)',
    /\.update\(\{ used_at: [^}]+\}\)\s*\.eq\('id', row\.id\)\s*\.is\('used_at', null\)/.test(reset)
    && /claimed\.length === 0/.test(reset));
  check('B4 requesting a new link revokes previous unused tokens',
    /delete\(\)\.eq\('user_id', user\.id\)\.is\('used_at', null\)/.test(forgot));
  check('B5 a successful reset revokes the user\'s other unused tokens',
    /delete\(\)\.eq\('user_id', row\.user_id\)\.is\('used_at', null\)/.test(reset));
  check('B6 password update error is checked (no silent half-reset)',
    /const \{ error: pwErr \}/.test(reset) && /if \(pwErr\)/.test(reset));

  console.log('C. Email escaping (behavioral render)');
  const evil = await passwordResetTemplate({ resetUrl: 'https://app.example.com/reset-password?token=t', name: '<script>alert(1)</script> Jordan' });
  check('C1 user-supplied name is escaped in the rendered HTML',
    !evil.html.includes('<script>alert(1)</script>') && evil.html.includes('&lt;script&gt;'));
  const plain = await passwordResetTemplate({ resetUrl: 'https://x.example/r?token=t', name: 'Jordan Q' });
  check('C2 a normal first name renders in the greeting', plain.html.includes('Hi Jordan,'));
  check('C3 no name still renders a greeting', (await passwordResetTemplate({ resetUrl: 'https://x.example/r?token=t' })).html.includes('Hi,'));
  check('C4 no em dash in the rendered email', !evil.html.includes('—'));

  console.log('D. Forgot page');
  const page = src('app/forgot-password/page.tsx');
  check('D1 a non-OK response shows the server error, not "check your email"',
    /if \(!res\.ok\)/.test(page) && /setError\(j\.error/.test(page));

  console.log('E. Migration 222');
  const mig = src('supabase/migrations/222_password_reset_tokens.sql');
  check('E1 creates password_reset_tokens with 008 shape + used_at',
    /CREATE TABLE IF NOT EXISTS password_reset_tokens/.test(mig)
    && /token_hash\s+text\s+NOT NULL UNIQUE/.test(mig)
    && /used_at\s+timestamptz/.test(mig)
    && /REFERENCES users\(id\) ON DELETE CASCADE/.test(mig));
  check('E2 additive only',
    !/\bDROP\b|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET/i.test(mig.replace(/--[^\n]*/g, '').replace(/'[^']*'/g, "''")));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

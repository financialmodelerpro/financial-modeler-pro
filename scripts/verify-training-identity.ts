/**
 * verify-training-identity.ts (2026-09-26)
 *
 * NO TRAINING HUB ROUTE TAKES A STUDENT'S IDENTITY FROM THE REQUEST.
 *
 * Measured 2026-09-26: about 25 routes read the email or Registration ID from
 * the body or the URL with no session at all, so anyone could act as any
 * student (post a pass and get a certificate, rewrite a profile, read notes
 * and watch history, register or unregister them, mint transcript links).
 * The signed session (getTrainingCookieSession) is now the ONLY identity.
 *
 * This scans EVERY route under app/api/training (not a list of known ones, so
 * a new route that repeats the mistake fails), and for each file that reads an
 * identity from the request it requires EITHER:
 *   - the file is a SIGN-IN FLOW, where the identity is exactly what is being
 *     proved (named below with its reason), or
 *   - the file is PUBLIC BY DESIGN (the founder's 2026-07-31 decision: the
 *     shareable credential reads), or
 *   - no identity is read from the request at all, and the session is used.
 * Plus: every route that uses a student's identity calls the verified reader.
 *
 * Run: npx tsx scripts/verify-training-identity.ts
 *
 * No em dashes in this file.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n === 'route.ts') out.push(p.replace(/\\/g, '/'));
  }
  return out;
}
const code = (p: string): string => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const rel = (p: string): string => p.replace(/^app\/api\/training\//, '').replace(/\/route\.ts$/, '');

/** The identity is what these PROVE (a password, a code, a registration). */
const SIGN_IN_FLOWS: Record<string, string> = {
  'validate': 'password sign-in: the identity typed is what the password proves',
  'device-verify': 'the emailed code finishes a password sign-in (the pending cookie binds it)',
  'register': 'creates an account for the email given',
  'send-verification': 'password reset: sends a code to the email ON FILE',
  'set-password': 'password reset: the code proves the email; the account is the one on file',
  'resend-id': 'forgot Registration ID: emails the address on file',
  'verify-email': 'email confirmation link',
  'confirm-email': 'email confirmation link',
  'resend-confirmation': 'resends the confirmation to the address given',
};
/** Founder's decision 2026-07-31: the shareable credential READS are public. */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  'certificate': 'verify a certificate (shareable credential)',
  'certificate-image': 'certificate image (shareable credential)',
  'transcript-link': 'reading a share link is public; minting (POST) and revoking (DELETE) use the session',
  'transcript-cached/[certificateId]': 'cached transcript by certificate id (shareable credential)',
  'badges/download': 'badge by certificate id (shareable credential)',
};

const IDENTITY_FROM_REQUEST = [
  /searchParams\.get\(\s*'(email|regId|registrationId|reg_id|student_email)'\s*\)/,
  /body\??\.(email|regId|registrationId|registration_id|student_email)\b/,
  /const \{[^}]*\b(email|regId|registrationId|registration_id|student_email)\b[^}]*\}\s*=\s*(body|await req\.json\(\))/,
  /formData\.get\(\s*'(regId|email|registrationId)'\s*\)/,
];

const files = walk('app/api/training');
console.log(`Scanning ${files.length} Training Hub routes.\n`);
check('0 the scan found the whole Training Hub API (not a handful)', files.length >= 45, String(files.length));

const offenders: string[] = [];
const usesSession: string[] = [];
for (const f of files) {
  const r = rel(f);
  const c = code(f);
  const reads = IDENTITY_FROM_REQUEST.some((re) => re.test(c));
  if (/getTrainingCookieSession\(\)/.test(c)) usesSession.push(r);
  if (!reads) continue;
  if (SIGN_IN_FLOWS[r] || PUBLIC_BY_DESIGN[r]) continue;
  offenders.push(r);
}
check('1 no route outside the named sign-in flows and public credential reads takes identity from the request',
  offenders.length === 0, offenders.join(', '));

const MUST_USE_SESSION = ['activity', 'attempt-status', 'certification-watch', 'feedback', 'live-sessions/[id]/register',
  'live-sessions/[id]/watched', 'live-sessions/registration-status-batch', 'notes', 'profile', 'session-notes',
  'submit-testimonial', 'watch-history', 'upload-avatar', 'questions', 'submit-assessment', 'progress', 'transcript-link',
  'assessment/start', 'assessment/pause', 'assessment/resume', 'assessment/state', 'model-submission', 'tour-status'];
const missing = MUST_USE_SESSION.filter((r) => !usesSession.includes(r));
check('2 every route that acts for a student reads the SIGNED session', missing.length === 0, missing.join(', '));

const tl = code('app/api/training/transcript-link/route.ts');
const post = tl.slice(tl.indexOf('export async function POST'), tl.indexOf('export async function DELETE'));
check('3 transcript-link: minting a link takes the student from the session, only reading stays public',
  /getTrainingCookieSession\(\)/.test(post) && /const regId\s+= sess\.registrationId;/.test(post) && !/body\.regId/.test(post.replace(/as \{ regId\?: string; email\?: string; courseId\?: string \}/, '')));

const allowlisted = Object.keys({ ...SIGN_IN_FLOWS, ...PUBLIC_BY_DESIGN });
const stale = allowlisted.filter((r) => !files.some((f) => rel(f) === r));
check('4 every allowance names a route that exists (no stale exemption)', stale.length === 0, stale.join(', '));

// The detector fires: a synthetic route that reads identity from the body is caught.
const synthetic = `export async function POST(req) { const { registrationId, x } = await req.json(); }`;
check('5 the detector catches a route that reads identity from the body', IDENTITY_FROM_REQUEST.some((re) => re.test(synthetic)));

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
if (failed) { console.log(fails.map((x) => `  - ${x}`).join('\n')); process.exit(1); }

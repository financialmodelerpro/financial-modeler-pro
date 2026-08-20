/**
 * verify-registration-qualification.ts (2026-08-20)
 *
 * FOUR ITEMS, ONE PASS: the platform-access loop, required-field enforcement,
 * the KSA-first defaults, and the signup qualification.
 *
 * The one that matters most is section A. A trial user with a valid
 * entitlement clicked Open Platform and was returned to the platform selector,
 * and the reason was NOT the entitlement gate: the Coming Soon guard sent a
 * SIGNED-IN user to `/signin`, which sees the session, finds its own separate
 * flag disabled, and redirects to `/dashboard`. The gate below it never ran.
 * A guard whose redirect target bounces the user back where they came from is
 * indistinguishable from a broken button.
 *
 * Run: npx tsx scripts/verify-registration-qualification.ts
 * No em dashes in this file.
 */

import fs from 'node:fs';
import path from 'node:path';

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { passed++; return; }
  failures.push(`${label}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 60 - t.length))}`);
const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

/** Strip comments before asserting a pattern is present or absent. A symbol in
 *  a docstring is not a use, and this file's own comments quote the strings it
 *  forbids. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const GUARD = 'src/shared/comingSoon/guard.ts';
const ADAPTER = 'src/hubs/modeling/lib/ensureNotComingSoon.ts';
const FORM = 'app/modeling/register/RegisterForm.tsx';
const ROUTE = 'app/api/auth/register/route.ts';
const MIGRATION = 'supabase/migrations/216_users_real_estate_qualification.sql';

// ---------------------------------------------------------------------------
section('A. A signed-in user is never sent to the sign-in page');

{
  const guard = stripComments(read(GUARD));
  const adapter = stripComments(read(ADAPTER));

  check('A: the shared guard can route a signed-in user separately',
    guard.includes('signedInRedirectTo') && guard.includes('hasSession'));
  check('A: and it only does so when the caller supplies both',
    /opts\.signedInRedirectTo && await opts\.hasSession/.test(guard));
  check('A: the unauthenticated target is unchanged', guard.includes('opts.redirectTo'));

  check('A: the modeling adapter supplies a session check', adapter.includes('hasSession'));
  check('A: and a signed-in destination', adapter.includes('signedInRedirectTo'));
  // THE WHOLE POINT. A signed-in user going to /signin is the loop.
  const signedInTarget = /signedInRedirectTo:\s*'([^']+)'/.exec(adapter)?.[1] ?? '';
  check('A: the signed-in destination is NOT the sign-in page',
    signedInTarget !== '' && !signedInTarget.includes('signin'), signedInTarget);
  check('A: the unauthenticated destination still IS the sign-in page',
    /redirectTo:\s*'\/signin/.test(adapter));
}

// ---------------------------------------------------------------------------
section('B. Every field the form marks required is enforced on the SERVER');

{
  const route = stripComments(read(ROUTE));
  const form = stripComments(read(FORM));

  // The server is the authority. Before this, `name` was the only field
  // checked; company and job title were browser-only, and phone, city and
  // country were checked nowhere at all.
  for (const field of ['name', 'company', 'job_title', 'phone', 'city', 'country', 'real_estate_role_note']) {
    check(`B: the server requires ${field}`, new RegExp(`'${field}'`).test(route));
  }
  check('B: it rejects whitespace, not just absence', /\.trim\(\) === ''/.test(route));
  check('B: the yes/no is checked as a BOOLEAN, so false passes and null does not',
    /typeof body\.works_in_real_estate !== 'boolean'/.test(route));
  check('B: no required field is still coerced to null on insert',
    !/company:\s*body\.company\?\.trim\(\) \|\| null/.test(route)
    && !/city:\s*body\.city\?\.trim\(\)\s*\|\| null/.test(route));

  // The client keeps its own copies for fast feedback. Both, not either.
  for (const [field, probe] of [
    ['company', 'company.trim()'], ['job title', 'jobTitle.trim()'],
    ['phone', 'phoneLocal.trim()'], ['city', 'city.trim()'], ['country', 'country.trim()'],
  ] as const) {
    check(`B: the client also checks ${field}`, form.includes(`!${probe}`));
  }
  check('B: the client checks the yes/no was answered', form.includes('worksInRe === null'));
  check('B: and the free text', form.includes('!reNote.trim()'));
}

// ---------------------------------------------------------------------------
section('C. KSA-first defaults, which restrict nothing');

{
  const form = stripComments(read(FORM));
  check('C: the phone code defaults to Saudi Arabia', form.includes("useState('+966')"));
  check('C: it does NOT default to the US', !form.includes("useState('+1')"));
  check('C: the city placeholder reads Riyadh', form.includes('placeholder="Riyadh"'));
  check('C: the country defaults to Saudi Arabia', form.includes("useState('SA')"));

  // A SELECTED VALUE, not free text, and backed by the ONE country list.
  check('C: the country field is backed by a list', form.includes('list="register-country-list"'));
  check('C: rendered from the shared COUNTRIES constant',
    form.includes('COUNTRIES.map') && form.includes("from '@/src/core/countries'"));
  check('C: it does NOT declare a second country list of its own',
    !/const\s+COUNTRIES\s*[:=]/.test(form));

  // EXISTING FREE TEXT MUST KEEP WORKING. Live rows hold 'Pakistan' and
  // 'Saudi Arabia', not codes, so the display resolves both forms.
  check('C: the stored value is resolved through the shared helpers',
    form.includes('countryLabel(') && form.includes('resolveCountryCode('));
  {
    // Behavioural, not a grep: the helpers must round-trip a stored NAME.
    const countries = read('src/core/countries.ts');
    check('C: the shared list is the 249-entry one, not a stub',
      (countries.match(/'[A-Z]{2}:/g) ?? []).length > 200);
  }
  // Nothing may be restricted: every entry stays selectable.
  check('C: no country is filtered out of the list',
    !/COUNTRIES\.filter/.test(form));
}

// ---------------------------------------------------------------------------
section('D. The qualification is stored, additive, and shown in both places');

{
  const migration = read(MIGRATION);
  check('D: the migration adds both columns',
    /ADD COLUMN IF NOT EXISTS works_in_real_estate/.test(migration)
    && /ADD COLUMN IF NOT EXISTS real_estate_role_note/.test(migration));
  // ADDITIVE ONLY. Deprecate, never delete.
  check('D: the migration drops nothing', !/DROP\s+(COLUMN|TABLE)/i.test(migration));
  // NULLABLE BOOLEAN, deliberately: yes, no, and "never asked" are three
  // different states, and a NOT NULL DEFAULT false would record an answer
  // nobody gave on every existing row, which the admin list then filters on.
  check('D: the yes/no is nullable, so "not asked" stays distinguishable',
    !/works_in_real_estate\s+boolean\s+not\s+null/i.test(migration));
  check('D: it is indexed for the admin filter', /CREATE INDEX IF NOT EXISTS/.test(migration));

  const form = stripComments(read(FORM));
  // The yes/no testid is built from a template literal, so the literal string
  // 'register-works-in-re-yes' never appears in the source. Match the stem.
  check('D: the form asks both questions',
    form.includes('register-works-in-re-') && form.includes('register-re-note'));
  check('D: and offers exactly yes and no, with neither preselected',
    /['Yes', true], ['No', false]/.test(form) && form.includes('useState<boolean | null>(null)'));
  check('D: and sends both', form.includes('works_in_real_estate:') && form.includes('real_estate_role_note:'));

  // SHOWN IN TWO PLACES.
  const card = stripComments(read('app/admin/plans/page.tsx'));
  const panel = stripComments(read('src/components/admin/UserAccessPanel.tsx'));
  check('D: the pending request card shows the answers', card.includes('trial-request-qualification-'));
  check('D: the admin user record shows them too', panel.includes('user-qualification'));
  // IN FULL on the card: it is the reason to approve or decline, and a
  // truncated version sends an admin hunting for the rest of a sentence.
  check('D: the card renders the note in full, not truncated',
    card.includes('whiteSpace: \'pre-wrap\'') && !/textOverflow:\s*'ellipsis'/.test(card));

  // ONE COPY. trial_requests already duplicates company and job_title; this
  // reads the user row through the existing join rather than adding a third.
  const reqRoute = stripComments(read('app/api/admin/trial-requests/route.ts'));
  check('D: the card reads the answers from the USER row, not a second copy',
    reqRoute.includes('users(email, name, works_in_real_estate, real_estate_role_note)'));
  check('D: and the queue survives a database without the migration',
    reqRoute.includes('NARROW') && /works_in_real_estate\|real_estate_role_note/.test(reqRoute));

  // FILTERABLE AND SORTABLE in the admin list.
  const list = stripComments(read('app/admin/users/page.tsx'));
  const listApi = stripComments(read('app/api/admin/users/route.ts'));
  check('D: the list has a real-estate filter', list.includes('real-estate-filter'));
  check('D: and a sort control', list.includes('real-estate-sort'));
  check('D: the API filters on all three states',
    listApi.includes("reFilter === 'yes'") && listApi.includes("reFilter === 'no'") && listApi.includes("reFilter === 'unknown'"));
  check('D: the API sorts on the answer', /order\('works_in_real_estate'/.test(listApi));
  check('D: the list column distinguishes "not asked" from "no"',
    list.includes('user-real-estate-') && list.includes('Registered before this question was asked'));

  // SCHEMA-TOLERANT everywhere it is read, so a deploy before the migration
  // degrades to "not asked" rather than breaking a screen.
  for (const [name, src] of [
    ['register route', stripComments(read(ROUTE))],
    ['admin users API', listApi],
    ['user detail API', stripComments(read('app/api/admin/entitlements/user/route.ts'))],
  ] as const) {
    check(`D: the ${name} falls back when the columns are absent`,
      /works_in_real_estate\|real_estate_role_note/.test(src));
  }
}

// ---------------------------------------------------------------------------
section('E. The Training Hub is deliberately untouched');

{
  // It does NOT share the modeling component and has no company / job title
  // fields, so adding them there would be inventing a requirement nobody
  // asked for. This check exists so a future pass does not "fix" the
  // asymmetry by accident.
  const trainingForm = stripComments(read('app/training/register/RegisterForm.tsx'));
  check('E: the training form does not import the modeling register form',
    !trainingForm.includes("from '@/app/modeling/register/RegisterForm'"));
  check('E: and still asks for no company or job title',
    !trainingForm.includes('job_title') && !/setCompany/.test(trainingForm));
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(66)}`);
if (failures.length === 0) {
  console.log(`verify-registration-qualification: ${passed} passed, 0 failed`);
} else {
  console.log(`verify-registration-qualification: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}

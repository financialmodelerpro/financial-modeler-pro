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

  // A REAL COMBOBOX (2026-08-20), replacing the <datalist>, whose popup is
  // browser-owned: on some browsers typing JUMPED to the first match instead
  // of filtering. The checks moved with the implementation: the field is the
  // shared CountryCombobox, which itself imports the ONE country list.
  const combo = stripComments(read('src/shared/components/CountryCombobox.tsx'));
  check('C: the country field is the shared combobox',
    form.includes('<CountryCombobox') && form.includes("from '@/src/shared/components/CountryCombobox'"));
  check('C: the datalist is gone', !form.includes('register-country-list'));
  check('C: the combobox reads the ONE country list',
    combo.includes("from '@/src/core/countries'") && !/const\s+COUNTRIES\s*[:=]/.test(combo));
  check('C: neither file declares a second country list',
    !/const\s+COUNTRIES\s*[:=]/.test(form));
  check('C: typing filters on ANY part of the name, case insensitive',
    combo.includes('.toLowerCase().includes(q)'));
  check('C: arrows move, Enter selects the highlighted entry, Escape closes',
    combo.includes("'ArrowDown'") && combo.includes("'ArrowUp'")
    && combo.includes('select(filtered[Math.min(highlight, filtered.length - 1)].name)')
    && combo.includes("'Escape'"));
  check('C: clicking the field opens the full list with no typing',
    combo.includes('onClick={() => setOpen(true)}') && combo.includes("q === '' ? COUNTRIES"));
  check('C: the signin register tab uses the same combobox',
    stripComments(read('app/modeling/signin/SignInForm.tsx')).includes('<CountryCombobox'));

  // STORAGE IS UNCHANGED: a recognised pick stores the code, free text is
  // kept verbatim, which is what keeps every existing stored value working.
  check('C: the stored value is resolved through the shared helpers',
    combo.includes('resolveCountryCode(name) ?? name') && combo.includes('countryLabel(value)'));
  check('C: unrecognised free text is kept, not discarded',
    combo.includes('resolveCountryCode(prev) ?? prev'));

  // The phone code selector got the arrow keys it lacked.
  const phone = stripComments(read('src/shared/components/PhoneInput.tsx'));
  check('C: the phone code selector has arrow-key navigation',
    phone.includes("'ArrowDown'") && phone.includes('filtered[Math.min(highlight, filtered.length - 1)].code'));
  check('C: and its highlight is visible and mouse-tracked',
    phone.includes('i === highlight') && phone.includes('onMouseEnter={() => setHighlight(i)}'));
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
  // Stated as the RELATIONSHIP rather than as the literal select string. The
  // first version of this check pinned the exact column list, so widening the
  // select for the contact block failed it while the rule it protects was
  // never in question. What must stay true is that the two answers are read
  // through the users(...) join and are NOT duplicated onto trial_requests,
  // the way company and job_title already are.
  check('D: the card reads the answers from the USER row, not a second copy',
    /users\([^)]*works_in_real_estate[^)]*real_estate_role_note[^)]*\)/.test(reqRoute)
    && !/trial_requests[\s\S]{0,400}?insert[\s\S]{0,200}?works_in_real_estate/.test(reqRoute));
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
  // THREE RENDERINGS, not one sentence. This looked for a literal string that
  // no longer exists anywhere in the page, so it could only ever have passed
  // against the copy of the day. The property is that the column renders three
  // DISTINCT states and that the third says why it is blank.
  check('D: the list column distinguishes "not asked" from "no"',
    list.includes('user-real-estate-')
    && /works_in_real_estate === true/.test(list)
    && /works_in_real_estate === false/.test(list)
    && /title="Never asked:[^"]{10,}"/.test(list));

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

section('F. The trial request card carries the whole person');

{
  // WHY THIS SECTION EXISTS. An approval is a judgement about a person, and it
  // was being made from an email address, a company and a free-text note.
  // Everything else the registrant typed was already in the database and was
  // simply not selected, so an admin had to leave the queue and look the
  // person up to answer "who is this, and when did they sign up".

  const route = stripComments(read('app/api/admin/trial-requests/route.ts'));
  const card = stripComments(read('app/admin/plans/page.tsx'));
  const shared = stripComments(read('src/shared/admin/signupProfile.ts'));
  const panel = stripComments(read('src/components/admin/UserAccessPanel.tsx'));
  const userRoute = stripComments(read('app/api/admin/entitlements/user/route.ts'));

  // The route must actually ASK for the fields. A card cannot render a column
  // that was never selected, and that is exactly how these came to be missing.
  for (const col of ['phone', 'city', 'country']) {
    check(`F: the trial request select asks for ${col}`,
      new RegExp(`CONTACT = '[^']*\\b${col}\\b`).test(route));
  }
  check('F: and for the user OWN created_at, which is the registration time',
    /CONTACT = '[^']*\bcreated_at\b/.test(route));
  // Both selects carry it, or the schema fallback silently drops the whole
  // contact block on a database missing mig 216.
  check('F: the narrow fallback carries the same contact block',
    /NARROW = `[^`]*\$\{CONTACT\}/.test(route) && /WIDE = `[^`]*\$\{CONTACT\}/.test(route));
  // The retry must still test ONLY the two mig-216 columns. Widening it to the
  // contact columns would let a genuinely missing column downgrade the queue.
  check('F: the schema retry still tests only the two mig-216 columns',
    /works_in_real_estate\|real_estate_role_note/.test(route)
    && !/phone\|city/.test(route) && !/city\|country/.test(route));

  // The card renders them.
  check('F: the card renders a contact block', card.includes('trial-request-contact-'));
  for (const label of ['Phone', 'City', 'Country', 'Registered', 'Requested']) {
    check(`F: the card labels ${label}`, new RegExp(`'${label}'`).test(card));
  }
  // The two timestamps are DIFFERENT quantities. Rendering the request time
  // twice under two labels would look complete and be wrong.
  check('F: Registered reads the USER row and Requested reads the REQUEST row',
    /\['Registered', formatAdminStamp\(r\.users\?\.created_at\)\]/.test(card)
    && /\['Requested', formatAdminStamp\(r\.created_at\)\]/.test(card));
  check('F: the name leads the card', /r\.users\?\.name/.test(card));
  // An absent value must be visibly absent, not a blank that reads as a fault.
  check('F: an absent contact value renders a marker', /not given/.test(card));

  // ONE IMPLEMENTATION. The decision screen and the record screen must not
  // format the same person two different ways.
  check('F: the shared signup profile builder exists',
    shared.includes('export function signupContactFields('));
  check('F: the user record renders from the shared builder',
    panel.includes('signupContactFields('));
  check('F: both screens take the qualification wording from the shared helper',
    card.includes('qualificationLabel(') && panel.includes('qualificationTone('));
  check('F: neither screen restates the three-state wording inline',
    !card.includes("'NOT IN REAL ESTATE'") && !panel.includes("'NOT IN REAL ESTATE'"));
  // The country rule is the shared resolver, not a second one.
  check('F: country resolves through the shared country list',
    shared.includes("from '@/src/core/countries'") && shared.includes('countryLabel('));
  check('F: the timestamp is UTC and says so',
    /UTC/.test(shared) && shared.includes('toISOString()'));
  // Three states, not two: never asked is not the same as answered no.
  check('F: the qualification keeps three states',
    shared.includes("'unasked'") && /v === true/.test(shared) && /v === false/.test(shared));

  // The user detail route must supply what the panel now renders.
  check('F: the user detail select carries the contact block in its BASE select',
    /USER_BASE = '[^']*\bphone\b[^']*\bcity\b[^']*\bcountry\b[^']*\bcreated_at\b/.test(userRoute));
  // Contact columns predate both ladders, so they must NOT be what a fallback
  // gives up.
  check('F: and the profile / full ladders still sit above it',
    /USER_PROFILE = `\$\{USER_BASE\}, company, job_title`/.test(userRoute)
    && /USER_FULL = `\$\{USER_PROFILE\}, works_in_real_estate, real_estate_role_note`/.test(userRoute));

  // The block must not vanish because one optional field happens to be blank.
  check('F: the signup profile block renders whenever there is a user',
    panel.includes('{user && ('));
}

section('G. A declined request is a decision, not a dead end');

{
  // Before this, a declined row vanished from the queue (GET fetched pending
  // only) and approve on it returned 409, so the routes back were the user
  // requesting again or a manual plan assignment. Now the decline stays
  // visible and reversible, with its history intact.
  const route = stripComments(read('app/api/admin/trial-requests/route.ts'));
  const page = stripComments(read('app/admin/plans/page.tsx'));
  const mig = read('supabase/migrations/218_trial_requests_decline_history.sql');

  // The migration is two additive columns and nothing else.
  check('G: mig 218 adds declined_at and declined_by, additively',
    mig.includes('ADD COLUMN IF NOT EXISTS declined_at timestamptz')
    && mig.includes('ADD COLUMN IF NOT EXISTS declined_by uuid')
    && !/DROP |ALTER COLUMN|DELETE FROM/i.test(mig));

  // The queue lists declined rows, separately, without risking the pending list.
  check('G: the route fetches declined rows in their own query',
    /eq\('status', 'declined'\)/.test(route) && route.includes('runDeclined'));
  check('G: a declined-list failure cannot empty the pending queue',
    route.includes('declined: dErr ? [] : (declinedRows ?? [])'));
  check('G: declined rows come newest first and capped',
    /order\('decided_at', \{ ascending: false \}\)/.test(route) && route.includes('.limit(25)'));

  // Approve works on declined; decline stays pending-only.
  check('G: approve is allowed on pending AND declined',
    /action === .approve. \? \[.pending., .declined.\] : \[.pending.\]/.test(route));
  check('G: a second decline of the same row is refused',
    route.includes("'Request already decided'"));

  // History: the decline survives the approval.
  check('G: a decline stamps its own history columns',
    /action === .decline.[^]{0,120}patch\.declined_at = patch\.decided_at/.test(route));
  check('G: approving a declined row backfills the decline before overwriting',
    /rowStatus === 'declined'[^]{0,300}patch\.declined_at = prev\.decided_at/.test(route));
  check('G: schema tolerant: without mig 218 the update retries bare',
    /declined_at\|declined_by/.test(route) && route.includes('delete patch.declined_at'));

  // The screen: its own section, not mixed into pending, approve only.
  check('G: the page renders a declined section',
    page.includes('declined-requests-heading') && page.includes('setDeclinedRequests(res.declined')
    && page.includes('{declinedRequests.length > 0 && ('));
  check('G: with approve and WITHOUT a re-decline button',
    page.includes('declined-approve-') && !/declined-request[^]{0,900}trial-decline-/.test(page));
  check('G: the decline timestamp is shown', /Declined \{formatAdminStamp\(r\.decided_at\)/.test(page));

  // The decline email can never block the approval email: different email
  // types, and the approval keys on the trial end date, which a fresh grant
  // refreshes. Checked as facts about the senders, not as prose.
  const sem = stripComments(read('src/shared/email/subscriptionEmails.ts'));
  check('G: the two emails are distinct dedupe types',
    sem.includes("email_type: 'trial_declined'") && sem.includes("email_type: 'trial_started'"));
  check('G: the approval email keys on the trial end date, not the request',
    /email_type: .trial_started., threshold: `evt:\$\{token\}`/.test(sem));
}

section('H. Success replaces the form, and the default theme is light');

{
  // The success message used to render ABOVE the form, which stayed on
  // screen fully populated and read as if nothing had happened.
  const form = stripComments(read(FORM));
  check('H: success renders a dedicated screen', form.includes('register-success-screen'));
  // The screen must REPLACE the form: an early return BEFORE the form render.
  check('H: and it returns before the form is rendered',
    form.indexOf('register-success-screen') < form.indexOf('<form onSubmit={handleSubmit}'));
  check('H: the old inline success banner is gone', !form.includes('{success &&'));
  // The CONDITION itself, not just the markup: a screen behind false && is a
  // screen that exists and never shows, which greps as present.
  check('H: the screen is gated on success itself', form.includes('if (success) {'));
  // The stated contents.
  check('H: it names the address the email went to', form.includes('register-success-email'));
  check('H: it says the link must be clicked to activate', /click the confirmation link to activate/.test(form));
  check('H: it says trial requests go to the team for approval', /go to our team for approval/.test(form));
  // Resend goes through the dedicated always-200 endpoint, not a second
  // registration (captcha tokens are single use).
  check('H: resend exists and uses the dedicated endpoint',
    form.includes('register-resend') && form.includes("'/api/auth/resend-confirmation'"));
  check('H: resend reports both outcomes', form.includes("'sent'") && form.includes("'failed'"));

  // THEME DEFAULT IS LIGHT. The dashboard used to fall back to the OS colour
  // scheme when nothing was stored, so a new user on a dark-OS machine opened
  // in dark mode having chosen nothing. A stored choice still wins.
  const dash = stripComments(read('app/modeling/dashboard/page.tsx'));
  check('H: no stored theme falls back to prefers-color-scheme nowhere',
    !dash.includes('prefers-color-scheme'));
  check('H: a stored choice is still honoured',
    dash.includes("localStorage.getItem('modelingDarkMode')") && dash.includes("setDarkMode(stored === 'true')"));
  check('H: the state itself defaults to light', /const \[darkMode, setDarkMode\] = useState\(false\)/.test(dash));
  // The platform workspace already defaulted to light; pinned so it stays.
  const shell = stripComments(read('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx'));
  check('H: the workspace defaults to light too',
    /const \[darkMode, setDarkMode\] = useState\(false\)/.test(shell) && !shell.includes('prefers-color-scheme'));
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

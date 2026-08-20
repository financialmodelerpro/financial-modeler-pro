/**
 * verify-signup-alert.ts (2026-08-20)
 *
 * SUPPORT IS TOLD ABOUT EVERY NEW REGISTRATION, AND A FAILED EMAIL NEVER
 * FAILS A SIGNUP.
 *
 * The template is RENDERED and its output inspected, not grepped for the
 * fields it is supposed to carry. A source grep proves a variable is
 * mentioned; it does not prove the value reaches the page, and this email is
 * the only record support gets of who signed up.
 *
 * Section D is the one that found a real defect: every field here is typed by
 * whoever is registering, so an unescaped one puts attacker-controlled markup
 * in an inbox we read and act on. The first version escaped the table cells
 * and interpolated the name RAW into the intro paragraph and the subject.
 *
 * Run: npx tsx scripts/verify-signup-alert.ts
 * No em dashes in this file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { newRegistrationAlertTemplate } from '../src/shared/email/templates/newRegistrationAlert';

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { passed++; return; }
  failures.push(`${label}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 58 - t.length))}`);
const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const DISPATCH = 'src/shared/email/newRegistrationAlert.ts';
const ROUTE = 'app/api/auth/register/route.ts';

const FULL = {
  userId: 'u-123',
  name: 'Muhammad Abuzar',
  email: 'abuzar@example.com',
  phone: '+923460682043',
  city: 'Vihari',
  country: 'Pakistan',
  company: 'SFA',
  jobTitle: 'Sr Associate Financial Analyst',
  worksInRealEstate: true,
  roleNote: 'Feasibility for mixed-use schemes.\nMostly residential towers.',
  registeredAt: '2026-08-20T07:03:52.068Z',
  hub: 'modeling' as const,
};

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  section('A. Every requested field reaches the rendered email');

  const { subject, html } = await newRegistrationAlertTemplate(FULL);

  // The list the pass was asked for, checked against the OUTPUT.
  for (const [label, value] of [
    ['name', FULL.name], ['email', FULL.email], ['phone', FULL.phone],
    ['city', FULL.city], ['country', FULL.country],
    ['company', FULL.company], ['job title', FULL.jobTitle],
  ] as const) {
    check(`A: ${label} appears in the email`, html.includes(value));
  }
  check('A: the yes/no answer is stated in words, not a bare true',
    html.includes('Yes, actively working in real estate') && !html.includes('>true<'));
  check('A: the free text appears IN FULL, both lines',
    html.includes('Feasibility for mixed-use schemes.') && html.includes('Mostly residential towers.'));
  check('A: its line break survives as markup, not as a literal \\n',
    html.includes('<br/>'));
  check('A: the timestamp is rendered and says UTC',
    html.includes('2026-08-20 07:03 UTC'));
  check('A: there is a link to the user in the admin panel',
    html.includes('/admin/users/u-123') && html.includes('Open this user in admin'));
  check('A: the subject names the person', subject.includes('Muhammad Abuzar'));
  check('A: and flags the qualification, which is what decides urgency',
    subject.includes('[real estate]'));

  // -------------------------------------------------------------------------
  section('B. Absent fields degrade honestly');

  {
    const { subject: s2, html: h2 } = await newRegistrationAlertTemplate({
      ...FULL, userId: '', company: null, jobTitle: null,
      worksInRealEstate: null, roleNote: null, phone: null, hub: 'training',
    });
    // A BLANK CELL READS AS A RENDERING FAULT. Say "not given" instead.
    check('B: a missing field says so rather than rendering blank', h2.includes('not given'));
    check('B: an unasked question says "not asked", not "No"',
      h2.includes('not asked') && !h2.includes('>No<'));
    check('B: an empty free text omits the block entirely', !h2.includes('What they do'));
    // NO DEAD LINKS. A training signup has no users row.
    check('B: with no user record, the admin button is omitted',
      !h2.includes('Open this user in admin'));
    check('B: and the email says why rather than leaving a gap',
      h2.includes('no admin page to link to'));
    check('B: the subject names the right hub', s2.includes('Training Hub'));
    check('B: and carries no qualification flag when it was not asked',
      !s2.includes('[real estate]') && !s2.includes('[not real estate]'));
  }

  // -------------------------------------------------------------------------
  section('C. False is an answer, and it is not the same as unasked');

  {
    const { subject: s3, html: h3 } = await newRegistrationAlertTemplate({ ...FULL, worksInRealEstate: false });
    check('C: a No renders as No', h3.includes('>No</span>'));
    check('C: and is flagged in the subject', s3.includes('[not real estate]'));
    check('C: it is not confused with "not asked"', !h3.includes('not asked'));
  }

  // -------------------------------------------------------------------------
  section('D. Attacker-controlled fields cannot inject markup');

  {
    const evil = await newRegistrationAlertTemplate({
      ...FULL,
      name: '<script>alert(1)</script>',
      company: '"><b>bold</b>',
      roleNote: '<img src=x onerror=alert(1)>',
      email: 'a@b.c',
    });
    // THE DEFECT THIS FOUND: the name was escaped in its table cell and
    // interpolated RAW into the intro paragraph, so the email carried a live
    // script tag.
    check('D: no raw script tag survives anywhere in the email',
      !evil.html.includes('<script>'), 'name is interpolated somewhere unescaped');
    check('D: the name is escaped where it appears',
      evil.html.includes('&lt;script&gt;'));
    check('D: an image with an onerror handler is neutralised',
      !evil.html.includes('<img src=x'));
    check('D: a quote-and-tag break out of an attribute is neutralised',
      !evil.html.includes('"><b>bold'));
    check('D: the escape does not double-encode an ampersand',
      !(await newRegistrationAlertTemplate({ ...FULL, company: 'A & B' })).html.includes('&amp;amp;'));
    // The subject is not HTML, but a newline in it is still not acceptable.
    const nl = await newRegistrationAlertTemplate({ ...FULL, name: 'Bad\nName\r\nHere' });
    check('D: the subject collapses newlines', !/[\r\n]/.test(nl.subject));
    const long = await newRegistrationAlertTemplate({ ...FULL, name: 'x'.repeat(400) });
    check('D: and caps its length', long.subject.length < 160, String(long.subject.length));
  }

  // -------------------------------------------------------------------------
  section('E. One sending path, and it cannot fail a registration');

  {
    const dispatch = stripComments(read(DISPATCH));
    const route = stripComments(read(ROUTE));

    // ONE PATH. The dispatcher owns the sender, the recipient and the failure
    // behaviour, so no caller re-decides any of them.
    check('E: it uses the shared sendEmail, not its own transport',
      dispatch.includes("from './sendEmail'") && !dispatch.includes('fetch('));
    check('E: the sender is the shared no-reply constant', dispatch.includes('FROM.noreply'));
    check('E: the recipient defaults to support', dispatch.includes('support@financialmodelerpro.com'));
    check('E: and is overridable for a non-production deploy',
      dispatch.includes('EMAIL_SIGNUP_ALERT_TO'));

    // A FAILED EMAIL MUST NOT FAIL A SIGNUP.
    check('E: the dispatcher catches everything', /catch\s*\(/.test(dispatch));
    check('E: it never rethrows', !/throw\s/.test(dispatch));
    check('E: it logs the failure rather than swallowing it silently',
      dispatch.includes('[reg-alert] FAILED'));
    check('E: and logs the message id on success, so delivery is checkable',
      dispatch.includes('[reg-alert] sent') && dispatch.includes('res.id'));

    // The call site must not await it, or a slow Brevo delays every signup.
    check('E: the register route fires it without awaiting',
      /void \(async \(\) => \{/.test(route) && route.includes('sendNewRegistrationAlert'));
    // Compare the CALL, not the import: indexOf finds the import statement at
    // the top of the file, which is of course before everything.
    check('E: and only AFTER the insert has succeeded',
      route.indexOf('void (async () => {') > route.indexOf('if (insertErr)'));
    check('E: the route does not build its own email',
      !route.includes('newRegistrationAlertTemplate'));
  }

  // -------------------------------------------------------------------------
  console.log(`\n${'='.repeat(64)}`);
  if (failures.length === 0) {
    console.log(`verify-signup-alert: ${passed} passed, 0 failed`);
  } else {
    console.log(`verify-signup-alert: ${passed} passed, ${failures.length} FAILED`);
    for (const f of failures) console.log(`  FAIL  ${f}`);
    process.exit(1);
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });

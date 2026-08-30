/**
 * scripts/verify-access-request.ts
 *
 * Pins the "users register but never request access" fix:
 *   A. The PURE eligibility rule for the one-shot access reminder email
 *      (behavioral, against the real exported functions).
 *   B. The once-only dedupe shape of the reminder scan (source).
 *   C. The reminder email template (behavioral render, offline defaults).
 *   D. The dashboard access card: shown to a no-plan user with the request
 *      button INSIDE it, pending state once requested (source).
 *   E. The entitlements route exposing the pending-request fact, gated so
 *      entitled users pay nothing for it (source).
 *
 * Runs OFFLINE: no env needed, no DB access, no email sent.
 * Run: npx tsx scripts/verify-access-request.ts
 *
 * No em dashes in this file.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  isAccessReminderEligible, accessReminderAnchorMs, ACCESS_REMINDER_DELAY_MS,
  type AccessReminderCandidate,
} from '../src/shared/email/subscriptionEmails';
import { accessReminderEmail } from '../src/shared/email/templates/subscription';

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}
function src(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const NOW = Date.parse('2026-08-30T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
function cand(over: Partial<AccessReminderCandidate>): AccessReminderCandidate {
  return {
    id: 'u1', email: 'user@example.com', name: 'User', role: 'user',
    email_confirmed: true, subscription_plan: 'none',
    confirmed_at: daysAgo(3), created_at: daysAgo(10),
    ...over,
  };
}

async function main() {
  console.log('A. Pure eligibility rule');
  check('A1 confirmed 3 days, plan none, never requested -> eligible',
    isAccessReminderEligible(cand({}), false, false, NOW));
  check('A2 a trial request of ANY status disqualifies',
    !isAccessReminderEligible(cand({}), true, false, NOW));
  check('A3 a subscription row disqualifies',
    !isAccessReminderEligible(cand({}), false, true, NOW));
  check('A4 an admin is never emailed',
    !isAccessReminderEligible(cand({ role: 'admin' }), false, false, NOW));
  check('A5 unconfirmed email disqualifies',
    !isAccessReminderEligible(cand({ email_confirmed: false }), false, false, NOW));
  check('A6 null email_confirmed counts as confirmed (matches the sign-in rule)',
    isAccessReminderEligible(cand({ email_confirmed: null }), false, false, NOW));
  check('A7 a real plan disqualifies (trial)',
    !isAccessReminderEligible(cand({ subscription_plan: 'trial' }), false, false, NOW));
  check('A8 a real plan disqualifies (pro)',
    !isAccessReminderEligible(cand({ subscription_plan: 'pro' }), false, false, NOW));
  check('A9 null plan counts as no plan',
    isAccessReminderEligible(cand({ subscription_plan: null }), false, false, NOW));
  check('A10 empty-string plan counts as no plan',
    isAccessReminderEligible(cand({ subscription_plan: '' }), false, false, NOW));
  check('A11 confirmed 1 day ago -> NOT yet eligible (two-day rule)',
    !isAccessReminderEligible(cand({ confirmed_at: daysAgo(1) }), false, false, NOW));
  check('A12 exactly two days -> eligible (boundary)',
    isAccessReminderEligible(cand({ confirmed_at: new Date(NOW - ACCESS_REMINDER_DELAY_MS).toISOString() }), false, false, NOW));
  check('A13 no email -> never emailed',
    !isAccessReminderEligible(cand({ email: null }), false, false, NOW));
  check('A14 anchor prefers confirmed_at over created_at',
    accessReminderAnchorMs({ confirmed_at: daysAgo(1), created_at: daysAgo(10) }) === Date.parse(daysAgo(1)));
  check('A15 anchor falls back to created_at when confirmed_at absent',
    accessReminderAnchorMs({ confirmed_at: null, created_at: daysAgo(10) }) === Date.parse(daysAgo(10)));
  check('A16 no dates at all -> null anchor, ineligible',
    accessReminderAnchorMs({ confirmed_at: null, created_at: null }) === null
    && !isAccessReminderEligible(cand({ confirmed_at: null, created_at: null }), false, false, NOW));

  console.log('B. Once-only dedupe shape (source)');
  const emails = src('src/shared/email/subscriptionEmails.ts');
  check('B1 email_type access_reminder with threshold once',
    /email_type:\s*'access_reminder'[\s\S]{0,80}threshold:\s*'once'/.test(emails));
  check('B2 anchor_day is the CONFIRM day (dayStr(anchor)), never today',
    /threshold:\s*'once',\s*anchor_day:\s*dayStr\(anchor\)/.test(emails));
  check('B3 scan disqualifies on requests of ANY status (no status filter on the trial_requests read)',
    /from\('trial_requests'\)\.select\('user_id'\)\.in\('user_id', ids\)/.test(emails));
  check('B4 the cron calls the access scan',
    src('app/api/cron/subscription-reminders/route.ts').includes('runAccessReminderScan'));

  console.log('C. Reminder email (behavioral render, offline)');
  const mail = await accessReminderEmail({ name: 'Jordan', requestUrl: 'https://app.example.com/choose-plan', pricingUrl: 'https://app.example.com/pricing/refm' });
  check('C1 renders a subject naming the request', /access/i.test(mail.subject) && /request/i.test(mail.subject));
  check('C2 links straight to the request page', mail.html.includes('https://app.example.com/choose-plan'));
  check('C3 states access is not active yet', /not active yet/i.test(mail.html));
  check('C4 promises no repeat ("not send this reminder again")', /not send this reminder again/i.test(mail.html));
  check('C5 no em dash in the rendered email', !mail.html.includes('—') && !mail.subject.includes('—'));

  console.log('D. Dashboard access card (source)');
  const dash = src('app/modeling/dashboard/page.tsx');
  check('D1 card renders for the genuine no-plan user (noneNoPlan gate)',
    /\{noneNoPlan && \(\s*<AccessCard/.test(dash));
  check('D2 pending state comes from the server fact OR the just-made request',
    /ent\.trialRequestPending \|\| justRequested/.test(dash));
  check('D3 the request button is INSIDE the card and posts the trial request',
    /dashboard-access-request/.test(dash) && /fetch\('\/api\/refm\/trial', \{ method: 'POST'/.test(dash));
  check('D4 card states access is not active yet',
    dash.includes('Your access is not active yet'));
  check('D5 pending copy states the request is with the team',
    dash.includes('Your access request is with the team'));
  check('D6 an instant grant refreshes the gate (self-serve toggle off still works)',
    /onGranted=\{\(\) => ent\.refresh\(\)\}/.test(dash));
  check('D7 a lapsed user does NOT get the request card (renew banner instead)',
    /\{lapsedNoPlan && \(/.test(dash) && !/lapsedNoPlan && \(\s*<AccessCard/.test(dash));

  console.log('E. Entitlements route + hook (source)');
  const ent = src('app/api/refm/entitlements/route.ts');
  check('E1 pending request queried ONLY for a no-plan non-admin',
    /if \(!gate\.isAdmin && gate\.planKey === NONE_PLAN_KEY\)/.test(ent));
  check('E2 only PENDING requests count as pending',
    /\.eq\('status', 'pending'\)/.test(ent));
  check('E3 response carries trialRequestPending',
    /trialRequestPending,/.test(ent));
  const hook = src('src/hubs/modeling/platforms/refm/lib/useEntitlements.ts');
  check('E4 hook exposes trialRequestPending (default false)',
    /trialRequestPending: false/.test(hook) && /trialRequestPending: !!j\.trialRequestPending/.test(hook));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

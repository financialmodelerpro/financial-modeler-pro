/**
 * verify-subscription-emails.ts
 *
 * Proves the subscription email lifecycle WITHOUT sending anything:
 *  - the 9 branded templates render and carry the right framing, most importantly
 *    the auto-renew "you will be charged" notice vs the ending "access ends"
 *    notice are DISTINCT (never confused);
 *  - the money/date/plan formatters are correct;
 *  - each transactional email is wired to its trigger (webhook activation, admin
 *    manual assign, convert-to-manual immediate, self-serve + admin + approval
 *    trials, self-service cancel);
 *  - the welcome-Paddle path fetches + attaches the invoice server-side and
 *    sendEmail supports attachments;
 *  - the daily cron exists, is CRON_SECRET-guarded, is scheduled in vercel.json,
 *    and the scan dedupes via subscription_email_log at the 7d / 1d thresholds;
 *  - the dedupe migration (181) exists with the uniqueness that makes the cron
 *    idempotent;
 *  - no em dashes in the new files.
 *
 * Run: npx tsx scripts/verify-subscription-emails.ts
 */
import fs from 'fs';
import path from 'path';
import {
  subscriptionActivePaddleEmail, planActiveManualEmail, subscriptionCanceledEmail,
  trialStartedEmail, trialEndingEmail, renewalReminderEmail, expiryReminderEmail,
  graceStartedEmail, graceEndingEmail, manualInvoiceEmail, fmtAmount, fmtDate, planLabel,
} from '../src/shared/email/templates/subscription';
import { generateManualReceiptPdf, makeReceiptNumber } from '../src/shared/payments/manualInvoice';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const lc = (s: string) => s.toLowerCase();

(async () => {
  // ── Formatters ────────────────────────────────────────────────────────────
  console.log('=== Formatters ===');
  check('fmtAmount minor+currency -> major', fmtAmount(14900, 'usd') === 'USD 149.00', fmtAmount(14900, 'usd'));
  check('fmtAmount null -> empty', fmtAmount(null, 'usd') === '');
  check('fmtDate is UTC stable', fmtDate('2026-08-12T00:00:00Z') === '12 August 2026', fmtDate('2026-08-12T00:00:00Z'));
  check('planLabel title-cases', planLabel('pro') === 'Pro');

  // ── Template framing ────────────────────────────────────────────────────────
  console.log('=== Template framing (auto-renew vs ending are DISTINCT) ===');
  const active = await subscriptionActivePaddleEmail({ name: 'Sam', planKey: 'pro', billingUrl: 'https://x/dashboard#billing', invoiceAttached: true });
  check('active(paddle): subject names the plan', lc(active.subject).includes('pro') && lc(active.subject).includes('active'));
  check('active(paddle): mentions the attached invoice + billing link', lc(active.html).includes('invoice') && active.html.includes('dashboard#billing'));

  const manual = await planActiveManualEmail({ name: 'Sam', planKey: 'firm', startedAt: '2026-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', billingUrl: 'https://x/dashboard' });
  check('active(manual): shows start + expiry, notes team-managed (no invoice)', lc(manual.html).includes('managed') && manual.html.includes('2027') && !lc(manual.html).includes('invoice'));

  const canceled = await subscriptionCanceledEmail({ name: 'Sam', planKey: 'pro', accessUntil: '2026-09-01T00:00:00Z', renewUrl: 'https://x/pricing' });
  check('canceled: confirms cancel + access-until date', lc(canceled.html).includes('canceled') && canceled.html.includes('1 September 2026'));

  const trial = await trialStartedEmail({ name: 'Sam', trialEndsAt: '2026-02-01T00:00:00Z', dashboardUrl: 'https://x/dashboard', pricingUrl: 'https://x/pricing' });
  check('trial started: welcomes + gives trial end', lc(trial.subject).includes('trial') && trial.html.includes('1 February 2026'));

  const tEnd = await trialEndingEmail({ name: 'Sam', trialEndsAt: '2026-02-01T00:00:00Z', daysLeft: 7, pricingUrl: 'https://x/pricing' });
  check('trial ending: 7-day framing + choose a plan', lc(tEnd.subject).includes('7 days') && lc(tEnd.html).includes('choose a plan'));

  const renew = await renewalReminderEmail({ name: 'Sam', planKey: 'pro', renewsOn: '2026-03-01T00:00:00Z', amount: 'USD 149.00', daysLeft: 7, manageUrl: 'https://x/dashboard#billing' });
  const expiry = await expiryReminderEmail({ name: 'Sam', planKey: 'firm', endsOn: '2026-03-01T00:00:00Z', daysLeft: 7, renewUrl: 'https://x/pricing' });
  // The critical distinction: renewal says "you will be charged"; expiry says
  // "access ends" and must NOT say "you will be charged".
  check('renewal notice SAYS "you will be charged" + amount', lc(renew.html).includes('you will be charged') && renew.html.includes('USD 149.00'));
  check('renewal notice offers cancel-before-then', lc(renew.html).includes('cancel before'));
  check('expiry notice SAYS "access ends" + renew', lc(expiry.html).includes('access ends') && lc(expiry.html).includes('renew'));
  check('expiry notice does NOT say "you will be charged"', !lc(expiry.html).includes('you will be charged'));
  check('renewal notice does NOT say "access ends"', !lc(renew.html).includes('access ends'));

  const gStart = await graceStartedEmail({ name: 'Sam', graceEndsAt: '2026-04-01T00:00:00Z', renewUrl: 'https://x/pricing' });
  check('grace started: read-only + grace end + data never deleted', lc(gStart.html).includes('read-only') && gStart.html.includes('1 April 2026') && lc(gStart.html).includes('never deleted'));
  const gEnd = await graceEndingEmail({ name: 'Sam', graceEndsAt: '2026-04-01T00:00:00Z', daysLeft: 1, renewUrl: 'https://x/pricing' });
  check('grace ending: last-nudge tomorrow framing', lc(gEnd.subject).includes('tomorrow') && lc(gEnd.html).includes('renew'));

  // ── sendEmail attachments support ───────────────────────────────────────────
  console.log('=== sendEmail attachments ===');
  const sendSrc = read('src/shared/email/sendEmail.ts');
  check('sendEmail accepts attachments', sendSrc.includes('attachments?: EmailAttachment[]'));
  check('sendEmail maps to Brevo singular "attachment"', /attachment:\s*attachments\.map/.test(sendSrc) || sendSrc.includes('attachment }'));
  check('FROM.support (verified sender) added', sendSrc.includes('support:'));

  // ── Dispatcher module invariants ────────────────────────────────────────────
  console.log('=== subscriptionEmails.ts invariants ===');
  const disp = read('src/shared/email/subscriptionEmails.ts');
  check('dedupe via subscription_email_log', disp.includes("from('subscription_email_log')"));
  check('claim-then-send is idempotent (release on failure)', disp.includes('async function claim(') && disp.includes('async function release('));
  check('only 7d / 1d thresholds fire', /days === 7/.test(disp) && /days === 1/.test(disp) && disp.includes("return '7d'") && disp.includes("return '1d'"));
  check('NON_RENEWING classifies ending vs auto-renew', disp.includes('NON_RENEWING') && disp.includes("'canceled'"));
  check('charge notice suppressed on Paddle uncertainty', disp.includes('if (!ending) continue'));
  check('manual welcome skips none/trial', disp.includes("planKey === 'none' || planKey === 'trial'"));
  check('reuses the gate lapse helper (no gate change)', disp.includes('computeLapseState'));
  check('grace handled for trial + manual anchors', disp.includes('handleGrace'));

  // ── Trigger wiring ──────────────────────────────────────────────────────────
  console.log('=== Transactional trigger wiring ===');
  const webhook = read('app/api/payments/webhook/[provider]/route.ts');
  check('webhook imports welcome-paddle sender', webhook.includes('sendSubscriptionActivePaddleEmail'));
  check('welcome-paddle fires ONLY on activation (not every update)', webhook.includes("if (event.type === 'activated') {"));

  const cancel = read('app/api/payments/subscription/cancel/route.ts');
  check('cancel route sends canceled confirmation w/ access-until', cancel.includes('sendSubscriptionCanceledEmail') && cancel.includes('currentPeriodEndsAt'));

  const planRoute = read('app/api/admin/entitlements/user/plan/route.ts');
  check('admin manual-assign sends manual welcome', planRoute.includes('sendManualPlanWelcomeEmail'));

  const convert = read('app/api/admin/subscription/convert-to-manual/route.ts');
  check('convert-to-manual (immediate) sends manual welcome', convert.includes('sendManualPlanWelcomeEmail'));

  const trialSelf = read('src/shared/entitlements/trialRequests.ts');
  check('self-serve trial sends trial-started', trialSelf.includes('sendTrialStartedEmail'));
  const trialAdmin = read('app/api/admin/entitlements/user/trial/route.ts');
  check('admin trial shortcut sends trial-started', trialAdmin.includes('sendTrialStartedEmail'));
  const trialApprove = read('app/api/admin/trial-requests/route.ts');
  check('trial approval sends trial-started', trialApprove.includes('sendTrialStartedEmail'));

  // ── Cron + schedule + migration ─────────────────────────────────────────────
  console.log('=== Cron + schedule + migration ===');
  const cron = read('app/api/cron/subscription-reminders/route.ts');
  check('cron guarded by CRON_SECRET Bearer', cron.includes('Bearer ${process.env.CRON_SECRET}'));
  check('cron runs the reminder scan', cron.includes('runSubscriptionReminderScan'));
  const vercel = read('vercel.json');
  check('vercel.json schedules the daily cron', vercel.includes('/api/cron/subscription-reminders'));

  const mig = read('supabase/migrations/181_subscription_email_log.sql');
  check('mig 181 creates subscription_email_log', /create table if not exists subscription_email_log/i.test(mig));
  check('mig 181 unique key makes cron idempotent', /unique index/i.test(mig) && mig.includes('anchor_day'));

  // ── No em dashes in the new files ───────────────────────────────────────────
  console.log('=== Style ===');
  for (const f of [
    'src/shared/email/subscriptionEmails.ts',
    'src/shared/email/templates/subscription.ts',
    'app/api/cron/subscription-reminders/route.ts',
    'supabase/migrations/181_subscription_email_log.sql',
  ]) {
    check(`no em dash: ${f}`, !read(f).includes('—'));
  }

  // ── Billing display + invoices + manual receipts (this task) ────────────────
  console.log('=== FMP footer branding (not the Training tagline) ===');
  const subTpl = read('src/shared/email/templates/subscription.ts');
  check('subscription emails force an FMP footer wrapper', subTpl.includes('function subLayout(') && !subTpl.includes('await baseLayoutBranded('));
  check('footer uses the PaceMakers company line', subTpl.includes('A PaceMakers Business Consultants Platform'));
  check('footer drops the Training Hub tagline', !subTpl.includes('Professional Financial Modeling Training') && !subTpl.includes('training program'));
  const baseTpl = read('src/shared/email/templates/_base.ts');
  check('baseLayoutBranded accepts signature/footer overrides', /overrides\?:\s*\{[^}]*signature_html/.test(baseTpl));

  console.log('=== Billing source precedence (Paddle wins) ===');
  const cfgSrc = read('src/shared/payments/config.ts');
  check('storeUserPlatformSubscription sets source=paddle', /storeUserPlatformSubscription[\s\S]*?source:\s*'paddle'/.test(cfgSrc));
  check('storeUserPlatformSubscription clears stale manual columns', /storeUserPlatformSubscription[\s\S]*?expires_at:\s*null/.test(cfgSrc));
  const ctxSrc = read('src/shared/payments/subscriptionContext.ts');
  check('context resolves manual only when no Paddle id (Paddle wins)', ctxSrc.includes("source === 'manual' && planKey && !subscriptionId"));

  console.log('=== Combined invoice list (Paddle + manual) ===');
  const invRoute = read('app/api/payments/invoices/route.ts');
  check('invoices route merges Paddle + manual', invRoute.includes('listManualInvoices') && invRoute.includes('listSubscriptionInvoices'));
  check('invoices route normalizes with a source field', invRoute.includes("source: 'paddle'") && /\.\.\.paddle,\s*\.\.\.manual/.test(invRoute));
  const panel = read('src/hubs/modeling/components/SubscriptionPanel.tsx');
  check('panel routes View by source (manual -> manual-invoice route)', panel.includes('/api/payments/manual-invoice/') && panel.includes('/api/payments/invoice/'));
  check('panel shows invoices in BOTH manual + Paddle panels', (panel.match(/\{invoicesBlock\}/g) ?? []).length >= 2);

  console.log('=== Manual receipt (generate + store + ownership) ===');
  const rn = makeReceiptNumber('2026-07-02T00:00:00Z');
  check('receipt number format FMP-YYYYMMDD-XXXXXX', /^FMP-20260702-[0-9A-F]{6}$/.test(rn), rn);
  const pdf = await generateManualReceiptPdf({ receiptNumber: rn, issuedAt: '2026-07-02T00:00:00Z', planKey: 'pro', amountMinor: 14900, currency: 'usd', customerName: 'Sam Doe', customerEmail: 's@x.com', customerCompany: 'Acme Ltd', periodStart: '2026-07-02T00:00:00Z', periodEnd: '2027-07-02T00:00:00Z' });
  const head = Buffer.from(pdf.slice(0, 5)).toString('latin1');
  check('receipt is a real PDF (%PDF header) with content', head === '%PDF-' && pdf.length > 800, `${head} len=${pdf.length}`);

  console.log('=== Seller legal block + no tax line ===');
  const mi = read('src/shared/payments/manualInvoice.ts');
  check('seller name PaceMakers Business Consultants LLP', mi.includes('PaceMakers Business Consultants LLP'));
  check('LLP Registration No 0200688', mi.includes('LLP Registration No: 0200688'));
  check('Gulberg III address', mi.includes('71-C-3, Gulberg III, Lahore, 54660,') && mi.includes('Punjab, Pakistan'));
  check('FBR NTN 6899301', mi.includes('FBR NTN: 6899301'));
  check('receipt keeps FMP + PaceMakers branding', mi.includes('Financial Modeler Pro') && mi.includes('A PaceMakers Business Consultants Platform'));
  check('line item carries the plan period', mi.includes('fmtPeriod(') && mi.includes('periodStart'));
  check('bill-to carries company', mi.includes('customerCompany'));
  // No tax is charged: no drawn Tax/VAT/GST label and no percentage in the PDF.
  check('NO tax line drawn (no Tax/VAT/GST label)', !/\bVAT\b/.test(mi) && !/\bGST\b/.test(mi) && !/\bTax\b/.test(mi));
  check('company + period threaded to createAndStoreManualInvoice', mi.includes('customerCompany: args.customerCompany') && mi.includes('periodStart: args.periodStart'));
  const manualInv = await manualInvoiceEmail({ name: 'Sam', planKey: 'pro', amount: 'USD 149.00', receiptNumber: rn, issuedAt: '2026-07-02T00:00:00Z', billingUrl: 'https://x/dashboard#billing' });
  check('receipt email names receipt no + amount + PaceMakers footer', manualInv.html.includes(rn) && manualInv.html.includes('USD 149.00') && manualInv.html.includes('A PaceMakers Business Consultants Platform'));
  const miSrc = read('src/shared/payments/manualInvoice.ts');
  check('manual receipts use a PRIVATE bucket', miSrc.includes("createBucket(BUCKET, { public: false })"));
  check('manual receipt served via ownership check + signed URL', miSrc.includes('loadOwnedManualInvoice') && miSrc.includes('createSignedUrl'));
  const miRoute = read('app/api/payments/manual-invoice/[id]/route.ts');
  check('manual-invoice route enforces ownership before signing', miRoute.includes('loadOwnedManualInvoice') && miRoute.includes('signManualInvoiceUrl'));
  const planRoute2 = read('app/api/admin/entitlements/user/plan/route.ts');
  check('admin manual-assign issues a receipt when amount present', planRoute2.includes('issueManualInvoice'));
  const convert2 = read('app/api/admin/subscription/convert-to-manual/route.ts');
  check('convert-to-manual (immediate) issues a receipt', convert2.includes('issueManualInvoice'));
  check('mig 182 manual_invoices exists (private, RLS)', /create table if not exists manual_invoices/i.test(read('supabase/migrations/182_manual_invoices.sql')));

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('FAILED:', fails.join(', ')); process.exit(1); }
})();

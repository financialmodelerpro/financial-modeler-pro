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
  graceStartedEmail, graceEndingEmail, manualInvoiceEmail, planChangedEmail, planEndedEmail, fmtAmount, fmtDate, planLabel,
} from '../src/shared/email/templates/subscription';
import { generateManualReceiptPdf, makeReceiptNumber } from '../src/shared/payments/manualInvoice';
import { getPlatform, platformPricingSegment } from '../src/hubs/modeling/config/platforms';

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
  check('invoices route normalizes with a source field + newest-first merge', invRoute.includes("source: 'paddle'") && /\.\.\.byId\.values\(\),\s*\.\.\.manual/.test(invRoute));
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

  // ── C: per-platform pricing links (not bare /pricing) ───────────────────────
  console.log('=== Per-platform pricing links (C) ===');
  const refmPlat = getPlatform('real-estate');
  check('real-estate derives the refm segment', !!refmPlat && platformPricingSegment(refmPlat) === 'refm', refmPlat ? platformPricingSegment(refmPlat) : 'no platform');
  const emailsSrc = read('src/shared/email/subscriptionEmails.ts');
  check('email pricingUrl takes a platform + builds /pricing/<segment>', /function pricingUrl\(platform: string\)/.test(emailsSrc) && /\/pricing\/\$\{segment\}/.test(emailsSrc));
  check('no bare pricingUrl() left in emails (every call passes platform)', !/pricingUrl\(\)/.test(emailsSrc) && (emailsSrc.match(/pricingUrl\(platform\)/g) ?? []).length >= 6);
  const refmComp = read('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx');
  check('REFM grace banner links to the per-platform pricing page', /REFM_PRICING_HREF = `\/pricing\/\$\{platformPricingSegment/.test(refmComp) && /href=\{REFM_PRICING_HREF\}/.test(refmComp) && !/href="\/pricing"/.test(refmComp));
  const dash = read('app/modeling/dashboard/page.tsx');
  check('dashboard grace banner links per-platform (default refm)', /graceRenewHref = `\/pricing\/\$\{platformPricingSegment/.test(dash) && /href=\{graceRenewHref\}/.test(dash));
  check('dashboard grace banner no longer bare /pricing', !/data-testid="dashboard-grace-renew-link"[^>]*href="\/pricing"/.test(dash));

  // ── A: plan-change confirmation email ───────────────────────────────────────
  console.log('=== Plan-change confirmation email (A) ===');
  const up = await planChangedEmail({ name: 'Sam', planKey: 'firm', interval: 'annual', timing: 'immediate', effectiveAt: '2027-01-01T00:00:00Z', manageUrl: 'https://x/dashboard#billing', pricingUrl: 'https://x/pricing/refm' });
  check('immediate: names new plan + interval + effective-now framing', up.html.includes('Firm') && lc(up.html).includes('annually') && lc(up.html).includes('effective immediately'));
  check('immediate: subject names plan + interval', lc(up.subject).includes('firm') && lc(up.subject).includes('annual'));
  check('immediate: does NOT say scheduled / next cycle', !lc(up.html).includes('next billing cycle') && !lc(up.html).includes('scheduled'));
  const down = await planChangedEmail({ name: 'Sam', planKey: 'pro', interval: 'monthly', timing: 'scheduled', effectiveAt: '2026-08-01T00:00:00Z', manageUrl: 'https://x/dashboard#billing', pricingUrl: 'https://x/pricing/refm' });
  check('scheduled: next-cycle framing + effective date + no charge today', lc(down.html).includes('keep your current plan until then') && down.html.includes('1 August 2026') && lc(down.html).includes('no charge today'));
  check('scheduled: subject says scheduled', lc(down.subject).includes('scheduled'));
  check('plan-change email carries the per-platform pricing link + FMP footer', up.html.includes('/pricing/refm') && up.html.includes('A PaceMakers Business Consultants Platform'));
  const em2 = read('src/shared/email/subscriptionEmails.ts');
  check('sendPlanChangedEmail deduped (marker encodes plan+interval, keyed by timing)', /email_type: `plan_changed:\$\{planKey\}:\$\{args\.interval\}`/.test(em2) && /threshold: args\.timing/.test(em2));
  const cp = read('app/api/payments/subscription/change-plan/route.ts');
  check('change-plan sends immediate email on upgrade/interval', /timing: 'immediate'/.test(cp));
  check('change-plan sends scheduled email on downgrade', /timing: 'scheduled'/.test(cp));
  const wh2 = read('app/api/payments/webhook/[provider]/route.ts');
  check('no plan-change email from the updated webhook (single trigger, no dupes)', !/sendPlanChangedEmail/.test(wh2));

  // ── Per-event dedupe + visibility + manual cancel (Fix 1) ───────────────────
  console.log('=== Per-event dedupe + visibility + manual-ended email ===');
  const em3 = read('src/shared/email/subscriptionEmails.ts');
  check('welcome_manual keyed per-event (started_at token, not per-day)', /email_type: 'welcome_manual', threshold: `evt:\$\{args\.startedAt/.test(em3) && !/email_type: 'welcome_manual', threshold: 'once'/.test(em3));
  check('canceled keyed per-event (accessUntil token)', /email_type: 'canceled', threshold: `evt:\$\{args\.accessUntil/.test(em3));
  check('manual_invoice deduped via dispatch, keyed per-event (started_at:amount)', /email_type: 'manual_invoice',\s*\n\s*threshold: `evt:\$\{args\.issuedAt\}:\$\{args\.amountMinor\}`/.test(em3));
  check('issueManualInvoice returns a result (not silent void)', /Promise<IssueManualInvoiceResult>/.test(em3) && /skipped\?: 'no_amount'/.test(em3));
  check('manual_invoice still gated on amount > 0', /if \(!args\.amountMinor \|\| args\.amountMinor <= 0\) return \{ ok: false, skipped: 'no_amount' \}/.test(em3));
  check('dispatch logs outcome (sent id / skipped / FAILED) - visible, not swallowed', /\[sub-email\] sent \$\{key\.email_type\}/.test(em3) && /\[sub-email\] FAILED/.test(em3) && /console\.error/.test(em3));
  check('callbacks return the Brevo message id', (em3.match(/return \(await sendEmail\(/g) ?? []).length >= 8);
  check('sendPlanEndedEmail exists (manual plan removed -> confirmation)', /export async function sendPlanEndedEmail\(/.test(em3) && /email_type: 'plan_ended'/.test(em3));
  const planRoute3 = read('app/api/admin/entitlements/user/plan/route.ts');
  check('admin plan route sends plan-ended email on removal (none, had a real plan)', /newPlan === 'none'/.test(planRoute3) && /sendPlanEndedEmail\(/.test(planRoute3) && /prevPlan !== 'none' && prevPlan !== 'trial'/.test(planRoute3));
  const uap = read('src/components/admin/UserAccessPanel.tsx');
  check('admin UI notes amount-gate (no amount -> no receipt)', /No amount: no receipt is generated/.test(uap) && /manual-amount-note/.test(uap));
  // Manual plan-ended email renders
  const ended = await planEndedEmail({ name: 'Sam', planKey: 'firm', pricingUrl: 'https://x/pricing/refm' });
  check('plan-ended email: names plan, ended wording, per-platform link + FMP footer', ended.html.includes('Firm') && lc(ended.html).includes('has been ended') && ended.html.includes('/pricing/refm') && ended.html.includes('A PaceMakers Business Consultants Platform'));

  // ── Full invoice history (Fix 2) ────────────────────────────────────────────
  console.log('=== Full invoice history (durable ledger) ===');
  const miHist = read('src/shared/payments/manualInvoice.ts');
  check('ledger reader listPaddleLedgerInvoices (payment_transactions, source paddle)', /export async function listPaddleLedgerInvoices\(/.test(miHist) && /from\('payment_transactions'\)[\s\S]*?\.eq\('source', 'paddle'\)/.test(miHist));
  check('ledger ownership helper userOwnsPaddleTransaction', /export async function userOwnsPaddleTransaction\(/.test(miHist) && /\.eq\('external_id', txnId\)/.test(miHist));
  check('invoices route uses the DURABLE ledger (survives source flip)', invRoute.includes('listPaddleLedgerInvoices') && invRoute.includes('byId.set'));
  check('invoices route still enriches from live API when active (deduped by id)', invRoute.includes("ctx.state === 'ok'") && invRoute.includes('listSubscriptionInvoices'));
  const invIdRoute = read('app/api/payments/invoice/[id]/route.ts');
  check('Paddle PDF route authorizes from the ledger (not a live sub only)', invIdRoute.includes('userOwnsPaddleTransaction'));
  check('Paddle PDF route builds cfg without needing a live subscription', /loadPaymentSettings\(sb, platform\)/.test(invIdRoute) && /providerConfigFrom\(settings, 'paddle'\)/.test(invIdRoute));
  check('Paddle PDF route 404s gracefully when PDF unavailable (no crash)', /error: res\.error \}, \{ status: res\.status >= 500 \? 502 : 404/.test(invIdRoute));

  // ── Plan-change proration invoice attachment (Fix 3) ────────────────────────
  console.log('=== Plan-change proration invoice attachment ===');
  check('shared Paddle attachment helper (newest txn from subscription)', /async function fetchPaddleInvoiceAttachment\(/.test(em3) && /inv\.data\[0\]\.transactionId/.test(em3));
  check('plan-change attaches invoice for IMMEDIATE only (not scheduled)', /args\.timing === 'immediate' && args\.subscriptionId\s*\n?\s*\? await fetchPaddleInvoiceAttachment/.test(em3));
  check('change-plan route passes subscriptionId to the email', read('app/api/payments/subscription/change-plan/route.ts').includes('subscriptionId: ctx.subscriptionId'));
  const upA = await planChangedEmail({ name: 'Sam', planKey: 'firm', interval: 'annual', timing: 'immediate', effectiveAt: null, manageUrl: 'https://x/dashboard#billing', pricingUrl: 'https://x/pricing/refm', invoiceAttached: true });
  check('immediate plan-change email notes the attached invoice', lc(upA.html).includes('invoice for that charge is attached'));
  const upNo = await planChangedEmail({ name: 'Sam', planKey: 'firm', interval: 'annual', timing: 'scheduled', effectiveAt: '2026-08-01T00:00:00Z', manageUrl: 'https://x/dashboard#billing', pricingUrl: 'https://x/pricing/refm' });
  check('scheduled downgrade email has NO invoice note', !lc(upNo.html).includes('invoice'));

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('FAILED:', fails.join(', ')); process.exit(1); }
})();

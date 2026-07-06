/**
 * Subscription-lifecycle email templates (branded, via baseLayoutBranded).
 *
 * Nine builders, one per lifecycle email. Each returns { subject, html } and is
 * PURE (no IO): the caller in subscriptionEmails.ts does the user lookup, invoice
 * fetch, dedupe, and send. Content is deliberately plain + transparent, the
 * "you'll be charged" renewal notice most of all.
 *
 * No em dashes in this file.
 */
import { baseLayoutBranded, h1, p, button, divider } from './_base';

// ── FMP company footer (billing emails) ─────────────────────────────────────
// Subscription / billing emails carry the consistent FMP company line ("A
// PaceMakers Business Consultants Platform", matching the pricing credibility
// line), NOT the Training Hub tagline the shared email_branding default uses.
const FMP_SIGNATURE = `<div style="margin-top:32px;padding-top:24px;border-top:1px solid #e5e7eb;">
  <p style="margin:0;font-size:14px;color:#374151;font-weight:600;">Financial Modeler Pro</p>
  <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">A PaceMakers Business Consultants Platform</p>
  <p style="margin:4px 0 0;font-size:13px;color:#6b7280;"><a href="https://financialmodelerpro.com" style="color:#2E75B6;">financialmodelerpro.com</a></p>
</div>`;
const FMP_FOOTER = '© Financial Modeler Pro. A PaceMakers Business Consultants Platform. You are receiving this because you have an account with Financial Modeler Pro.';

/** Branded shell for every subscription/billing email, forcing the FMP footer. */
function subLayout(content: string): Promise<string> {
  return baseLayoutBranded(content, { signature_html: FMP_SIGNATURE, footer_text: FMP_FOOTER });
}

// ── Shared formatting helpers ───────────────────────────────────────────────

/** Format an ISO date as e.g. "12 August 2026" in UTC (locale-stable). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** Format a minor-unit amount + currency as e.g. "USD 149.00", or "" when absent. */
export function fmtAmount(amountMinor: number | null | undefined, currency: string | null | undefined): string {
  if (amountMinor == null || !Number.isFinite(amountMinor)) return '';
  const major = (amountMinor / 100).toFixed(2);
  return currency ? `${currency.toUpperCase()} ${major}` : major;
}

/** Title-case a plan key ("pro" -> "Pro"). */
export function planLabel(planKey: string): string {
  const k = (planKey || '').trim();
  if (!k) return 'your plan';
  return k.charAt(0).toUpperCase() + k.slice(1);
}

const greeting = (name: string | null | undefined): string =>
  name && name.trim() ? `Hi ${name.trim().split(' ')[0]},` : 'Hi,';

interface Built { subject: string; html: string; }

// ── 1. Welcome / subscription active (Paddle) ───────────────────────────────

export async function subscriptionActivePaddleEmail(data: {
  name: string | null; planKey: string; billingUrl: string; invoiceAttached: boolean;
}): Promise<Built> {
  const plan = planLabel(data.planKey);
  const html = await subLayout(`
    ${h1(`Your ${plan} subscription is active`)}
    ${p(greeting(data.name))}
    ${p(`Thank you for subscribing. Your <strong>${plan}</strong> plan is now active and every feature it includes is unlocked on your account.`)}
    ${p(data.invoiceAttached
      ? 'Your invoice is attached to this email for your records.'
      : 'You can download your invoice any time from the billing area of your dashboard.')}
    <div style="text-align:center;">${button('Go to billing', data.billingUrl)}</div>
    ${divider()}
    ${p('You can view invoices, update your payment method, or change your plan any time from the billing area.', 'font-size:13px;color:#6b7280;')}
  `);
  return { subject: `Your ${plan} subscription is active`, html };
}

// ── 2. Welcome / plan active (manual) ───────────────────────────────────────

export async function planActiveManualEmail(data: {
  name: string | null; planKey: string; startedAt: string | null; expiresAt: string | null; billingUrl: string;
}): Promise<Built> {
  const plan = planLabel(data.planKey);
  const start = fmtDate(data.startedAt);
  const expiry = fmtDate(data.expiresAt);
  const html = await subLayout(`
    ${h1(`Your ${plan} plan is active`)}
    ${p(greeting(data.name))}
    ${p(`Your <strong>${plan}</strong> plan has been set up on your account and every feature it includes is unlocked.`)}
    ${start ? p(`<strong>Start date:</strong> ${start}`) : ''}
    ${expiry ? p(`<strong>Access through:</strong> ${expiry}`) : ''}
    ${p('This plan is managed for you by our team (no online billing is attached). When it is close to expiring we will be in touch about renewing.')}
    <div style="text-align:center;">${button('Open your dashboard', data.billingUrl)}</div>
  `);
  return { subject: `Your ${plan} plan is active`, html };
}

// ── 3. Subscription canceled confirmation ───────────────────────────────────

export async function subscriptionCanceledEmail(data: {
  name: string | null; planKey: string; accessUntil: string | null; renewUrl: string;
}): Promise<Built> {
  const plan = planLabel(data.planKey);
  const until = fmtDate(data.accessUntil);
  const html = await subLayout(`
    ${h1('Your subscription is canceled')}
    ${p(greeting(data.name))}
    ${p(`We have canceled your <strong>${plan}</strong> subscription. You will not be charged again.`)}
    ${until
      ? p(`You keep full access until <strong>${until}</strong>. After that your account moves to read-only for a short grace period, and you can renew any time to restore full access.`)
      : p('You keep access until the end of your current billing period. After that your account moves to read-only for a short grace period, and you can renew any time to restore full access.')}
    <div style="text-align:center;">${button('Renew my plan', data.renewUrl)}</div>
    ${divider()}
    ${p('Changed your mind before the period ends? You can resubscribe from the billing area at any time.', 'font-size:13px;color:#6b7280;')}
  `);
  return { subject: 'Your subscription is canceled', html };
}

// ── 4. Trial started ────────────────────────────────────────────────────────

export async function trialStartedEmail(data: {
  name: string | null; trialEndsAt: string | null; dashboardUrl: string; pricingUrl: string;
}): Promise<Built> {
  const ends = fmtDate(data.trialEndsAt);
  const html = await subLayout(`
    ${h1('Your free trial has started')}
    ${p(greeting(data.name))}
    ${p('Your free trial is now active. You have full access to the platform so you can build and explore your models.')}
    ${ends ? p(`Your trial runs until <strong>${ends}</strong>. Choose a plan before then to keep your access without interruption.`) : ''}
    <div style="text-align:center;">${button('Start modeling', data.dashboardUrl)}</div>
    ${divider()}
    ${p(`Ready to continue after the trial? <a href="${data.pricingUrl}" style="color:#2E75B6;">See the plans</a>.`, 'font-size:13px;color:#6b7280;')}
  `);
  return { subject: 'Your free trial has started', html };
}

// ── 5. Trial ending soon (7d / 1d) ──────────────────────────────────────────

export async function trialEndingEmail(data: {
  name: string | null; trialEndsAt: string | null; daysLeft: number; pricingUrl: string;
}): Promise<Built> {
  const ends = fmtDate(data.trialEndsAt);
  const when = data.daysLeft <= 1 ? 'tomorrow' : `in ${data.daysLeft} days`;
  const html = await subLayout(`
    ${h1(`Your trial ends ${when}`)}
    ${p(greeting(data.name))}
    ${p(`Your free trial ends ${ends ? `on <strong>${ends}</strong> (${when})` : when}. To keep full access to your projects and continue working without interruption, choose a plan before it ends.`)}
    <div style="text-align:center;">${button('Choose a plan', data.pricingUrl)}</div>
    ${divider()}
    ${p('If you do nothing, your account moves to read-only when the trial ends. Your data is never deleted, and you can subscribe any time to restore full access.', 'font-size:13px;color:#6b7280;')}
  `);
  return { subject: `Your free trial ends ${when}`, html };
}

// ── 6. Auto-renewal reminder (Paddle auto-renewing) ─────────────────────────

export async function renewalReminderEmail(data: {
  name: string | null; planKey: string; renewsOn: string | null; amount: string; daysLeft: number; manageUrl: string;
}): Promise<Built> {
  const plan = planLabel(data.planKey);
  const when = data.daysLeft <= 1 ? 'tomorrow' : `in ${data.daysLeft} days`;
  const amountPhrase = data.amount ? `<strong>${data.amount}</strong>` : 'your plan amount';
  const html = await subLayout(`
    ${h1(`Your ${plan} plan renews ${when}`)}
    ${p(greeting(data.name))}
    ${p(`This is a reminder that your <strong>${plan}</strong> subscription renews ${data.renewsOn ? `on <strong>${fmtDate(data.renewsOn)}</strong> (${when})` : when}, and you will be charged ${amountPhrase} to the payment method on file.`)}
    ${p('No action is needed if you want to continue. If you would prefer not to renew, you can cancel before the renewal date and you will not be charged.')}
    <div style="text-align:center;">${button('Manage or cancel', data.manageUrl)}</div>
    ${divider()}
    ${p('You can view invoices and update your payment method from the same billing area.', 'font-size:13px;color:#6b7280;')}
  `);
  return { subject: `Your ${plan} plan renews ${when}: you will be charged ${data.amount || 'your plan amount'}`, html };
}

// ── 7. Ending-plan expiry reminder (manual / canceled Paddle) ───────────────

export async function expiryReminderEmail(data: {
  name: string | null; planKey: string; endsOn: string | null; daysLeft: number; renewUrl: string;
}): Promise<Built> {
  const plan = planLabel(data.planKey);
  const when = data.daysLeft <= 1 ? 'tomorrow' : `in ${data.daysLeft} days`;
  const html = await subLayout(`
    ${h1(`Your access ends ${when}`)}
    ${p(greeting(data.name))}
    ${p(`Your <strong>${plan}</strong> access ends ${data.endsOn ? `on <strong>${fmtDate(data.endsOn)}</strong> (${when})` : when}. Renew to keep full access to your projects without interruption.`)}
    <div style="text-align:center;">${button('Renew my plan', data.renewUrl)}</div>
    ${divider()}
    ${p('When access ends your account moves to read-only for a short grace period. Your data is never deleted, and you can renew any time to restore full access.', 'font-size:13px;color:#6b7280;')}
  `);
  return { subject: `Your access ends ${when}: renew to keep it`, html };
}

// ── 8. Grace started (plan expired, read-only) ──────────────────────────────

export async function graceStartedEmail(data: {
  name: string | null; graceEndsAt: string | null; renewUrl: string;
}): Promise<Built> {
  const until = fmtDate(data.graceEndsAt);
  const html = await subLayout(`
    ${h1('Your plan has expired: read-only access')}
    ${p(greeting(data.name))}
    ${p(`Your plan has expired, so your account is now <strong>read-only</strong>. You can still log in and view your projects, but editing, exporting, and creating are paused.`)}
    ${until ? p(`You have read-only access until <strong>${until}</strong>. Renew before then to restore full access.`) : p('Renew to restore full access.')}
    <div style="text-align:center;">${button('Renew to restore access', data.renewUrl)}</div>
    ${divider()}
    ${p('Your data is never deleted. If you renew, everything picks up exactly where you left off.', 'font-size:13px;color:#6b7280;')}
  `);
  return { subject: 'Your plan has expired: renew to restore access', html };
}

// ── 9. Grace ending / access ending (7d / 1d before grace end) ──────────────

export async function graceEndingEmail(data: {
  name: string | null; graceEndsAt: string | null; daysLeft: number; renewUrl: string;
}): Promise<Built> {
  const ends = fmtDate(data.graceEndsAt);
  const when = data.daysLeft <= 1 ? 'tomorrow' : `in ${data.daysLeft} days`;
  const html = await subLayout(`
    ${h1(`Access to your account ends ${when}`)}
    ${p(greeting(data.name))}
    ${p(`Your read-only grace period ends ${ends ? `on <strong>${ends}</strong> (${when})` : when}. After that you will no longer be able to access the platform until you renew.`)}
    ${p('This is your last reminder before access ends. Renew now to keep everything and restore full access immediately.')}
    <div style="text-align:center;">${button('Renew now', data.renewUrl)}</div>
    ${divider()}
    ${p('Even after access ends, your data is never deleted. You can renew at any time to get everything back.', 'font-size:13px;color:#6b7280;')}
  `);
  return { subject: `Access to your account ends ${when}: renew now`, html };
}

// ── 10. Manual invoice / receipt (offline payment) ──────────────────────────

export async function manualInvoiceEmail(data: {
  name: string | null; planKey: string; amount: string; receiptNumber: string; issuedAt: string | null; billingUrl: string;
}): Promise<Built> {
  const plan = planLabel(data.planKey);
  const date = fmtDate(data.issuedAt);
  const html = await subLayout(`
    ${h1('Your receipt')}
    ${p(greeting(data.name))}
    ${p(`Thank you for your payment. Your receipt for the <strong>${plan}</strong> plan is attached to this email as a PDF.`)}
    ${p(`<strong>Receipt no.:</strong> ${data.receiptNumber}`)}
    ${date ? p(`<strong>Date:</strong> ${date}`) : ''}
    ${data.amount ? p(`<strong>Amount:</strong> ${data.amount}`) : ''}
    <div style="text-align:center;">${button('View in billing', data.billingUrl)}</div>
    ${divider()}
    ${p('You can view or download this receipt any time from the billing area of your dashboard.', 'font-size:13px;color:#6b7280;')}
  `);
  return { subject: `Receipt ${data.receiptNumber} for your ${plan} plan`, html };
}

// ── 11. Plan changed (upgrade / downgrade / interval switch) ────────────────

export async function planChangedEmail(data: {
  name: string | null; planKey: string; interval: 'monthly' | 'annual';
  timing: 'immediate' | 'scheduled'; effectiveAt: string | null; manageUrl: string; pricingUrl: string;
  invoiceAttached?: boolean;
}): Promise<Built> {
  const plan = planLabel(data.planKey);
  const billed = data.interval === 'annual' ? 'billed annually' : 'billed monthly';
  const when = fmtDate(data.effectiveAt);
  const scheduled = data.timing === 'scheduled';
  const heading = scheduled ? 'Your plan change is scheduled' : `You're now on the ${plan} plan`;
  const html = await subLayout(`
    ${h1(heading)}
    ${p(greeting(data.name))}
    ${scheduled
      ? p(`Your subscription will change to the <strong>${plan}</strong> plan (${billed})${when ? ` on <strong>${when}</strong>` : ' at the start of your next billing cycle'}. You keep your current plan until then, and there is no charge today.`)
      : p(`Your subscription is now on the <strong>${plan}</strong> plan (${billed}), effective immediately. Any prorated difference for the change was applied to your payment method today.${data.invoiceAttached ? ' Your invoice for that charge is attached.' : ''}`)}
    <div style="text-align:center;">${button('Manage your subscription', data.manageUrl)}</div>
    ${divider()}
    ${p(`You can review or change your plan any time from the billing area, or <a href="${data.pricingUrl}" style="color:#2E75B6;">see all plans</a>.`, 'font-size:13px;color:#6b7280;')}
  `);
  const subject = scheduled
    ? `Your plan change to ${plan} is scheduled${when ? ` for ${when}` : ''}`
    : `Your plan is now ${plan} (${data.interval})`;
  return { subject, html };
}

// ── 13. Renewal receipt (Paddle recurring charge succeeded) ─────────────────

export async function renewalReceiptEmail(data: {
  name: string | null; planKey: string; amount: string; renewedOn: string | null;
  nextRenewalOn: string | null; invoiceAttached: boolean; billingUrl: string;
}): Promise<Built> {
  const plan = planLabel(data.planKey);
  const on = fmtDate(data.renewedOn);
  const next = fmtDate(data.nextRenewalOn);
  const html = await subLayout(`
    ${h1(`Your ${plan} plan has renewed`)}
    ${p(greeting(data.name))}
    ${p(`Thank you. Your <strong>${plan}</strong> subscription has renewed${on ? ` on <strong>${on}</strong>` : ''} and your access continues without interruption.`)}
    ${data.amount ? p(`<strong>Amount charged:</strong> ${data.amount}`) : ''}
    ${next ? p(`<strong>Next renewal:</strong> ${next}`) : ''}
    ${p(data.invoiceAttached
      ? 'Your invoice for this renewal is attached to this email for your records.'
      : 'You can download your invoice any time from the billing area of your dashboard.')}
    <div style="text-align:center;">${button('View in billing', data.billingUrl)}</div>
    ${divider()}
    ${p('You can view invoices, update your payment method, or cancel any time from the billing area.', 'font-size:13px;color:#6b7280;')}
  `);
  return { subject: `Your ${plan} plan has renewed${data.amount ? `: ${data.amount}` : ''}`, html };
}

// ── 14. Payment failed / dunning (Paddle past_due) ──────────────────────────

export async function paymentFailedEmail(data: {
  name: string | null; planKey: string; amount: string; manageUrl: string;
}): Promise<Built> {
  const plan = planLabel(data.planKey);
  const amountPhrase = data.amount ? `of <strong>${data.amount}</strong> ` : '';
  const html = await subLayout(`
    ${h1('We could not process your payment')}
    ${p(greeting(data.name))}
    ${p(`We tried to charge the payment method on file for your <strong>${plan}</strong> subscription ${amountPhrase}but the payment did not go through.`)}
    ${p('Your access continues for now while we retry the charge automatically. To avoid any interruption, please update your payment method so the next attempt succeeds.')}
    <div style="text-align:center;">${button('Update payment method', data.manageUrl)}</div>
    ${divider()}
    ${p('If you have already updated your card or believe this is a mistake, you can ignore this email: the next automatic retry will settle it.', 'font-size:13px;color:#6b7280;')}
  `);
  return { subject: `Action needed: your ${plan} payment did not go through`, html };
}

// ── 12. Plan ended (manual plan removed by the team) ────────────────────────

export async function planEndedEmail(data: {
  name: string | null; planKey: string; pricingUrl: string;
}): Promise<Built> {
  const plan = planLabel(data.planKey);
  const html = await subLayout(`
    ${h1('Your plan has ended')}
    ${p(greeting(data.name))}
    ${p(`Your <strong>${plan}</strong> plan has been ended and your access has been closed. You will not be billed for it again.`)}
    ${p('If this is unexpected, or you would like to continue, you can choose a plan any time.')}
    <div style="text-align:center;">${button('Choose a plan', data.pricingUrl)}</div>
    ${divider()}
    ${p('Your data is never deleted. If you start a new plan, everything picks up where you left off.', 'font-size:13px;color:#6b7280;')}
  `);
  return { subject: `Your ${plan} plan has ended`, html };
}

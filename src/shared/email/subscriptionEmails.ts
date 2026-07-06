/**
 * subscriptionEmails.ts (SERVER ONLY)
 *
 * The high-level senders for the subscription-lifecycle emails. Transactional
 * dispatchers are called from the webhook + the plan/cancel/trial routes;
 * runSubscriptionReminderScan is called from the daily cron. Every function here
 * is SELF-CONTAINED and NEVER throws to its caller: an email failure must never
 * break a webhook, a plan write, or the cron. Dedupe + idempotency come from the
 * subscription_email_log table (mig 181): we CLAIM a marker before sending and
 * only send when the claim wins.
 *
 * This module makes NO entitlement decisions and never writes plan/gate state.
 * It reuses the SAME pure date helpers the gate uses (resolveLapseAnchorMs /
 * computeLapseState / addCalendarMonths) so the "when does access lapse" logic is
 * identical to enforcement, without touching enforcement.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, FROM, type EmailAttachment } from './sendEmail';
import {
  subscriptionActivePaddleEmail, planActiveManualEmail, subscriptionCanceledEmail,
  trialStartedEmail, trialEndingEmail, renewalReminderEmail, expiryReminderEmail,
  graceStartedEmail, graceEndingEmail, manualInvoiceEmail, planChangedEmail, planEndedEmail,
  renewalReceiptEmail, paymentFailedEmail, fmtAmount,
} from './templates/subscription';
import { createAndStoreManualInvoice } from '@/src/shared/payments/manualInvoice';
import {
  loadPaymentSettings, providerConfigFrom,
} from '@/src/shared/payments/config';
import { getSubscription, listSubscriptionInvoices, getInvoicePdfUrl } from '@/src/shared/payments/paddleApi';
import { computeLapseState } from '@/src/shared/entitlements/gate';
// Pure presentation config (platform -> pricing URL segment) read to build the
// per-platform /pricing links in emails; a read-only import of static config, no
// runtime coupling to the modeling hub.
// eslint-disable-next-line boundaries/dependencies
import { getPlatform, platformPricingSegment } from '@/src/hubs/modeling/config/platforms';

const PLATFORM_DEFAULT = 'real-estate';
const NON_RENEWING = ['canceled', 'cancelled', 'expired', 'paused', 'past_due'];

// ── URLs (absolute, for links in emails) ────────────────────────────────────
function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';
}
const billingUrl = () => `${appUrl()}/dashboard#billing`;
const dashboardUrl = () => `${appUrl()}/dashboard`;
/** The PER-PLATFORM pricing page (source-driven segment, e.g. real-estate -> refm),
 *  falling back to the raw slug when the platform is not in the config. Renew /
 *  choose-plan links in emails point here, not the bare picker. */
function pricingUrl(platform: string): string {
  const p = getPlatform(platform);
  const segment = p ? platformPricingSegment(p) : platform.toLowerCase();
  return `${appUrl()}/pricing/${segment}`;
}

// ── Date helpers (UTC date-only, locale-stable) ─────────────────────────────
function utcDayMs(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
/** Whole days from today's UTC date to the target's UTC date (target - today). */
function daysUntil(targetMs: number, nowMs: number): number {
  return Math.round((utcDayMs(targetMs) - utcDayMs(nowMs)) / 86_400_000);
}
/** 'YYYY-MM-DD' of a ms timestamp in UTC (the anchor_day dedupe key). */
function dayStr(ms: number): string {
  return new Date(utcDayMs(ms)).toISOString().slice(0, 10);
}
function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

// ── Dedupe: claim a marker, release it if the send fails ────────────────────
interface MarkerKey {
  user_id: string; platform_slug: string; email_type: string; threshold: string; anchor_day: string;
}
/** Claim a send. Returns true when THIS caller should send (marker newly written,
 *  or the log table is unavailable so we fail OPEN rather than silently drop a
 *  transactional email). Returns false only when a matching marker already exists
 *  (a genuine duplicate). */
async function claim(sb: SupabaseClient, key: MarkerKey): Promise<boolean> {
  const { error } = await sb.from('subscription_email_log').insert(key);
  if (!error) return true;
  if (error.code === '23505') return false; // already sent for this key
  console.warn('[sub-email] claim non-unique error, proceeding without dedupe:', error.message);
  return true;
}
async function release(sb: SupabaseClient, key: MarkerKey): Promise<void> {
  try { await sb.from('subscription_email_log').delete().match(key); } catch { /* best effort */ }
}

/** Run a claim -> send -> (release on throw) cycle. Never throws. The send callback
 *  returns the Brevo message id (or void); dispatch logs the OUTCOME of every send
 *  (sent + id, skipped-duplicate, or FAILED + reason) so a real Brevo/contact
 *  failure is visible in the logs (greppable prefix "[sub-email]") and never a
 *  silent no-op. Returns true only when an email was actually sent. */
async function dispatch(
  sb: SupabaseClient, key: MarkerKey, send: () => Promise<string | void>,
): Promise<boolean> {
  try {
    const go = await claim(sb, key);
    if (!go) {
      console.log(`[sub-email] skipped duplicate ${key.email_type} (${key.threshold})`);
      return false;
    }
    try {
      const id = await send();
      console.log(`[sub-email] sent ${key.email_type} (${key.threshold})${id ? ` id=${id}` : ''}`);
      return true;
    } catch (e) {
      await release(sb, key);
      console.error(`[sub-email] FAILED ${key.email_type} (${key.threshold}):`, e instanceof Error ? e.message : String(e));
      return false;
    }
  } catch (e) {
    console.warn('[sub-email] dispatch error:', e instanceof Error ? e.message : String(e));
    return false;
  }
}

// ── User lookup ─────────────────────────────────────────────────────────────
interface Contact { email: string; name: string | null; role: string | null; }
async function getContact(sb: SupabaseClient, userId: string): Promise<Contact | null> {
  try {
    const { data } = await sb.from('users').select('email, name, role').eq('id', userId).maybeSingle();
    const r = data as { email?: string; name?: string | null; role?: string | null } | null;
    if (!r?.email) return null;
    return { email: r.email, name: r.name ?? null, role: r.role ?? null };
  } catch {
    return null;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a Paddle invoice PDF as an email attachment (base64), SERVER-SIDE (the
 * key never leaves the server). Given a transaction id (preferred: the exact
 * proration transaction), or a subscription id whose newest transaction is used
 * (e.g. the immediate proration charge from a plan change).
 *
 * A just-created transaction's invoice PDF is generated ASYNCHRONOUSLY by Paddle,
 * so right after a plan change getInvoicePdfUrl returns 'invoice_not_available'
 * for a few seconds. We therefore RETRY the PDF resolution with a short backoff
 * (opts.attempts), and, when no explicit txn id was given, re-list the
 * subscription's transactions on each attempt so a proration txn that had not yet
 * appeared is picked up.
 *
 * Still best effort (returns undefined so the email always sends), but NO LONGER
 * SILENT: every reason it could not attach is logged with the greppable
 * "[sub-email] invoice-attach" prefix, so a genuine failure is visible instead of
 * a mystery empty email. Shared by the welcome + plan-change emails.
 */
async function fetchPaddleInvoiceAttachment(
  sb: SupabaseClient, platform: string,
  ref: { transactionId?: string | null; subscriptionId?: string | null },
  opts?: { attempts?: number; delayMs?: number; label?: string },
): Promise<EmailAttachment[] | undefined> {
  const attempts = Math.max(1, opts?.attempts ?? 1);
  const delayMs = opts?.delayMs ?? 1500;
  const label = opts?.label ?? 'invoice';
  try {
    const settings = await loadPaymentSettings(sb, platform);
    const cfg = providerConfigFrom(settings, 'paddle');
    if (!cfg.apiKey) return undefined; // Paddle not configured: nothing to attach.
    let lastReason = 'no_transaction';
    for (let attempt = 1; attempt <= attempts; attempt++) {
      // Resolve the transaction id: explicit id first, else the newest transaction
      // on the subscription (re-listed each attempt so a late-appearing proration
      // txn is caught).
      let txId = ref.transactionId ?? null;
      if (!txId && ref.subscriptionId) {
        const inv = await listSubscriptionInvoices(cfg, ref.subscriptionId);
        if (inv.ok && inv.data.length > 0) txId = inv.data[0].transactionId; // newest (billed_at DESC)
      }
      if (txId) {
        const urlRes = await getInvoicePdfUrl(cfg, txId);
        if (urlRes.ok) {
          const pdf = await fetch(urlRes.data, { cache: 'no-store' });
          if (pdf.ok) {
            const buf = Buffer.from(await pdf.arrayBuffer());
            return [{ name: 'invoice.pdf', content: buf.toString('base64') }];
          }
          lastReason = `pdf_http_${pdf.status}`;
        } else {
          lastReason = urlRes.error; // e.g. 'invoice_not_available' while Paddle generates it
        }
      }
      // Not ready yet: wait and retry (unless this was the last attempt).
      if (attempt < attempts) await sleep(delayMs);
      else console.warn(`[sub-email] invoice-attach ${label} unavailable after ${attempts} attempt(s): ${lastReason}`);
    }
    return undefined;
  } catch (e) {
    console.warn(`[sub-email] invoice-attach ${label} error:`, e instanceof Error ? e.message : String(e));
    return undefined;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TRANSACTIONAL DISPATCHERS
// ────────────────────────────────────────────────────────────────────────────

/** Welcome / subscription active (Paddle). Attaches the invoice PDF fetched
 *  server-side (falls back to a billing link if the invoice is not available). */
export async function sendSubscriptionActivePaddleEmail(
  sb: SupabaseClient,
  args: { userId: string; platform?: string; planKey: string; transactionId?: string | null; subscriptionId?: string | null },
): Promise<void> {
  const platform = args.platform ?? PLATFORM_DEFAULT;
  const nowMs = Date.now();
  // Per-EVENT dedupe (matches welcome_manual/canceled): key on the Paddle
  // subscription (or transaction) id, NOT the calendar day, so a genuine NEW
  // purchase always sends while a webhook redelivery for the SAME activation does
  // not. The old 'once'/day key swallowed a second same-day purchase (the "was
  // receiving, now not" report on repeated testing).
  const evtToken = args.subscriptionId ?? args.transactionId ?? dayStr(nowMs);
  const key: MarkerKey = { user_id: args.userId, platform_slug: platform, email_type: 'welcome_paddle', threshold: `evt:${evtToken}`, anchor_day: dayStr(nowMs) };
  await dispatch(sb, key, async () => {
    const c = await getContact(sb, args.userId);
    if (!c) throw new Error('no contact');

    // Fetch the invoice PDF server-side (key stays server-side) via the shared
    // helper. ONE fast attempt (no sleeps) so the webhook responds quickly and is
    // never timed out by Paddle mid-send (a stalled send would leave the dedupe
    // marker claimed and drop the email). On activation the invoice is normally
    // ready; if not, the email still sends with the billing link (best effort).
    const attachments = await fetchPaddleInvoiceAttachment(
      sb, platform,
      { transactionId: args.transactionId, subscriptionId: args.subscriptionId },
      { attempts: 1, label: 'welcome_paddle' },
    );

    const { subject, html } = await subscriptionActivePaddleEmail({
      name: c.name, planKey: args.planKey, billingUrl: billingUrl(), invoiceAttached: !!attachments,
    });
    return (await sendEmail({ to: c.email, subject, html, from: FROM.noreply, attachments })).id;
  });
}

/**
 * Self-heal the welcome/subscription-active email for a paying Paddle sub whose
 * `activated` webhook was never delivered (sandbox delivery is unreliable), so a
 * paying customer is never left without a welcome + invoice. Mirrors the
 * billing-history self-heal: called on the next LIVE read of an active paid
 * subscription (billing panel) and by the daily reminder cron.
 *
 * IDEMPOTENT + safe for existing subscribers: it first checks whether ANY
 * welcome_paddle marker already exists for this subscription (keyed on the stable
 * `evt:{subId}` threshold, IGNORING anchor_day), so a customer already welcomed by
 * the webhook (or a prior self-heal) is detected and skipped. Only a genuinely
 * un-welcomed sub sends, exactly once. Never throws.
 */
export async function selfHealWelcomePaddleEmail(
  sb: SupabaseClient,
  args: { userId: string; platform?: string; planKey: string; subscriptionId: string | null; transactionId?: string | null },
): Promise<void> {
  if (!args.subscriptionId) return;
  const platform = args.platform ?? PLATFORM_DEFAULT;
  const planKey = (args.planKey || '').toLowerCase();
  if (!planKey || planKey === 'none' || planKey === 'trial') return;
  try {
    // Existence check on the STABLE identity (email_type + threshold), not the
    // dated anchor: an already-welcomed sub (webhook or prior heal) has this row.
    const { data } = await sb
      .from('subscription_email_log')
      .select('id')
      .eq('user_id', args.userId).eq('platform_slug', platform)
      .eq('email_type', 'welcome_paddle').eq('threshold', `evt:${args.subscriptionId}`)
      .limit(1).maybeSingle();
    if (data) return; // already welcomed: nothing to heal
  } catch {
    // Log table unreachable: fall through so the dispatch claim fails OPEN rather
    // than silently dropping a transactional email (claim() handles the dedupe).
  }
  console.log(`[sub-email] self-heal welcome_paddle (user=${args.userId} sub=${args.subscriptionId})`);
  await sendSubscriptionActivePaddleEmail(sb, {
    userId: args.userId, platform, planKey: args.planKey,
    subscriptionId: args.subscriptionId, transactionId: args.transactionId ?? null,
  });
}

/** Welcome / plan active (manual). Skips 'none' and 'trial' (trial has its own). */
export async function sendManualPlanWelcomeEmail(
  sb: SupabaseClient,
  args: { userId: string; platform?: string; planKey: string; startedAt?: string | null; expiresAt?: string | null },
): Promise<void> {
  const planKey = (args.planKey || '').toLowerCase();
  if (planKey === 'none' || planKey === 'trial' || !planKey) return;
  const platform = args.platform ?? PLATFORM_DEFAULT;
  // Per-EVENT dedupe: key on the started_at of THIS assignment (mirrors how
  // plan_changed varies its key). A genuine second manual assignment (a new
  // started_at) sends; a true duplicate (same started_at, e.g. a double-click)
  // is skipped. The route passes a concrete started_at so the token is stable.
  const anchorMs = parseMs(args.startedAt ?? null) ?? Date.now();
  const key: MarkerKey = { user_id: args.userId, platform_slug: platform, email_type: 'welcome_manual', threshold: `evt:${args.startedAt ?? dayStr(anchorMs)}`, anchor_day: dayStr(anchorMs) };
  await dispatch(sb, key, async () => {
    const c = await getContact(sb, args.userId);
    if (!c) throw new Error('no contact');
    const { subject, html } = await planActiveManualEmail({
      name: c.name, planKey, startedAt: args.startedAt ?? null, expiresAt: args.expiresAt ?? null, billingUrl: dashboardUrl(),
    });
    return (await sendEmail({ to: c.email, subject, html, from: FROM.noreply })).id;
  });
}

/** Plan ended confirmation: a manual (offline) plan was removed by the team (set to
 *  'none'). The Paddle-only cancel route never fires for a manual user, so this is
 *  their cancellation confirmation. Skips none/trial as the ENDED plan. */
export async function sendPlanEndedEmail(
  sb: SupabaseClient,
  args: { userId: string; platform?: string; planKey: string },
): Promise<void> {
  const planKey = (args.planKey || '').toLowerCase();
  if (!planKey || planKey === 'none' || planKey === 'trial') return;
  const platform = args.platform ?? PLATFORM_DEFAULT;
  const nowMs = Date.now();
  const key: MarkerKey = { user_id: args.userId, platform_slug: platform, email_type: 'plan_ended', threshold: `evt:${planKey}`, anchor_day: dayStr(nowMs) };
  await dispatch(sb, key, async () => {
    const c = await getContact(sb, args.userId);
    if (!c) throw new Error('no contact');
    const { subject, html } = await planEndedEmail({ name: c.name, planKey, pricingUrl: pricingUrl(platform) });
    return (await sendEmail({ to: c.email, subject, html, from: FROM.noreply })).id;
  });
}

/** Subscription canceled confirmation. */
export async function sendSubscriptionCanceledEmail(
  sb: SupabaseClient,
  args: { userId: string; platform?: string; planKey: string; accessUntil?: string | null },
): Promise<void> {
  const platform = args.platform ?? PLATFORM_DEFAULT;
  // Per-EVENT dedupe: key on the access-until date (the specific cancellation of
  // THIS subscription/period). Canceling a new subscription later (a new period
  // end) sends; a duplicate cancel of the same period is skipped.
  const anchorMs = parseMs(args.accessUntil ?? null) ?? Date.now();
  const key: MarkerKey = { user_id: args.userId, platform_slug: platform, email_type: 'canceled', threshold: `evt:${args.accessUntil ?? dayStr(anchorMs)}`, anchor_day: dayStr(anchorMs) };
  await dispatch(sb, key, async () => {
    const c = await getContact(sb, args.userId);
    if (!c) throw new Error('no contact');
    const { subject, html } = await subscriptionCanceledEmail({
      name: c.name, planKey: args.planKey, accessUntil: args.accessUntil ?? null, renewUrl: pricingUrl(platform),
    });
    return (await sendEmail({ to: c.email, subject, html, from: FROM.noreply })).id;
  });
}

/** Trial started. */
export async function sendTrialStartedEmail(
  sb: SupabaseClient,
  args: { userId: string; platform?: string; trialEndsAt?: string | null },
): Promise<void> {
  const platform = args.platform ?? PLATFORM_DEFAULT;
  // Per-EVENT dedupe: key on the trial end date, so each genuine trial GRANT (a
  // fresh trial_ends_at) sends while a re-approval of the same trial does not.
  // The old 'once'/day key swallowed a second trial grant on the same day.
  const token = args.trialEndsAt ?? dayStr(Date.now());
  const key: MarkerKey = { user_id: args.userId, platform_slug: platform, email_type: 'trial_started', threshold: `evt:${token}`, anchor_day: dayStr(Date.now()) };
  await dispatch(sb, key, async () => {
    const c = await getContact(sb, args.userId);
    if (!c) throw new Error('no contact');
    const { subject, html } = await trialStartedEmail({
      name: c.name, trialEndsAt: args.trialEndsAt ?? null, dashboardUrl: dashboardUrl(), pricingUrl: pricingUrl(platform),
    });
    return (await sendEmail({ to: c.email, subject, html, from: FROM.noreply })).id;
  });
}

/**
 * Plan-change confirmation (upgrade / downgrade / interval switch). Self-contained
 * + never throws. Deduped so one change sends one email: the marker encodes the
 * target plan + interval (so a different later change still sends), keyed on the
 * effective day. `timing` is 'immediate' (upgrade / interval, effective now) or
 * 'scheduled' (downgrade, effective next cycle). Renew/plans link is per-platform.
 */
export async function sendPlanChangedEmail(
  sb: SupabaseClient,
  args: { userId: string; platform?: string; planKey: string; interval: 'monthly' | 'annual'; timing: 'immediate' | 'scheduled'; effectiveAt?: string | null; subscriptionId?: string | null; transactionId?: string | null },
): Promise<void> {
  const platform = args.platform ?? PLATFORM_DEFAULT;
  const planKey = (args.planKey ?? '').toLowerCase();
  if (!planKey || planKey === 'none') return;
  const anchorMs = parseMs(args.effectiveAt ?? null) ?? Date.now();
  const key: MarkerKey = {
    user_id: args.userId, platform_slug: platform,
    email_type: `plan_changed:${planKey}:${args.interval}`, threshold: args.timing, anchor_day: dayStr(anchorMs),
  };
  await dispatch(sb, key, async () => {
    const c = await getContact(sb, args.userId);
    if (!c) throw new Error('no contact');
    // An IMMEDIATE change (upgrade / interval) creates a Paddle proration charge:
    // attach that invoice. Prefer the exact proration transaction id (from the
    // change response) and fall back to the subscription's newest transaction.
    // Paddle generates the invoice PDF asynchronously, so retry a few times; if it
    // still is not ready the email sends without it AND logs why (visible, not a
    // silent drop). A scheduled downgrade has no charge today, so no invoice.
    const attachments = args.timing === 'immediate' && args.subscriptionId
      ? await fetchPaddleInvoiceAttachment(sb, platform, { transactionId: args.transactionId, subscriptionId: args.subscriptionId }, { attempts: 2, delayMs: 800, label: 'plan_changed' })
      : undefined;
    if (args.timing === 'immediate' && args.subscriptionId && !attachments) {
      console.warn(`[sub-email] plan_changed invoice NOT attached (user=${args.userId} plan=${planKey}); sent without it`);
    }
    const { subject, html } = await planChangedEmail({
      name: c.name, planKey: args.planKey, interval: args.interval, timing: args.timing,
      effectiveAt: args.effectiveAt ?? null, manageUrl: billingUrl(), pricingUrl: pricingUrl(platform),
      invoiceAttached: !!attachments,
    });
    return (await sendEmail({ to: c.email, subject, html, from: FROM.noreply, attachments })).id;
  });
}

/**
 * Renewal receipt: a Paddle recurring charge succeeded (a `renewed` event, i.e. a
 * `transaction.completed` with origin subscription_recurring, NOT the first
 * activation). Distinct from the welcome copy so a renewal reads as a receipt.
 * Deduped per renewal on the transaction id (a genuine new renewal has a new txn
 * id; a redelivery of the same event is already blocked by the webhook's event-id
 * idempotency upstream). Attaches the renewal invoice PDF (best effort). Never throws.
 */
export async function sendRenewalReceiptEmail(
  sb: SupabaseClient,
  args: { userId: string; platform?: string; planKey: string; amountMinor: number | null; currency: string | null; renewedOn?: string | null; nextRenewalOn?: string | null; transactionId?: string | null; subscriptionId?: string | null },
): Promise<void> {
  const platform = args.platform ?? PLATFORM_DEFAULT;
  const planKey = (args.planKey || '').toLowerCase();
  if (!planKey || planKey === 'none' || planKey === 'trial') return;
  const token = args.transactionId ?? args.subscriptionId ?? dayStr(Date.now());
  const key: MarkerKey = { user_id: args.userId, platform_slug: platform, email_type: 'renewal_receipt', threshold: `evt:${token}`, anchor_day: dayStr(Date.now()) };
  await dispatch(sb, key, async () => {
    const c = await getContact(sb, args.userId);
    if (!c) throw new Error('no contact');
    const attachments = await fetchPaddleInvoiceAttachment(
      sb, platform, { transactionId: args.transactionId, subscriptionId: args.subscriptionId }, { attempts: 2, delayMs: 800, label: 'renewal_receipt' },
    );
    const { subject, html } = await renewalReceiptEmail({
      name: c.name, planKey: args.planKey, amount: fmtAmount(args.amountMinor, args.currency),
      renewedOn: args.renewedOn ?? null, nextRenewalOn: args.nextRenewalOn ?? null,
      invoiceAttached: !!attachments, billingUrl: billingUrl(),
    });
    return (await sendEmail({ to: c.email, subject, html, from: FROM.noreply, attachments })).id;
  });
}

/**
 * Dunning / payment-failed: a Paddle recurring charge failed (past_due). Prompts
 * the customer to update their payment method. Makes NO plan change (Paddle keeps
 * retrying and access continues; enforcement is unchanged). Deduped PER BILLING
 * PERIOD: keyed on the subscription id + the period-end anchor, so the several
 * retry events Paddle fires for the SAME failed period collapse to one email,
 * while a failure in a later period sends again. Never throws.
 *
 * Retain note: if Paddle Retain is enabled at go-live it ALSO sends dunning mail.
 * This send is safe to coexist (both link to the same billing/manage flow); to
 * hand dunning entirely to Retain, remove the sendPaymentFailedEmail call in the
 * webhook (the template + dispatcher can stay unused).
 */
export async function sendPaymentFailedEmail(
  sb: SupabaseClient,
  args: { userId: string; platform?: string; planKey: string; amountMinor: number | null; currency: string | null; subscriptionId: string | null; billingPeriodEnd?: string | null },
): Promise<void> {
  const platform = args.platform ?? PLATFORM_DEFAULT;
  const planKey = (args.planKey || '').toLowerCase();
  if (!planKey || planKey === 'none' || planKey === 'trial') return;
  const periodMs = parseMs(args.billingPeriodEnd ?? null) ?? Date.now();
  const token = args.subscriptionId ?? args.userId;
  const key: MarkerKey = { user_id: args.userId, platform_slug: platform, email_type: 'payment_failed', threshold: `evt:${token}`, anchor_day: dayStr(periodMs) };
  await dispatch(sb, key, async () => {
    const c = await getContact(sb, args.userId);
    if (!c) throw new Error('no contact');
    const { subject, html } = await paymentFailedEmail({
      name: c.name, planKey: args.planKey, amount: fmtAmount(args.amountMinor, args.currency), manageUrl: billingUrl(),
    });
    return (await sendEmail({ to: c.email, subject, html, from: FROM.noreply })).id;
  });
}

/** The outcome of a manual-receipt attempt (visible to the caller, not swallowed). */
export interface IssueManualInvoiceResult {
  ok: boolean;
  skipped?: 'no_amount' | 'plan' | 'no_contact' | 'duplicate';
  receiptNumber?: string;
  error?: string;
}

/**
 * Issue a manual (offline/bank) receipt: generate + store the branded PDF, record
 * the manual_invoices row, and email the receipt with the PDF attached. Called by
 * the admin manual-assign + convert-to-manual-immediate routes when an amount is
 * present. Self-contained + never throws (a receipt failure must not break the
 * plan assignment), but RETURNS a result and LOGS the outcome so a failure is
 * visible, not a silent no-op.
 *
 * Deduped PER-EVENT: the marker is claimed BEFORE the receipt is created, keyed on
 * (started_at + amount), so a true duplicate (a double-click on the same
 * assignment) creates no second receipt and sends no second email, while a genuine
 * later assignment (a new started_at) issues a fresh receipt + email. Skips
 * none/trial and zero/absent amounts (the "no amount -> no receipt" rule).
 */
export async function issueManualInvoice(
  sb: SupabaseClient,
  args: { userId: string; platform?: string; planKey: string | null; amountMinor: number | null; currency: string | null; issuedAt: string; periodEnd?: string | null },
): Promise<IssueManualInvoiceResult> {
  const platform = args.platform ?? PLATFORM_DEFAULT;
  if (!args.amountMinor || args.amountMinor <= 0) return { ok: false, skipped: 'no_amount' };
  const planKey = (args.planKey ?? '').toLowerCase();
  if (planKey === 'none' || planKey === 'trial') return { ok: false, skipped: 'plan' };

  const anchorMs = parseMs(args.issuedAt) ?? Date.now();
  const key: MarkerKey = {
    user_id: args.userId, platform_slug: platform, email_type: 'manual_invoice',
    threshold: `evt:${args.issuedAt}:${args.amountMinor}`, anchor_day: dayStr(anchorMs),
  };

  let receiptNumber: string | undefined;
  let sendError: string | undefined;
  const sent = await dispatch(sb, key, async () => {
    const c = await getContact(sb, args.userId);
    if (!c) throw new Error('no contact');

    // Company for the bill-to block. Fetched separately + schema-tolerant so a
    // pre-mig-172 schema (no company column) never breaks the receipt.
    let company: string | null = null;
    try {
      const { data } = await sb.from('users').select('company').eq('id', args.userId).maybeSingle();
      company = (data as { company?: string | null } | null)?.company ?? null;
    } catch { /* company column absent: omit from the receipt */ }

    const issued = await createAndStoreManualInvoice(sb, {
      userId: args.userId, platform, planKey: args.planKey, amountMinor: args.amountMinor!,
      currency: args.currency ?? null, issuedAt: args.issuedAt, customerName: c.name, customerEmail: c.email,
      customerCompany: company, periodStart: args.issuedAt, periodEnd: args.periodEnd ?? null,
    });
    receiptNumber = issued.receiptNumber;

    const { subject, html } = await manualInvoiceEmail({
      name: c.name, planKey: args.planKey ?? '', amount: fmtAmount(args.amountMinor, args.currency),
      receiptNumber: issued.receiptNumber, issuedAt: args.issuedAt, billingUrl: billingUrl(),
    });
    const res = await sendEmail({
      to: c.email, subject, html, from: FROM.noreply,
      attachments: [{ name: `${issued.receiptNumber}.pdf`, content: Buffer.from(issued.pdfBytes).toString('base64') }],
    });
    try { await sb.from('manual_invoices').update({ email_sent_at: new Date().toISOString() }).eq('id', issued.id); } catch { /* best effort */ }
    return res.id;
  }).catch((e) => { sendError = e instanceof Error ? e.message : String(e); return false; });

  if (sent) return { ok: true, receiptNumber };
  if (receiptNumber) return { ok: false, error: sendError, receiptNumber }; // created but send/log failed
  if (sendError) return { ok: false, error: sendError };
  return { ok: false, skipped: 'duplicate' }; // claim lost (dispatch returned false, no throw)
}

// ────────────────────────────────────────────────────────────────────────────
// TIME-BASED REMINDER SENDERS (used by the cron)
// ────────────────────────────────────────────────────────────────────────────

function thresholdFor(days: number): '7d' | '1d' | null {
  if (days === 7) return '7d';
  if (days === 1) return '1d';
  return null;
}

async function sendTrialEnding(sb: SupabaseClient, platform: string, userId: string, contact: Contact, trialEndsAtIso: string, anchorMs: number, days: number): Promise<boolean> {
  const th = thresholdFor(days);
  if (!th) return false;
  const key: MarkerKey = { user_id: userId, platform_slug: platform, email_type: 'trial_ending', threshold: th, anchor_day: dayStr(anchorMs) };
  return dispatch(sb, key, async () => {
    const { subject, html } = await trialEndingEmail({ name: contact.name, trialEndsAt: trialEndsAtIso, daysLeft: days, pricingUrl: pricingUrl(platform) });
    return (await sendEmail({ to: contact.email, subject, html, from: FROM.noreply })).id;
  });
}

async function sendRenewalReminder(sb: SupabaseClient, platform: string, userId: string, contact: Contact, planKey: string, renewsOnIso: string | null, amount: string, anchorMs: number, days: number): Promise<boolean> {
  const th = thresholdFor(days);
  if (!th) return false;
  const key: MarkerKey = { user_id: userId, platform_slug: platform, email_type: 'renewal_reminder', threshold: th, anchor_day: dayStr(anchorMs) };
  return dispatch(sb, key, async () => {
    const { subject, html } = await renewalReminderEmail({ name: contact.name, planKey, renewsOn: renewsOnIso, amount, daysLeft: days, manageUrl: billingUrl() });
    return (await sendEmail({ to: contact.email, subject, html, from: FROM.noreply })).id;
  });
}

async function sendExpiryReminder(sb: SupabaseClient, platform: string, userId: string, contact: Contact, planKey: string, endsOnIso: string | null, anchorMs: number, days: number): Promise<boolean> {
  const th = thresholdFor(days);
  if (!th) return false;
  const key: MarkerKey = { user_id: userId, platform_slug: platform, email_type: 'expiry_reminder', threshold: th, anchor_day: dayStr(anchorMs) };
  return dispatch(sb, key, async () => {
    const { subject, html } = await expiryReminderEmail({ name: contact.name, planKey, endsOn: endsOnIso, daysLeft: days, renewUrl: pricingUrl(platform) });
    return (await sendEmail({ to: contact.email, subject, html, from: FROM.noreply })).id;
  });
}

async function sendGraceStarted(sb: SupabaseClient, platform: string, userId: string, contact: Contact, graceEndsAtMs: number | null, anchorMs: number): Promise<boolean> {
  // 'once' per anchor: fires on the first cron run after grace begins.
  const key: MarkerKey = { user_id: userId, platform_slug: platform, email_type: 'grace_started', threshold: 'once', anchor_day: dayStr(anchorMs) };
  return dispatch(sb, key, async () => {
    const { subject, html } = await graceStartedEmail({ name: contact.name, graceEndsAt: graceEndsAtMs ? new Date(graceEndsAtMs).toISOString() : null, renewUrl: pricingUrl(platform) });
    return (await sendEmail({ to: contact.email, subject, html, from: FROM.noreply })).id;
  });
}

async function sendGraceEnding(sb: SupabaseClient, platform: string, userId: string, contact: Contact, graceEndsAtMs: number, days: number): Promise<boolean> {
  const th = thresholdFor(days);
  if (!th) return false;
  const key: MarkerKey = { user_id: userId, platform_slug: platform, email_type: 'grace_ending', threshold: th, anchor_day: dayStr(graceEndsAtMs) };
  return dispatch(sb, key, async () => {
    const { subject, html } = await graceEndingEmail({ name: contact.name, graceEndsAt: new Date(graceEndsAtMs).toISOString(), daysLeft: days, renewUrl: pricingUrl(platform) });
    return (await sendEmail({ to: contact.email, subject, html, from: FROM.noreply })).id;
  });
}

// ── Grace helper shared by trial + manual passes ────────────────────────────
async function handleGrace(sb: SupabaseClient, platform: string, userId: string, contact: Contact, anchorMs: number, nowMs: number, counters: Counters): Promise<void> {
  const { state, graceEndsAtMs } = computeLapseState(anchorMs, nowMs);
  if (state !== 'grace') return;
  if (await sendGraceStarted(sb, platform, userId, contact, graceEndsAtMs, anchorMs)) counters.graceStarted++;
  if (graceEndsAtMs != null) {
    const dGrace = daysUntil(graceEndsAtMs, nowMs);
    if (await sendGraceEnding(sb, platform, userId, contact, graceEndsAtMs, dGrace)) counters.graceEnding++;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// THE DAILY SCAN (idempotent)
// ────────────────────────────────────────────────────────────────────────────

interface Counters {
  trialEnding: number; renewal: number; expiry: number; graceStarted: number; graceEnding: number; paddleLookups: number;
}

export interface ReminderScanResult extends Counters { scannedTrials: number; scannedSubs: number; }

export async function runSubscriptionReminderScan(sb: SupabaseClient, platform = PLATFORM_DEFAULT): Promise<ReminderScanResult> {
  const nowMs = Date.now();
  const counters: Counters = { trialEnding: 0, renewal: 0, expiry: 0, graceStarted: 0, graceEnding: 0, paddleLookups: 0 };
  let scannedTrials = 0;
  let scannedSubs = 0;

  // Build the Paddle config once (may be unavailable; classification then falls
  // back to the local status, and the charge notice is suppressed on uncertainty).
  const settings = await loadPaymentSettings(sb, platform).catch(() => null);
  const cfg = settings ? providerConfigFrom(settings, 'paddle') : null;
  const paddleReady = !!cfg?.apiKey && settings?.active_provider === 'paddle';

  // ── Pass A: trials (users.subscription_plan = 'trial') ────────────────────
  try {
    const { data: trialUsers } = await sb
      .from('users')
      .select('id, email, name, role, trial_ends_at')
      .eq('subscription_plan', 'trial')
      .not('trial_ends_at', 'is', null);
    for (const raw of (trialUsers ?? []) as Array<{ id: string; email: string; name: string | null; role: string | null; trial_ends_at: string }>) {
      if (raw.role === 'admin') continue;
      const anchor = parseMs(raw.trial_ends_at);
      if (anchor == null) continue;
      scannedTrials++;
      const contact: Contact = { email: raw.email, name: raw.name, role: raw.role };
      // Trial ending (before expiry)
      const dTrial = daysUntil(anchor, nowMs);
      if (await sendTrialEnding(sb, platform, raw.id, contact, raw.trial_ends_at, anchor, dTrial)) counters.trialEnding++;
      // Grace (after expiry): the trial anchor is the lapse anchor.
      await handleGrace(sb, platform, raw.id, contact, anchor, nowMs, counters);
    }
  } catch (e) {
    console.warn('[sub-email] trial pass error:', e instanceof Error ? e.message : String(e));
  }

  // ── Pass B: subscriptions (manual expiry + Paddle renewal/ending) ─────────
  try {
    const { data: subs } = await sb
      .from('user_platform_subscriptions')
      .select('user_id, platform_slug, source, status, plan_key, expires_at, current_period_end, paddle_subscription_id')
      .eq('platform_slug', platform);
    const rows = (subs ?? []) as Array<{
      user_id: string; platform_slug: string; source: string | null; status: string | null; plan_key: string | null;
      expires_at: string | null; current_period_end: string | null; paddle_subscription_id: string | null;
    }>;

    // Bulk-load contacts for the referenced users.
    const ids = Array.from(new Set(rows.map(r => r.user_id)));
    const contacts = new Map<string, Contact>();
    if (ids.length > 0) {
      const { data: us } = await sb.from('users').select('id, email, name, role').in('id', ids);
      for (const u of (us ?? []) as Array<{ id: string; email: string; name: string | null; role: string | null }>) {
        if (u.email) contacts.set(u.id, { email: u.email, name: u.name, role: u.role });
      }
    }

    for (const row of rows) {
      const contact = contacts.get(row.user_id);
      if (!contact || contact.role === 'admin') continue;
      const planKey = (row.plan_key ?? '').toLowerCase();
      // Trials + none are owned by Pass A / have no billing; skip here.
      if (planKey === 'trial' || planKey === 'none' || !planKey) continue;
      const source = (row.source ?? 'paddle').toLowerCase();

      if (source === 'manual') {
        // Manual plan: expires_at is BOTH the "access ends" date and the lapse anchor.
        const anchor = parseMs(row.expires_at);
        if (anchor == null) continue;
        scannedSubs++;
        const dEnd = daysUntil(anchor, nowMs);
        if (await sendExpiryReminder(sb, platform, row.user_id, contact, planKey, row.expires_at, anchor, dEnd)) counters.expiry++;
        await handleGrace(sb, platform, row.user_id, contact, anchor, nowMs, counters);
        continue;
      }

      // Welcome self-heal (webhook-miss safety net), daily and idempotent: a live
      // paid Paddle sub with no welcome_paddle marker gets its welcome + invoice
      // sent once. Uses the stored row (no extra live call); the existence check
      // inside makes it a no-op for already-welcomed subs. Skip canceled rows.
      if (row.paddle_subscription_id && !NON_RENEWING.includes((row.status ?? '').toLowerCase())) {
        await selfHealWelcomePaddleEmail(sb, {
          userId: row.user_id, platform, planKey, subscriptionId: row.paddle_subscription_id,
        });
      }

      // Paddle sub: only act when the period end is at a reminder threshold.
      const cpe = parseMs(row.current_period_end);
      if (cpe == null) continue;
      const dPeriod = daysUntil(cpe, nowMs);
      if (dPeriod !== 7 && dPeriod !== 1) continue;
      scannedSubs++;

      // Classify auto-renewing vs ending. Prefer the live Paddle state so a
      // cancel-at-period-end (still locally 'active') is treated as ENDING, not
      // charged. On uncertainty, suppress the charge notice.
      let ending = NON_RENEWING.includes((row.status ?? '').toLowerCase());
      let renewsOn: string | null = row.current_period_end;
      let amount = '';
      if (paddleReady && cfg && row.paddle_subscription_id) {
        counters.paddleLookups++;
        const sub = await getSubscription(cfg, row.paddle_subscription_id);
        if (sub.ok) {
          ending = sub.data.canceled || sub.data.scheduledCancelAt != null || NON_RENEWING.includes(sub.data.status.toLowerCase());
          renewsOn = sub.data.nextBilledAt ?? sub.data.currentPeriodEndsAt ?? row.current_period_end;
          amount = fmtAmount(sub.data.amountMinor, sub.data.currency);
        } else {
          // Live state unknown: do not risk a wrong "you'll be charged" notice.
          if (!ending) continue;
        }
      } else if (!ending) {
        // No Paddle API to confirm auto-renew: suppress the charge notice.
        continue;
      }

      if (ending) {
        if (await sendExpiryReminder(sb, platform, row.user_id, contact, planKey, renewsOn, cpe, dPeriod)) counters.expiry++;
      } else {
        if (await sendRenewalReminder(sb, platform, row.user_id, contact, planKey, renewsOn, amount, cpe, dPeriod)) counters.renewal++;
      }
    }
  } catch (e) {
    console.warn('[sub-email] subscription pass error:', e instanceof Error ? e.message : String(e));
  }

  return { ...counters, scannedTrials, scannedSubs };
}

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
  graceStartedEmail, graceEndingEmail, manualInvoiceEmail, planChangedEmail, fmtAmount,
} from './templates/subscription';
import { createAndStoreManualInvoice } from '@/src/shared/payments/manualInvoice';
import {
  loadPaymentSettings, providerConfigFrom,
} from '@/src/shared/payments/config';
import { getSubscription, listSubscriptionInvoices, getInvoicePdfUrl } from '@/src/shared/payments/paddleApi';
import { computeLapseState } from '@/src/shared/entitlements/gate';
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

/** Run a claim -> send -> (release on throw) cycle. Never throws. */
async function dispatch(
  sb: SupabaseClient, key: MarkerKey, send: () => Promise<void>,
): Promise<boolean> {
  try {
    const go = await claim(sb, key);
    if (!go) return false;
    try {
      await send();
      return true;
    } catch (e) {
      await release(sb, key);
      console.warn(`[sub-email] send failed (${key.email_type}/${key.threshold}):`, e instanceof Error ? e.message : String(e));
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
  const key: MarkerKey = { user_id: args.userId, platform_slug: platform, email_type: 'welcome_paddle', threshold: 'once', anchor_day: dayStr(nowMs) };
  await dispatch(sb, key, async () => {
    const c = await getContact(sb, args.userId);
    if (!c) throw new Error('no contact');

    // Fetch the invoice PDF server-side (key stays server-side). Best effort.
    let attachments: EmailAttachment[] | undefined;
    try {
      const settings = await loadPaymentSettings(sb, platform);
      const cfg = providerConfigFrom(settings, 'paddle');
      if (cfg.apiKey) {
        let txId = args.transactionId ?? null;
        if (!txId && args.subscriptionId) {
          const inv = await listSubscriptionInvoices(cfg, args.subscriptionId);
          if (inv.ok && inv.data.length > 0) txId = inv.data[0].transactionId;
        }
        if (txId) {
          const urlRes = await getInvoicePdfUrl(cfg, txId);
          if (urlRes.ok) {
            const pdf = await fetch(urlRes.data, { cache: 'no-store' });
            if (pdf.ok) {
              const buf = Buffer.from(await pdf.arrayBuffer());
              attachments = [{ name: 'invoice.pdf', content: buf.toString('base64') }];
            }
          }
        }
      }
    } catch { /* attachment is best effort; send without it */ }

    const { subject, html } = await subscriptionActivePaddleEmail({
      name: c.name, planKey: args.planKey, billingUrl: billingUrl(), invoiceAttached: !!attachments,
    });
    await sendEmail({ to: c.email, subject, html, from: FROM.noreply, attachments });
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
  const key: MarkerKey = { user_id: args.userId, platform_slug: platform, email_type: 'welcome_manual', threshold: 'once', anchor_day: dayStr(Date.now()) };
  await dispatch(sb, key, async () => {
    const c = await getContact(sb, args.userId);
    if (!c) throw new Error('no contact');
    const { subject, html } = await planActiveManualEmail({
      name: c.name, planKey, startedAt: args.startedAt ?? null, expiresAt: args.expiresAt ?? null, billingUrl: dashboardUrl(),
    });
    await sendEmail({ to: c.email, subject, html, from: FROM.noreply });
  });
}

/** Subscription canceled confirmation. */
export async function sendSubscriptionCanceledEmail(
  sb: SupabaseClient,
  args: { userId: string; platform?: string; planKey: string; accessUntil?: string | null },
): Promise<void> {
  const platform = args.platform ?? PLATFORM_DEFAULT;
  const key: MarkerKey = { user_id: args.userId, platform_slug: platform, email_type: 'canceled', threshold: 'once', anchor_day: dayStr(Date.now()) };
  await dispatch(sb, key, async () => {
    const c = await getContact(sb, args.userId);
    if (!c) throw new Error('no contact');
    const { subject, html } = await subscriptionCanceledEmail({
      name: c.name, planKey: args.planKey, accessUntil: args.accessUntil ?? null, renewUrl: pricingUrl(platform),
    });
    await sendEmail({ to: c.email, subject, html, from: FROM.noreply });
  });
}

/** Trial started. */
export async function sendTrialStartedEmail(
  sb: SupabaseClient,
  args: { userId: string; platform?: string; trialEndsAt?: string | null },
): Promise<void> {
  const platform = args.platform ?? PLATFORM_DEFAULT;
  const key: MarkerKey = { user_id: args.userId, platform_slug: platform, email_type: 'trial_started', threshold: 'once', anchor_day: dayStr(Date.now()) };
  await dispatch(sb, key, async () => {
    const c = await getContact(sb, args.userId);
    if (!c) throw new Error('no contact');
    const { subject, html } = await trialStartedEmail({
      name: c.name, trialEndsAt: args.trialEndsAt ?? null, dashboardUrl: dashboardUrl(), pricingUrl: pricingUrl(platform),
    });
    await sendEmail({ to: c.email, subject, html, from: FROM.noreply });
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
  args: { userId: string; platform?: string; planKey: string; interval: 'monthly' | 'annual'; timing: 'immediate' | 'scheduled'; effectiveAt?: string | null },
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
    const { subject, html } = await planChangedEmail({
      name: c.name, planKey: args.planKey, interval: args.interval, timing: args.timing,
      effectiveAt: args.effectiveAt ?? null, manageUrl: billingUrl(), pricingUrl: pricingUrl(platform),
    });
    await sendEmail({ to: c.email, subject, html, from: FROM.noreply });
  });
}

/**
 * Issue a manual (offline/bank) receipt: generate + store the branded PDF, record
 * the manual_invoices row, and email the receipt with the PDF attached. Called by
 * the admin manual-assign + convert-to-manual-immediate routes when an amount is
 * present. Self-contained + never throws (a receipt failure must not break the
 * plan assignment). Skips none/trial and zero/absent amounts.
 */
export async function issueManualInvoice(
  sb: SupabaseClient,
  args: { userId: string; platform?: string; planKey: string | null; amountMinor: number | null; currency: string | null; issuedAt: string; periodEnd?: string | null },
): Promise<void> {
  try {
    const platform = args.platform ?? PLATFORM_DEFAULT;
    if (!args.amountMinor || args.amountMinor <= 0) return;
    const planKey = (args.planKey ?? '').toLowerCase();
    if (planKey === 'none' || planKey === 'trial') return;
    const c = await getContact(sb, args.userId);
    if (!c) return;

    // Company for the bill-to block. Fetched separately + schema-tolerant so a
    // pre-mig-172 schema (no company column) never breaks the receipt.
    let company: string | null = null;
    try {
      const { data } = await sb.from('users').select('company').eq('id', args.userId).maybeSingle();
      company = (data as { company?: string | null } | null)?.company ?? null;
    } catch { /* company column absent: omit from the receipt */ }

    const issued = await createAndStoreManualInvoice(sb, {
      userId: args.userId, platform, planKey: args.planKey, amountMinor: args.amountMinor,
      currency: args.currency ?? null, issuedAt: args.issuedAt, customerName: c.name, customerEmail: c.email,
      customerCompany: company, periodStart: args.issuedAt, periodEnd: args.periodEnd ?? null,
    });

    const { subject, html } = await manualInvoiceEmail({
      name: c.name, planKey: args.planKey ?? '', amount: fmtAmount(args.amountMinor, args.currency),
      receiptNumber: issued.receiptNumber, issuedAt: args.issuedAt, billingUrl: billingUrl(),
    });
    await sendEmail({
      to: c.email, subject, html, from: FROM.noreply,
      attachments: [{ name: `${issued.receiptNumber}.pdf`, content: Buffer.from(issued.pdfBytes).toString('base64') }],
    });
    try { await sb.from('manual_invoices').update({ email_sent_at: new Date().toISOString() }).eq('id', issued.id); } catch { /* best effort */ }
  } catch (e) {
    console.warn('[sub-email] issueManualInvoice failed:', e instanceof Error ? e.message : String(e));
  }
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
    await sendEmail({ to: contact.email, subject, html, from: FROM.noreply });
  });
}

async function sendRenewalReminder(sb: SupabaseClient, platform: string, userId: string, contact: Contact, planKey: string, renewsOnIso: string | null, amount: string, anchorMs: number, days: number): Promise<boolean> {
  const th = thresholdFor(days);
  if (!th) return false;
  const key: MarkerKey = { user_id: userId, platform_slug: platform, email_type: 'renewal_reminder', threshold: th, anchor_day: dayStr(anchorMs) };
  return dispatch(sb, key, async () => {
    const { subject, html } = await renewalReminderEmail({ name: contact.name, planKey, renewsOn: renewsOnIso, amount, daysLeft: days, manageUrl: billingUrl() });
    await sendEmail({ to: contact.email, subject, html, from: FROM.noreply });
  });
}

async function sendExpiryReminder(sb: SupabaseClient, platform: string, userId: string, contact: Contact, planKey: string, endsOnIso: string | null, anchorMs: number, days: number): Promise<boolean> {
  const th = thresholdFor(days);
  if (!th) return false;
  const key: MarkerKey = { user_id: userId, platform_slug: platform, email_type: 'expiry_reminder', threshold: th, anchor_day: dayStr(anchorMs) };
  return dispatch(sb, key, async () => {
    const { subject, html } = await expiryReminderEmail({ name: contact.name, planKey, endsOn: endsOnIso, daysLeft: days, renewUrl: pricingUrl(platform) });
    await sendEmail({ to: contact.email, subject, html, from: FROM.noreply });
  });
}

async function sendGraceStarted(sb: SupabaseClient, platform: string, userId: string, contact: Contact, graceEndsAtMs: number | null, anchorMs: number): Promise<boolean> {
  // 'once' per anchor: fires on the first cron run after grace begins.
  const key: MarkerKey = { user_id: userId, platform_slug: platform, email_type: 'grace_started', threshold: 'once', anchor_day: dayStr(anchorMs) };
  return dispatch(sb, key, async () => {
    const { subject, html } = await graceStartedEmail({ name: contact.name, graceEndsAt: graceEndsAtMs ? new Date(graceEndsAtMs).toISOString() : null, renewUrl: pricingUrl(platform) });
    await sendEmail({ to: contact.email, subject, html, from: FROM.noreply });
  });
}

async function sendGraceEnding(sb: SupabaseClient, platform: string, userId: string, contact: Contact, graceEndsAtMs: number, days: number): Promise<boolean> {
  const th = thresholdFor(days);
  if (!th) return false;
  const key: MarkerKey = { user_id: userId, platform_slug: platform, email_type: 'grace_ending', threshold: th, anchor_day: dayStr(graceEndsAtMs) };
  return dispatch(sb, key, async () => {
    const { subject, html } = await graceEndingEmail({ name: contact.name, graceEndsAt: new Date(graceEndsAtMs).toISOString(), daysLeft: days, renewUrl: pricingUrl(platform) });
    await sendEmail({ to: contact.email, subject, html, from: FROM.noreply });
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

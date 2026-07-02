/**
 * payments/config.ts (server)
 *
 * Loads + shapes the provider-agnostic payment config (payment_settings table,
 * mig 167) and the per-plan provider price ids (entitlement_plans, mig 166).
 * Read ONLY server-side with the service-role client. The mask helper produces
 * the client-safe view (booleans for "secret is set"), so secrets never reach
 * the browser.
 *
 * Pure helpers (mask / providerConfigFrom / planProviderPriceId / defaults) are
 * exported separately so they are unit-testable without a database.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActiveProvider, PaymentProvider, ProviderConfig, BillingInterval } from './types';

/** The plan a cancelled / expired subscriber drops to (re-resolved like any
 *  admin change via setUserPlan). Trial is the entry plan in this catalog. */
export const BASELINE_PLAN_KEY = 'trial';

export interface PaymentSettingsRow {
  platform_slug: string;
  active_provider: ActiveProvider;
  paddle_api_key: string | null;
  paddle_api_secret: string | null;
  paddle_webhook_secret: string | null;
  /** Publishable Paddle.js client-side token (mig 170). Not a secret. */
  paddle_client_token: string | null;
  paddle_sandbox: boolean;
  paypro_api_key: string | null;
  paypro_api_secret: string | null;
  paypro_webhook_secret: string | null;
  paypro_sandbox: boolean;
}

/** Client-safe masked view: never carries a raw SECRET, only whether it is set.
 *  `client_token` is the one publishable value and IS returned in full (the
 *  browser needs it to open Paddle.js checkout). */
export interface MaskedProvider {
  configured: boolean;
  has_api_key: boolean;
  has_api_secret: boolean;
  has_webhook_secret: boolean;
  client_token: string | null;
  sandbox: boolean;
}
export interface MaskedPaymentSettings {
  active_provider: ActiveProvider;
  paddle: MaskedProvider;
  paypro: MaskedProvider;
}

export function defaultPaymentSettings(platform: string): PaymentSettingsRow {
  return {
    platform_slug: platform,
    active_provider: 'none',
    paddle_api_key: null, paddle_api_secret: null, paddle_webhook_secret: null, paddle_client_token: null, paddle_sandbox: true,
    paypro_api_key: null, paypro_api_secret: null, paypro_webhook_secret: null, paypro_sandbox: true,
  };
}

const BASE_COLUMNS =
  'platform_slug, active_provider, paddle_api_key, paddle_api_secret, paddle_webhook_secret, paddle_sandbox, paypro_api_key, paypro_api_secret, paypro_webhook_secret, paypro_sandbox';

/**
 * Load the singleton payment-settings row for a platform. Tolerant of the
 * migration not being applied yet (returns the safe default: provider 'none'),
 * so checkout stays a placeholder rather than erroring. Schema-tolerant for the
 * paddle_client_token column (mig 170): tries to read it, and if the column is
 * absent falls back to the base columns so the rest keeps working pre-migration.
 */
export async function loadPaymentSettings(
  sb: SupabaseClient, platform = 'real-estate',
): Promise<PaymentSettingsRow> {
  const withToken = await sb
    .from('payment_settings')
    .select(`${BASE_COLUMNS}, paddle_client_token`)
    .eq('platform_slug', platform)
    .maybeSingle();
  if (!withToken.error) {
    if (!withToken.data) return defaultPaymentSettings(platform);
    return { ...defaultPaymentSettings(platform), ...(withToken.data as Partial<PaymentSettingsRow>) } as PaymentSettingsRow;
  }
  // Fallback: column not present yet (mig 170 not applied). Read the rest.
  const base = await sb
    .from('payment_settings')
    .select(BASE_COLUMNS)
    .eq('platform_slug', platform)
    .maybeSingle();
  if (base.error || !base.data) return defaultPaymentSettings(platform);
  return { ...defaultPaymentSettings(platform), ...(base.data as Partial<PaymentSettingsRow>) } as PaymentSettingsRow;
}

/** Build a provider's resolved credentials from the settings row (server only). */
export function providerConfigFrom(row: PaymentSettingsRow, provider: PaymentProvider): ProviderConfig {
  if (provider === 'paddle') {
    return { provider, apiKey: row.paddle_api_key, apiSecret: row.paddle_api_secret, webhookSecret: row.paddle_webhook_secret, clientToken: row.paddle_client_token, sandbox: row.paddle_sandbox };
  }
  return { provider, apiKey: row.paypro_api_key, apiSecret: row.paypro_api_secret, webhookSecret: row.paypro_webhook_secret, clientToken: null, sandbox: row.paypro_sandbox };
}

/** Produce the client-safe masked view. No SECRET ever leaves here; the paddle
 *  client token IS returned (publishable, needed by the browser). */
export function maskPaymentSettings(row: PaymentSettingsRow): MaskedPaymentSettings {
  // `configured` reflects what each provider ACTUALLY needs to operate, so the
  // admin badge tells the truth. It is passed in per provider rather than
  // computed identically, because the two providers have different requirements.
  const m = (key: string | null, secret: string | null, webhook: string | null, clientToken: string | null, sandbox: boolean, configured: boolean): MaskedProvider => ({
    configured,
    has_api_key: !!key,
    has_api_secret: !!secret,
    has_webhook_secret: !!webhook,
    client_token: clientToken,
    sandbox,
  });
  return {
    active_provider: row.active_provider,
    // Paddle (Billing) overlay checkout needs only the publishable client-side
    // token + the webhook secret: createCheckout uses clientToken + the per-plan
    // price id, verifyWebhook uses the webhook secret. There is NO api_secret in
    // Paddle Billing, and the api_key is only for optional server-side REST calls
    // the overlay flow never makes. So readiness = client token + webhook secret.
    paddle: m(
      row.paddle_api_key, row.paddle_api_secret, row.paddle_webhook_secret, row.paddle_client_token, row.paddle_sandbox,
      !!row.paddle_client_token && !!row.paddle_webhook_secret,
    ),
    // PayPro is still a stub; keep its original key + secret + webhook readiness.
    paypro: m(
      row.paypro_api_key, row.paypro_api_secret, row.paypro_webhook_secret, null, row.paypro_sandbox,
      !!row.paypro_api_key && !!row.paypro_api_secret && !!row.paypro_webhook_secret,
    ),
  };
}

/** Minimal plan shape carrying the provider id columns (mig 166). */
export interface PlanProviderIds {
  plan_key: string;
  paddle_price_id_monthly: string | null;
  paddle_price_id_annual: string | null;
  paypro_product_id: string | null;
}

/** A plan option for the upgrade/downgrade picker: key + label + Paddle price
 *  ids + the catalog prices (for upgrade/downgrade classification). Read from
 *  entitlement_plans (active only) for one platform. */
export interface PlatformPlanOption extends PlanProviderIds {
  label: string;
  display_order: number | null;
  price_monthly: number | null;
  price_annual: number | null;
  currency: string | null;
}

/** Load a platform's active plans (key + label + price ids + prices) in display
 *  order. Used by the billing tab to show the upgrade/downgrade choices, by the
 *  change-plan route to resolve the target Paddle price id, and to classify a
 *  change as upgrade vs downgrade. Tolerant: returns [] if the table is absent,
 *  and falls back to a price-free select if the price columns are missing. */
export async function loadPlatformPlanOptions(
  sb: SupabaseClient, platform: string,
): Promise<PlatformPlanOption[]> {
  try {
    const withPrices = await sb
      .from('entitlement_plans')
      .select('plan_key, label, display_order, paddle_price_id_monthly, paddle_price_id_annual, paypro_product_id, price_monthly, price_annual, currency')
      .eq('platform_slug', platform)
      .eq('active', true)
      .order('display_order');
    if (!withPrices.error) return (withPrices.data ?? []) as PlatformPlanOption[];
    // Price columns absent (older schema): fall back, leaving prices null.
    const base = await sb
      .from('entitlement_plans')
      .select('plan_key, label, display_order, paddle_price_id_monthly, paddle_price_id_annual, paypro_product_id')
      .eq('platform_slug', platform)
      .eq('active', true)
      .order('display_order');
    if (base.error) return [];
    return (base.data ?? []).map((p) => ({ ...(p as object), price_monthly: null, price_annual: null, currency: null })) as PlatformPlanOption[];
  } catch {
    return [];
  }
}

/** Whether a plan change is an upgrade, downgrade, lateral, or a same-plan
 *  INTERVAL change. Drives the timing rule: upgrades + interval changes apply
 *  immediately (prorated/annual-upfront now), downgrades defer to the next
 *  billing cycle, laterals apply immediately. An interval change is NOT a tier
 *  move and must never be classified as a downgrade by the annual discount. */
export type PlanChangeType = 'upgrade' | 'downgrade' | 'lateral' | 'interval';

/** Monthly-equivalent price for a plan at an interval (annual normalized /12), so
 *  an interval change is compared on the same basis. Null when the price is not
 *  set (the caller then defaults to immediate, never a silent deferral). */
export function effectiveMonthlyPrice(
  plan: { price_monthly: number | null; price_annual: number | null }, interval: BillingInterval,
): number | null {
  const v = interval === 'annual' ? plan.price_annual : plan.price_monthly;
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  return interval === 'annual' ? Number(v) / 12 : Number(v);
}

/** Classify a change by comparing effective monthly prices. Unknown prices ->
 *  'upgrade' (immediate) so we never silently defer a change we cannot price. */
export function classifyPlanChange(currentEff: number | null, targetEff: number | null): PlanChangeType {
  if (currentEff === null || targetEff === null) return 'upgrade';
  const eps = 0.005;
  if (targetEff > currentEff + eps) return 'upgrade';
  if (targetEff < currentEff - eps) return 'downgrade';
  return 'lateral';
}

/**
 * Classify a plan/interval change, distinguishing a same-plan INTERVAL change
 * from a tier upgrade/downgrade (bug b fix). A same plan_key with a different
 * interval is an 'interval' change (applied immediately), NOT a downgrade. The
 * tier comparison is done at a SINGLE interval (monthly list price) so the
 * annual discount never makes an annual switch look like a tier downgrade.
 */
export function classifyPlanOrIntervalChange(
  currentPlanKey: string | null, currentInterval: BillingInterval,
  targetPlanKey: string, targetInterval: BillingInterval,
  plans: PlatformPlanOption[],
): PlanChangeType {
  // Same plan, different interval -> interval change (not a tier move).
  if (currentPlanKey && targetPlanKey === currentPlanKey && targetInterval !== currentInterval) {
    return 'interval';
  }
  // Tier comparison at a single interval (monthly list price), so the interval
  // discount is excluded from the upgrade/downgrade decision.
  const cur = plans.find((p) => p.plan_key === currentPlanKey)?.price_monthly ?? null;
  const tgt = plans.find((p) => p.plan_key === targetPlanKey)?.price_monthly ?? null;
  return classifyPlanChange(
    cur === null ? null : Number(cur),
    tgt === null ? null : Number(tgt),
  );
}

/** The full per-platform subscription row (mig 177 + 178 + 179), schema-tolerant.
 *  Used to detect a live Paddle subscription (block manual changes) and to drive
 *  the admin view + the manual billing-panel branch. */
export interface PlatformSubscriptionRow {
  plan_key: string | null;
  source: 'paddle' | 'manual';
  status: string | null;
  paddle_subscription_id: string | null;
  paddle_customer_id: string | null;
  started_at: string | null;
  current_period_end: string | null;
  expires_at: string | null;
  amount_minor: number | null;
  currency: string | null;
  note: string | null;
}

/** Load the per-platform subscription row, tolerant of pre-mig-179 schema (the
 *  manual columns absent) by falling back to the mig-177 columns. Note:
 *  scheduled_cancel_at (mig 183) is intentionally NOT selected here so a DB
 *  without that migration does not fail this all-or-nothing select; the admin
 *  list reads that column via its own schema-tolerant query. */
export async function loadPlatformSubscriptionRow(
  sb: SupabaseClient, userId: string, platform: string,
): Promise<PlatformSubscriptionRow | null> {
  const FULL = 'plan_key, source, status, paddle_subscription_id, paddle_customer_id, started_at, current_period_end, expires_at, amount_minor, currency, note';
  try {
    const full = await sb.from('user_platform_subscriptions').select(FULL).eq('user_id', userId).eq('platform_slug', platform).maybeSingle();
    if (!full.error) {
      if (!full.data) return null;
      const r = full.data as Partial<PlatformSubscriptionRow>;
      return { source: 'paddle', status: null, plan_key: null, paddle_subscription_id: null, paddle_customer_id: null, started_at: null, current_period_end: null, expires_at: null, amount_minor: null, currency: null, note: null, ...r } as PlatformSubscriptionRow;
    }
    // Pre mig 179: read the mig-177 columns only.
    const base = await sb.from('user_platform_subscriptions').select('plan_key, paddle_subscription_id, paddle_customer_id').eq('user_id', userId).eq('platform_slug', platform).maybeSingle();
    if (base.error || !base.data) return null;
    const r = base.data as { plan_key: string | null; paddle_subscription_id: string | null; paddle_customer_id: string | null };
    return { plan_key: r.plan_key, source: 'paddle', status: null, paddle_subscription_id: r.paddle_subscription_id, paddle_customer_id: r.paddle_customer_id, started_at: null, current_period_end: null, expires_at: null, amount_minor: null, currency: null, note: null };
  } catch {
    return null;
  }
}

/** Whether the user has a LIVE Paddle subscription for the platform (a Paddle id
 *  present, source paddle, not canceled). Admin manual plan changes are blocked
 *  for such users (the change must go through the billing flow / Paddle). */
export function isLivePaddleSubscription(row: PlatformSubscriptionRow | null): boolean {
  if (!row) return false;
  return row.source !== 'manual' && !!row.paddle_subscription_id && row.status !== 'canceled';
}

/** The single shared message shown when a local/manual plan change is blocked
 *  because the user is billed by Paddle. Reused by the plan route AND the trial
 *  paths so a Paddle-billed user is never silently moved in the app while Paddle
 *  keeps billing the old plan. */
export const PADDLE_BILLED_BLOCK_MESSAGE =
  'This user is billed by Paddle. Change their plan through the billing flow (upgrade/downgrade or cancel in the subscription), not a manual override, so Paddle is not left billing the old plan.';

/** True when the user currently holds a LIVE Paddle subscription for the platform.
 *  Wraps the row read + the pure check so the trial paths can reuse the SAME guard
 *  the plan route uses, without duplicating the row-loading logic. Tolerant: any
 *  read failure resolves to false (the guard only BLOCKS on a positive match, so a
 *  failed read never wrongly blocks a legitimate grant). */
export async function isUserLivePaddle(
  sb: SupabaseClient, userId: string, platform: string,
): Promise<boolean> {
  if (!userId || !platform) return false;
  const row = await loadPlatformSubscriptionRow(sb, userId, platform);
  return isLivePaddleSubscription(row);
}

/**
 * Converge store B (user_platform_subscriptions) to match a plan write on store A,
 * WITHOUT disturbing webhook-owned metadata. This is an UPDATE-only (never an
 * insert): it sets only the provided fields + updated_at on an EXISTING
 * (user, platform) row, so source, paddle_subscription_id/customer_id, and the
 * Paddle period/dates are all preserved. If no row exists (e.g. a brand-new trial
 * user), it is a no-op (no fabricated 'paddle'-defaulted row). Best effort +
 * schema-tolerant. When opts.manualOnly is set, it only touches manual-source
 * rows (used by the legacy admin status dropdown, so webhook-owned Paddle status
 * is never overwritten).
 */
export async function syncPlatformSubscriptionFields(
  sb: SupabaseClient, userId: string, platform: string,
  fields: { planKey?: string; status?: string },
  opts?: { manualOnly?: boolean },
): Promise<void> {
  if (!userId || !platform) return;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.planKey !== undefined) patch.plan_key = fields.planKey;
  if (fields.status !== undefined) patch.status = fields.status;
  // Nothing but updated_at to write: skip.
  if (Object.keys(patch).length <= 1) return;
  try {
    let q = sb.from('user_platform_subscriptions').update(patch)
      .eq('user_id', userId).eq('platform_slug', platform);
    if (opts?.manualOnly) q = q.eq('source', 'manual');
    await q;
  } catch {
    // table/columns absent pre-migration, or transient error: ignore (store A,
    // the gate input, was already written by the caller).
  }
}

/**
 * Persist a cancel-AT-PERIOD-END marker on the per-platform row (mig 183). Written
 * by the cancel paths (self-service cancel, convert-at-period-end) and the webhook
 * when a scheduled cancel is detected, so the admin views can show a
 * Canceling / Canceled status + the date access ends WITHOUT a live Paddle call.
 *
 * UPDATE-only (never inserts) + best effort + schema-tolerant, exactly like
 * syncPlatformSubscriptionFields. Deliberately does NOT touch `status` or `source`
 * (the row stays a LIVE Paddle sub until the period actually ends, and the
 * subscription.updated webhook re-converges status), so isLivePaddleSubscription
 * and the gate inputs are unaffected. Cleared on (re)activation by
 * storeUserPlatformSubscription. Pass scheduledCancelAt=null to CLEAR the marker
 * (e.g. a cancel was un-scheduled).
 */
export async function markSubscriptionCanceling(
  sb: SupabaseClient, userId: string, platform: string,
  fields: { scheduledCancelAt: string | null; currentPeriodEnd?: string | null },
): Promise<void> {
  if (!userId || !platform) return;
  const patch: Record<string, unknown> = { scheduled_cancel_at: fields.scheduledCancelAt, updated_at: new Date().toISOString() };
  if (fields.currentPeriodEnd !== undefined) patch.current_period_end = fields.currentPeriodEnd;
  try {
    await sb.from('user_platform_subscriptions').update(patch)
      .eq('user_id', userId).eq('platform_slug', platform);
  } catch {
    // column absent pre mig 183, or transient error: ignore (display only, the
    // gate's inputs were untouched).
  }
}

// ── Revenue ledger (mig 180: payment_transactions) ──────────────────────────
// A unified ledger so the admin Revenue page aggregates across ALL users from
// the DB (no per-user Paddle calls). Paddle rows are reconcilable (external_id =
// Paddle transaction id); manual rows are admin-logged offline payments.

export interface LedgerEntry {
  source: 'paddle' | 'manual';
  externalId: string | null;
  userId: string | null;
  platform: string;
  planKey: string | null;
  amountMinor: number;
  currency: string | null;
  status: string;
  billedAt: string | null;
}

/** Record one ledger row. Idempotent for Paddle (unique on source+external_id):
 *  a redelivered transaction.completed will not double-count. Best effort. */
export async function recordPaymentTransaction(sb: SupabaseClient, e: LedgerEntry): Promise<void> {
  if (!Number.isFinite(e.amountMinor)) return;
  try {
    if (e.source === 'paddle' && e.externalId) {
      await sb.from('payment_transactions').upsert({
        source: e.source, external_id: e.externalId, user_id: e.userId, platform_slug: e.platform,
        plan_key: e.planKey, amount_minor: e.amountMinor, currency: e.currency, status: e.status, billed_at: e.billedAt,
      }, { onConflict: 'source,external_id' });
    } else {
      await sb.from('payment_transactions').insert({
        source: e.source, external_id: e.externalId, user_id: e.userId, platform_slug: e.platform,
        plan_key: e.planKey, amount_minor: e.amountMinor, currency: e.currency, status: e.status, billed_at: e.billedAt,
      });
    }
  } catch {
    // table absent pre mig 180: ignore (reporting only).
  }
}

export interface RevenueSummary {
  totalMinor: number;
  paddleMinor: number;
  manualMinor: number;
  currency: string | null;
  byPlan: { plan_key: string; source: 'paddle' | 'manual'; amountMinor: number }[];
  rowCount: number;
}

/** Aggregate revenue from the ledger over a date range (billed_at), grouped by
 *  source + plan. Structured to extend to a per-platform split later (the row
 *  carries platform_slug; pass `platform` to scope). One DB read, no Paddle calls. */
export async function aggregateRevenue(
  sb: SupabaseClient, opts: { from?: string | null; to?: string | null; platform?: string | null },
): Promise<RevenueSummary> {
  const empty: RevenueSummary = { totalMinor: 0, paddleMinor: 0, manualMinor: 0, currency: null, byPlan: [], rowCount: 0 };
  try {
    let q = sb.from('payment_transactions').select('source, plan_key, amount_minor, currency, billed_at');
    if (opts.from) q = q.gte('billed_at', opts.from);
    if (opts.to) q = q.lte('billed_at', opts.to);
    if (opts.platform) q = q.eq('platform_slug', opts.platform);
    const { data, error } = await q;
    if (error) return empty;
    const rows = (data ?? []) as { source: string; plan_key: string | null; amount_minor: number; currency: string | null }[];
    const planMap = new Map<string, { plan_key: string; source: 'paddle' | 'manual'; amountMinor: number }>();
    let paddleMinor = 0; let manualMinor = 0; let currency: string | null = null;
    for (const r of rows) {
      const amt = Number(r.amount_minor) || 0;
      const src: 'paddle' | 'manual' = r.source === 'manual' ? 'manual' : 'paddle';
      if (src === 'manual') manualMinor += amt; else paddleMinor += amt;
      currency = currency ?? r.currency;
      const key = `${src}::${r.plan_key ?? 'unknown'}`;
      const cur = planMap.get(key) ?? { plan_key: r.plan_key ?? 'unknown', source: src, amountMinor: 0 };
      cur.amountMinor += amt;
      planMap.set(key, cur);
    }
    return {
      totalMinor: paddleMinor + manualMinor, paddleMinor, manualMinor, currency,
      byPlan: Array.from(planMap.values()).sort((a, b) => b.amountMinor - a.amountMinor),
      rowCount: rows.length,
    };
  } catch {
    return empty;
  }
}

// ── Scheduled convert-to-manual (mig 180) ───────────────────────────────────

export interface ScheduledManualConversion {
  planKey: string;
  expiresAt: string | null;
  amountMinor: number | null;
  currency: string | null;
  note: string | null;
  effectiveAt: string | null;
}

/** Schedule a convert-to-manual at the Paddle period end. The webhook
 *  (subscription.canceled) applies it at that date; the cron is a backstop. */
export async function storeScheduledManualConversion(
  sb: SupabaseClient, userId: string, platform: string, c: ScheduledManualConversion,
): Promise<void> {
  if (!userId || !platform) return;
  try {
    await sb.from('user_platform_subscriptions').update({
      scheduled_to_manual: true,
      scheduled_manual_plan_key: c.planKey,
      scheduled_manual_expires_at: c.expiresAt,
      scheduled_manual_amount_minor: c.amountMinor,
      scheduled_manual_currency: c.currency,
      scheduled_manual_note: c.note,
      scheduled_effective_at: c.effectiveAt,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('platform_slug', platform);
  } catch {
    // columns absent pre mig 180: ignore.
  }
}

/** Clear a pending convert-to-manual schedule (after it applies, or if canceled). */
export async function clearScheduledManualConversion(sb: SupabaseClient, userId: string, platform: string): Promise<void> {
  if (!userId || !platform) return;
  try {
    await sb.from('user_platform_subscriptions').update({
      scheduled_to_manual: false,
      scheduled_manual_plan_key: null,
      scheduled_manual_expires_at: null,
      scheduled_manual_amount_minor: null,
      scheduled_manual_currency: null,
      scheduled_manual_note: null,
      scheduled_effective_at: null,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('platform_slug', platform);
  } catch {
    // ignore.
  }
}

/** Read a pending convert-to-manual for a user (schema-tolerant). */
export async function loadScheduledManualConversion(
  sb: SupabaseClient, userId: string, platform: string,
): Promise<ScheduledManualConversion | null> {
  try {
    const { data, error } = await sb
      .from('user_platform_subscriptions')
      .select('scheduled_to_manual, scheduled_manual_plan_key, scheduled_manual_expires_at, scheduled_manual_amount_minor, scheduled_manual_currency, scheduled_manual_note, scheduled_effective_at')
      .eq('user_id', userId).eq('platform_slug', platform).maybeSingle();
    if (error || !data) return null;
    const r = data as Record<string, unknown>;
    if (!r.scheduled_to_manual || !r.scheduled_manual_plan_key) return null;
    return {
      planKey: r.scheduled_manual_plan_key as string,
      expiresAt: (r.scheduled_manual_expires_at as string | null) ?? null,
      amountMinor: (r.scheduled_manual_amount_minor as number | null) ?? null,
      currency: (r.scheduled_manual_currency as string | null) ?? null,
      note: (r.scheduled_manual_note as string | null) ?? null,
      effectiveAt: (r.scheduled_effective_at as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/** Upsert a MANUAL (admin-assigned, offline-paid) subscription on the per-platform
 *  row. Sets source='manual', the plan + status + dates + amount, and clears any
 *  stale Paddle ids (a manual plan is not Paddle-billed). Best effort +
 *  schema-tolerant: a missing table/column is swallowed so the users-row write
 *  (the gate input) still stands. */
export async function upsertManualSubscription(
  sb: SupabaseClient, userId: string, platform: string,
  data: { planKey: string; status: string; startedAt: string | null; currentPeriodEnd: string | null; expiresAt: string | null; amountMinor: number | null; currency: string | null; note: string | null },
): Promise<void> {
  if (!userId || !platform) return;
  try {
    await sb.from('user_platform_subscriptions').upsert({
      user_id: userId,
      platform_slug: platform,
      plan_key: data.planKey,
      source: 'manual',
      status: data.status,
      started_at: data.startedAt,
      current_period_end: data.currentPeriodEnd,
      expires_at: data.expiresAt,
      amount_minor: data.amountMinor,
      currency: data.currency,
      note: data.note,
      paddle_subscription_id: null,
      paddle_customer_id: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,platform_slug' });
  } catch {
    // table/columns absent pre-migration: ignore (gate input still written).
  }
}

/** Store a DEFERRED downgrade on the per-platform row (mig 178): apply it at
 *  `effectiveAt` (the current period end). Best effort + schema-tolerant. */
export async function storeScheduledChange(
  sb: SupabaseClient, userId: string, platform: string,
  data: { planKey: string; interval: BillingInterval; priceId: string; effectiveAt: string | null },
): Promise<void> {
  if (!userId || !platform) return;
  try {
    await sb.from('user_platform_subscriptions').update({
      scheduled_plan_key: data.planKey,
      scheduled_interval: data.interval,
      scheduled_price_id: data.priceId,
      scheduled_effective_at: data.effectiveAt,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('platform_slug', platform);
  } catch {
    // columns absent pre mig 178: ignore.
  }
}

/** Clear any scheduled change on the per-platform row (mig 178). Called when an
 *  upgrade applies (supersedes a pending downgrade) or the user cancels it. */
export async function clearScheduledChange(
  sb: SupabaseClient, userId: string, platform: string,
): Promise<void> {
  if (!userId || !platform) return;
  try {
    await sb.from('user_platform_subscriptions').update({
      scheduled_plan_key: null,
      scheduled_interval: null,
      scheduled_price_id: null,
      scheduled_effective_at: null,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('platform_slug', platform);
  } catch {
    // columns absent pre mig 178: ignore.
  }
}

/** Pick the provider price/product id for a plan at a billing interval. Pure. */
export function planProviderPriceId(
  plan: PlanProviderIds, provider: PaymentProvider, interval: BillingInterval,
): string | null {
  if (provider === 'paddle') {
    return interval === 'annual' ? plan.paddle_price_id_annual : plan.paddle_price_id_monthly;
  }
  return plan.paypro_product_id;
}

// ── Webhook idempotency (mig 171: payment_webhook_events) ───────────────────
// The definitive replay guard: the same provider event id is applied at most
// once. Both helpers are tolerant of the table not existing yet (pre-migration),
// degrading to "no guard" rather than erroring, so the webhook still functions.

/** True when this provider event id has already been processed. */
export async function wasWebhookEventProcessed(
  sb: SupabaseClient, provider: PaymentProvider, eventId: string | null,
): Promise<boolean> {
  if (!eventId) return false;
  try {
    const { data, error } = await sb
      .from('payment_webhook_events')
      .select('event_id')
      .eq('provider', provider)
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) return false; // table absent pre-migration: no guard, proceed
    return !!data;
  } catch {
    return false;
  }
}

/** Record a processed event id (best effort). A duplicate / missing table is
 *  swallowed so a redelivery is still treated idempotently by the read above. */
export async function recordWebhookEvent(
  sb: SupabaseClient, provider: PaymentProvider, eventId: string | null,
  info: { eventType?: string | null; planKey?: string | null; userId?: string | null; status?: string | null },
): Promise<void> {
  if (!eventId) return;
  try {
    await sb.from('payment_webhook_events').insert({
      provider, event_id: eventId,
      event_type: info.eventType ?? null,
      plan_key: info.planKey ?? null,
      user_id: info.userId ?? null,
      status: info.status ?? null,
    });
  } catch {
    // duplicate (PK conflict) or table absent: ignore.
  }
}

/**
 * Persist the provider subscription + customer ids on the user (mig 176). Called
 * by the webhook AFTER a successful plan apply, so the dashboard can act on the
 * subscription via the provider API. This writes ONLY the two opaque id columns:
 * it never touches subscription_plan / subscription_status / trial_ends_at (the
 * gate's inputs), so enforcement is unaffected. Best effort + schema-tolerant:
 * a missing column (pre-migration) or any error is swallowed, so the webhook
 * still succeeds at setting the plan even before mig 176 is applied.
 */
export async function storeUserSubscriptionIds(
  sb: SupabaseClient,
  userId: string,
  ids: { subscriptionId: string | null; customerId: string | null },
): Promise<void> {
  if (!userId) return;
  const patch: Record<string, string> = {};
  if (ids.subscriptionId) patch.paddle_subscription_id = ids.subscriptionId;
  if (ids.customerId) patch.paddle_customer_id = ids.customerId;
  if (Object.keys(patch).length === 0) return;
  try {
    await sb.from('users').update(patch).eq('id', userId);
  } catch {
    // column absent pre-migration, or transient error: ignore (plan apply stands).
  }
}

/**
 * Upsert the user's subscription row FOR ONE PLATFORM (mig 177). Keyed by
 * (user_id, platform_slug) so a user can hold one subscription per platform.
 * Called by the webhook AFTER a successful plan apply. Like the global store it
 * never touches the gate's inputs, so enforcement is unaffected. Best effort +
 * schema-tolerant: a missing table (pre mig 177) or any error is swallowed so
 * the plan apply still stands.
 */
export async function storeUserPlatformSubscription(
  sb: SupabaseClient,
  userId: string,
  platform: string,
  data: { subscriptionId: string | null; customerId: string | null; planKey: string | null },
): Promise<void> {
  if (!userId || !platform) return;
  try {
    // source: 'paddle' is CRITICAL: this row may already exist with
    // source='manual' (an admin-assigned plan the user then subscribed over). The
    // upsert only writes the fields it names, so without this the row keeps
    // source='manual' and the billing tab + context wrongly render "Managed by
    // your team". Mirror of upsertManualSubscription (which clears the Paddle ids).
    await sb.from('user_platform_subscriptions').upsert({
      user_id: userId,
      platform_slug: platform,
      source: 'paddle',
      paddle_subscription_id: data.subscriptionId,
      paddle_customer_id: data.customerId,
      plan_key: data.planKey,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,platform_slug' });
  } catch {
    // table absent pre-migration, or transient error: ignore (plan apply stands).
  }
  // Best-effort, separate from the critical write above: clear stale manual-only
  // columns so a prior manual record's expiry/amount/note does not linger on a
  // now-Paddle row (mig 179 columns; swallow if absent). Also clear any prior
  // cancel marker (mig 183): an activation means the subscription is live again,
  // so a resubscribe must not still read as Canceled in the admin views.
  try {
    await sb.from('user_platform_subscriptions')
      .update({ expires_at: null, amount_minor: null, note: null })
      .eq('user_id', userId).eq('platform_slug', platform);
  } catch {
    // mig-179 columns absent: nothing to clear.
  }
  try {
    await sb.from('user_platform_subscriptions')
      .update({ scheduled_cancel_at: null })
      .eq('user_id', userId).eq('platform_slug', platform);
  } catch {
    // mig-183 column absent: nothing to clear.
  }
}

/** Null out the stored Paddle subscription/customer ids on the per-platform row.
 *  Used on the baseline drop after a Paddle cancellation so the row does not keep
 *  masquerading as a LIVE Paddle subscription (isLivePaddleSubscription needs a
 *  paddle_subscription_id): a dead id there mis-renders the billing tab and wrongly
 *  blocks a later manual assignment. Touches ONLY the id columns (never plan /
 *  status / source, which setUserPlan converges), so gate inputs are unaffected.
 *  Best effort + schema-tolerant. */
export async function clearPaddleSubscriptionIds(
  sb: SupabaseClient, userId: string, platform: string,
): Promise<void> {
  if (!userId || !platform) return;
  try {
    await sb.from('user_platform_subscriptions')
      .update({ paddle_subscription_id: null, paddle_customer_id: null, updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('platform_slug', platform);
  } catch {
    // table/columns absent pre-migration: nothing to clear.
  }
}

/**
 * Map a provider price/product id from a webhook event back to the internal
 * plan_key (+ the interval it represents for Paddle). Returns null when no plan
 * carries that id. Server-side query against entitlement_plans (mig 166).
 */
export async function mapProviderPriceIdToPlan(
  sb: SupabaseClient,
  provider: PaymentProvider,
  providerPriceOrProductId: string | null,
  platform = 'real-estate',
): Promise<{ plan_key: string; interval: BillingInterval } | null> {
  if (!providerPriceOrProductId) return null;
  const { data } = await sb
    .from('entitlement_plans')
    .select('plan_key, paddle_price_id_monthly, paddle_price_id_annual, paypro_product_id')
    .eq('platform_slug', platform);
  for (const p of (data ?? []) as PlanProviderIds[]) {
    if (provider === 'paddle') {
      if (p.paddle_price_id_monthly === providerPriceOrProductId) return { plan_key: p.plan_key, interval: 'monthly' };
      if (p.paddle_price_id_annual === providerPriceOrProductId) return { plan_key: p.plan_key, interval: 'annual' };
    } else if (p.paypro_product_id === providerPriceOrProductId) {
      return { plan_key: p.plan_key, interval: 'monthly' };
    }
  }
  return null;
}

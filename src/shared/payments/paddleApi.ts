/**
 * payments/paddleApi.ts (SERVER ONLY)
 *
 * A thin server-side client for the Paddle (Paddle Billing) REST API, used by
 * the in-dashboard subscription panel. EVERY call here uses the server-side
 * Paddle API key (cfg.apiKey) and MUST run on the server (API routes) only: the
 * key is a secret and never reaches the browser. The client only ever receives
 * the resulting data or a Paddle-hosted secure URL.
 *
 * Sandbox vs live is driven by cfg.sandbox (sandbox-api.paddle.com vs
 * api.paddle.com). No live endpoint is hit while sandbox is true.
 *
 * Scopes the configured API key needs (set in Paddle > Developer Tools >
 * Authentication):
 *   - subscription.read   get subscription + management URLs
 *   - subscription.write  cancel at period end
 *   - transaction.read    list invoices + fetch invoice PDF URL
 *
 * This module makes NO entitlement decisions and never writes the user's plan.
 * The webhook (subscription.canceled) remains the single path that drops a
 * cancelled user to the baseline plan, so enforcement is unchanged.
 *
 * No em dashes in this file.
 */
import type { ProviderConfig } from './types';

const SANDBOX_BASE = 'https://sandbox-api.paddle.com';
const LIVE_BASE = 'https://api.paddle.com';

export function paddleApiBase(sandbox: boolean): string {
  return sandbox ? SANDBOX_BASE : LIVE_BASE;
}

/** A normalized, client-safe view of a Paddle subscription (no secrets). */
export interface SubscriptionSummary {
  subscriptionId: string;
  status: string;                 // active | trialing | past_due | canceled | paused
  nextBilledAt: string | null;    // ISO, null when none scheduled (e.g. canceled)
  currentPeriodEndsAt: string | null;
  amountMinor: number | null;     // recurring amount in minor units (e.g. cents)
  currency: string | null;
  /** When a cancel is scheduled (cancel-at-period-end), the date access ends. */
  scheduledCancelAt: string | null;
  canceled: boolean;
  /** Paddle-hosted secure URL to update the payment method (no card data here). */
  updatePaymentMethodUrl: string | null;
  /** The current item's price id, so the server can detect a same-plan no-op. */
  currentPriceId: string | null;
  /** The billing interval of the current item ('monthly' | 'annual' | null),
   *  used to pick the matching target price id on an upgrade / downgrade. */
  billingInterval: 'monthly' | 'annual' | null;
}

export interface InvoiceSummary {
  transactionId: string;
  status: string;
  billedAt: string | null;
  invoiceNumber: string | null;
  amountMinor: number | null;
  currency: string | null;
}

export type PaddleApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/** Whether Paddle server API calls can be made (active provider + api key set). */
export function paddleServerReady(cfg: ProviderConfig): boolean {
  return cfg.provider === 'paddle' && !!cfg.apiKey;
}

async function paddleFetch(
  cfg: ProviderConfig, pathAndQuery: string, init?: RequestInit,
): Promise<PaddleApiResult<unknown>> {
  if (!cfg.apiKey) {
    return { ok: false, status: 503, error: 'paddle_api_key_missing' };
  }
  let resp: Response;
  try {
    resp = await fetch(`${paddleApiBase(cfg.sandbox)}${pathAndQuery}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      // Never cache a per-user billing response.
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 502, error: 'paddle_unreachable' };
  }
  let json: unknown = null;
  try { json = await resp.json(); } catch { json = null; }
  if (!resp.ok) {
    const detail = (json as { error?: { detail?: string; code?: string } } | null)?.error;
    return { ok: false, status: resp.status, error: detail?.code ?? detail?.detail ?? `paddle_http_${resp.status}` };
  }
  return { ok: true, data: (json as { data?: unknown } | null)?.data ?? null };
}

function asRecord(v: unknown): Record<string, unknown> {
  return (v && typeof v === 'object') ? v as Record<string, unknown> : {};
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** The first item's price id + billing interval, used for upgrade/downgrade. */
function firstItemPrice(items: unknown): { priceId: string | null; interval: 'monthly' | 'annual' | null } {
  const arr = Array.isArray(items) ? items : [];
  const it = asRecord(arr[0]);
  const price = asRecord(it.price);
  const cycle = asRecord(price.billing_cycle);
  const unit = str(cycle.interval);
  const interval = unit === 'year' ? 'annual' : unit === 'month' ? 'monthly' : null;
  return { priceId: str(price.id), interval };
}

/** Sum the recurring amount from a subscription's items (unit_price x quantity),
 *  in minor units. Robust to a missing field (returns null). */
function recurringAmountMinor(items: unknown): { amountMinor: number | null; currency: string | null } {
  const arr = Array.isArray(items) ? items : [];
  let total = 0;
  let currency: string | null = null;
  let sawAny = false;
  for (const raw of arr) {
    const it = asRecord(raw);
    const price = asRecord(it.price);
    const unit = asRecord(price.unit_price);
    const amt = Number(unit.amount);
    const qty = Number(it.quantity ?? 1);
    if (Number.isFinite(amt)) {
      total += amt * (Number.isFinite(qty) ? qty : 1);
      sawAny = true;
      currency = str(unit.currency_code) ?? currency;
    }
  }
  return { amountMinor: sawAny ? total : null, currency };
}

/** Shape a raw Paddle subscription object into the client-safe summary. Shared
 *  by get / cancel / change-plan so the normalization lives in one place.
 *  `forceCanceled` is set on the cancel path (the response already reflects the
 *  scheduled cancel, but we also fall back to period end as the access-ends date). */
function shapeSummary(subscriptionId: string, data: unknown, forceCanceled = false): SubscriptionSummary {
  const d = asRecord(data);
  const scheduled = asRecord(d.scheduled_change);
  const period = asRecord(d.current_billing_period);
  const mgmt = asRecord(d.management_urls);
  const { amountMinor, currency } = recurringAmountMinor(d.items);
  const { priceId, interval } = firstItemPrice(d.items);
  const scheduledCancelAt = str(scheduled.action) === 'cancel' ? str(scheduled.effective_at) : null;
  const status = str(d.status) ?? 'unknown';
  return {
    subscriptionId,
    status,
    nextBilledAt: str(d.next_billed_at),
    currentPeriodEndsAt: str(period.ends_at),
    amountMinor,
    currency: str(d.currency_code) ?? currency,
    scheduledCancelAt: forceCanceled ? (scheduledCancelAt ?? str(period.ends_at)) : scheduledCancelAt,
    canceled: forceCanceled || status === 'canceled' || scheduledCancelAt !== null,
    updatePaymentMethodUrl: str(mgmt.update_payment_method),
    currentPriceId: priceId,
    billingInterval: interval,
  };
}

/** GET /subscriptions/{id} -> normalized summary (client-safe). */
export async function getSubscription(cfg: ProviderConfig, subscriptionId: string): Promise<PaddleApiResult<SubscriptionSummary>> {
  const res = await paddleFetch(cfg, `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  if (!res.ok) return res;
  return { ok: true, data: shapeSummary(subscriptionId, res.data) };
}

/** POST /subscriptions/{id}/cancel with effective_from=next_billing_period, so
 *  the user keeps access until the period they paid for ends. Returns the
 *  refreshed summary (now carrying scheduledCancelAt). */
export async function cancelSubscriptionAtPeriodEnd(
  cfg: ProviderConfig, subscriptionId: string,
): Promise<PaddleApiResult<SubscriptionSummary>> {
  const res = await paddleFetch(cfg, `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ effective_from: 'next_billing_period' }),
  });
  if (!res.ok) return res;
  // The cancel response IS the updated subscription; re-shape it (forceCanceled
  // so the access-ends date falls back to the current period end).
  return { ok: true, data: shapeSummary(subscriptionId, res.data, true) };
}

/**
 * Change a subscription's plan (upgrade / downgrade) by swapping its item to a
 * new price id. PATCH /subscriptions/{id} with proration. Default proration mode
 * 'prorated_immediately' charges/credits the difference now and applies the new
 * plan immediately; the subscription.updated webhook then syncs the app plan.
 * Returns the refreshed summary.
 */
export async function changeSubscriptionPlan(
  cfg: ProviderConfig, subscriptionId: string, newPriceId: string,
  prorationMode: 'prorated_immediately' | 'full_next_billing_period' = 'prorated_immediately',
): Promise<PaddleApiResult<SubscriptionSummary>> {
  const res = await paddleFetch(cfg, `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      items: [{ price_id: newPriceId, quantity: 1 }],
      proration_billing_mode: prorationMode,
    }),
  });
  if (!res.ok) return res;
  return { ok: true, data: shapeSummary(subscriptionId, res.data) };
}

/** GET /transactions?subscription_id=... -> invoice/receipt rows (newest first). */
export async function listSubscriptionInvoices(
  cfg: ProviderConfig, subscriptionId: string,
): Promise<PaddleApiResult<InvoiceSummary[]>> {
  const q = `/transactions?subscription_id=${encodeURIComponent(subscriptionId)}&order_by=billed_at[DESC]&per_page=30`;
  const res = await paddleFetch(cfg, q);
  if (!res.ok) return res;
  const rows = Array.isArray(res.data) ? res.data : [];
  const invoices: InvoiceSummary[] = rows.map((raw) => {
    const t = asRecord(raw);
    const totals = asRecord(asRecord(t.details).totals);
    return {
      transactionId: str(t.id) ?? '',
      status: str(t.status) ?? 'unknown',
      billedAt: str(t.billed_at) ?? str(t.created_at),
      invoiceNumber: str(t.invoice_number),
      amountMinor: Number.isFinite(Number(totals.grand_total)) ? Number(totals.grand_total) : null,
      currency: str(t.currency_code),
    };
  }).filter((i) => i.transactionId);
  return { ok: true, data: invoices };
}

/** GET /transactions/{id}/invoice -> a signed, time-limited Paddle-hosted PDF
 *  URL. Server fetches it so the API key stays server-side; the client is then
 *  redirected to the URL. */
export async function getInvoicePdfUrl(
  cfg: ProviderConfig, transactionId: string,
): Promise<PaddleApiResult<string>> {
  const res = await paddleFetch(cfg, `/transactions/${encodeURIComponent(transactionId)}/invoice`);
  if (!res.ok) return res;
  const url = str(asRecord(res.data).url);
  if (!url) return { ok: false, status: 404, error: 'invoice_not_available' };
  return { ok: true, data: url };
}

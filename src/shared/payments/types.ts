/**
 * payments/types.ts
 *
 * The ONE internal interface for payment checkout + webhook handling, shared by
 * every provider adapter. Adding a provider means writing an adapter to this
 * shape and registering it (registry.ts); nothing else in the system changes.
 *
 * Both current adapters (Paddle, PayPro) are STUBS: they implement the shape but
 * make no live API calls. `implemented` is false on a stub, and checkout returns
 * a safe not-configured result. The webhook signature-verification primitive is
 * real (HMAC), so the verification code path is exercised even while stubbed.
 *
 * No em dashes in this file.
 */

export type PaymentProvider = 'paddle' | 'paypro';
export type ActiveProvider = 'none' | PaymentProvider;
export type BillingInterval = 'monthly' | 'annual';

/** Resolved server-side credentials for one provider (never sent to a client).
 *  NOTE: `clientToken` is the ONE publishable value here. It is Paddle's
 *  client-side token (sandbox tokens start with `test_`), safe to hand to the
 *  browser so Paddle.js can open the hosted checkout. apiKey / apiSecret /
 *  webhookSecret are secrets and never leave the server. */
export interface ProviderConfig {
  provider: PaymentProvider;
  apiKey: string | null;
  apiSecret: string | null;
  webhookSecret: string | null;
  /** Publishable client-side token (Paddle.js). Null for providers without one. */
  clientToken: string | null;
  sandbox: boolean;
}

export interface CheckoutRequest {
  planKey: string;
  interval: BillingInterval;
  /** The provider price / product id for this plan (from the plan record). */
  providerPriceId: string | null;
  userId: string;
  userEmail: string | null;
  /** The platform this checkout is for. Passed through to the provider as custom
   *  data so the webhook can key the subscription PER platform. */
  platform: string;
}

/** A checkout outcome.
 *  - 'placeholder'     provider none (UI shows the coming-soon placeholder)
 *  - 'not_configured'  provider active but its adapter is a stub
 *  - 'error'           a graceful, non-crashing failure (e.g. missing price id)
 *  - 'redirect'        provider-hosted checkout URL to navigate to
 *  - 'open_overlay'    the browser must open an in-page overlay checkout
 *                      (Paddle.js). Carries the publishable client token + the
 *                      price id + sandbox flag + custom data, NO secrets. */
export interface CheckoutResult {
  ok: boolean;
  status: 'placeholder' | 'not_configured' | 'redirect' | 'open_overlay' | 'error';
  /** Provider-hosted checkout URL, only on a live 'redirect' result. */
  url?: string;
  message: string;
  // ── 'open_overlay' payload (Paddle.js). All client-safe; no secrets. ──
  provider?: PaymentProvider;
  /** Publishable client-side token for Paddle.js initialization. */
  clientToken?: string;
  /** The provider price id the overlay should open. */
  priceId?: string;
  /** Use the provider sandbox environment in the browser. */
  sandbox?: boolean;
  /** Customer email to prefill (optional). */
  email?: string | null;
  /** Passthrough mapped back by the webhook (user_id + plan_key). */
  customData?: Record<string, string>;
}

export interface WebhookVerifyResult {
  valid: boolean;
  reason?: string;
}

export type SubscriptionEventType = 'activated' | 'updated' | 'cancelled' | 'unknown';

/** Provider-neutral subscription event after an adapter parses a raw webhook. */
export interface ParsedSubscriptionEvent {
  type: SubscriptionEventType;
  /** Provider event id (e.g. Paddle `evt_...`), used for webhook idempotency. */
  eventId: string | null;
  /** The provider price/product id the event refers to; mapped back to a plan. */
  providerPriceOrProductId: string | null;
  /** Internal user reference passed at checkout via custom data (preferred user
   *  mapping). Null when absent. */
  userRef: string | null;
  /** Plan key passed at checkout via custom data (fallback plan mapping). */
  customDataPlanKey: string | null;
  /** The customer email the event refers to; fallback user mapping. */
  customerEmail: string | null;
  /** Provider subscription id (Paddle `sub_...`). Stored on the user so the
   *  dashboard can manage the subscription via the provider API. Null when the
   *  event carries no subscription (e.g. a one-off transaction). */
  subscriptionId: string | null;
  /** Provider customer id (Paddle `ctm_...`). Stored alongside the subscription
   *  id for provider API calls scoped to the customer. */
  customerId: string | null;
  /** Platform slug passed at checkout via custom data, so the subscription is
   *  keyed PER platform. Null when absent (callers default to real-estate). */
  customDataPlatform: string | null;
  /** The provider TRANSACTION id (Paddle `txn_...`) on a transaction.completed
   *  event, for the reconcilable revenue ledger. Null otherwise. */
  transactionId: string | null;
  /** The transaction total in minor units (revenue ledger). Null when absent. */
  transactionAmountMinor: number | null;
  /** The transaction currency code (revenue ledger). Null when absent. */
  transactionCurrency: string | null;
  /** On a subscription.updated event, the scheduled-cancel date when a
   *  cancel-at-period-end is pending (data.scheduled_change.action === 'cancel'),
   *  else null. Lets the webhook persist the durable Canceling marker (mig 183)
   *  so the admin views reflect a cancel scheduled directly in Paddle. */
  scheduledCancelAt: string | null;
}

export interface PaymentAdapter {
  readonly provider: PaymentProvider;
  /** False while this is a stub. The webhook + checkout handlers branch on this
   *  so a stub never pretends to process a live event. */
  readonly implemented: boolean;
  /** Start a checkout for a plan. Stubs return a safe not-configured result. */
  createCheckout(req: CheckoutRequest, cfg: ProviderConfig): Promise<CheckoutResult>;
  /** Verify a raw webhook body against the stored webhook secret (real HMAC). */
  verifyWebhook(rawBody: string, signature: string | null, cfg: ProviderConfig): WebhookVerifyResult;
  /** Parse a raw webhook body into a provider-neutral event. Stubs return
   *  type 'unknown' so the live plan-setting path is not taken yet. */
  parseEvent(rawBody: string): ParsedSubscriptionEvent;
}

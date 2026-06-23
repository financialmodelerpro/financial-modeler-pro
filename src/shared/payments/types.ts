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

/** Resolved server-side credentials for one provider (never sent to a client). */
export interface ProviderConfig {
  provider: PaymentProvider;
  apiKey: string | null;
  apiSecret: string | null;
  webhookSecret: string | null;
  sandbox: boolean;
}

export interface CheckoutRequest {
  planKey: string;
  interval: BillingInterval;
  /** The provider price / product id for this plan (from the plan record). */
  providerPriceId: string | null;
  userId: string;
  userEmail: string | null;
}

/** A checkout outcome. With every adapter stubbed today, the result is always
 *  'placeholder' (provider none) or 'not_configured' (provider active but the
 *  adapter is not implemented). 'redirect' is the shape a live adapter returns. */
export interface CheckoutResult {
  ok: boolean;
  status: 'placeholder' | 'not_configured' | 'redirect' | 'error';
  /** Provider-hosted checkout URL, only on a live 'redirect' result. */
  url?: string;
  message: string;
}

export interface WebhookVerifyResult {
  valid: boolean;
  reason?: string;
}

export type SubscriptionEventType = 'activated' | 'updated' | 'cancelled' | 'unknown';

/** Provider-neutral subscription event after an adapter parses a raw webhook. */
export interface ParsedSubscriptionEvent {
  type: SubscriptionEventType;
  /** The provider price/product id the event refers to; mapped back to a plan. */
  providerPriceOrProductId: string | null;
  /** The customer email the event refers to; mapped to the internal user. */
  customerEmail: string | null;
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

/**
 * payments/adapters/paddle.ts
 *
 * Paddle adapter. STUB: implements the PaymentAdapter shape but makes NO live
 * Paddle API calls. `implemented = false`, checkout returns a safe
 * not-configured result, and parseEvent returns 'unknown' so the webhook never
 * takes the live plan-setting path yet. The signature primitive is real.
 *
 * To go live later, only this file changes: implement createCheckout (create a
 * Paddle transaction / checkout for `providerPriceId`) and parseEvent (map a
 * Paddle subscription event to the neutral shape). The rest of the system
 * (registry, checkout route, webhook route) is untouched.
 *
 * No em dashes in this file.
 */
import type {
  PaymentAdapter, CheckoutRequest, CheckoutResult, ProviderConfig,
  WebhookVerifyResult, ParsedSubscriptionEvent,
} from '../types';
import { verifyHmacSignature } from '../signature';

export const paddleAdapter: PaymentAdapter = {
  provider: 'paddle',
  implemented: false,

  async createCheckout(_req: CheckoutRequest, _cfg: ProviderConfig): Promise<CheckoutResult> {
    // STUB: no Paddle transaction is created. Returning not_configured keeps the
    // checkout a placeholder (no fake checkout, no charge).
    return {
      ok: false,
      status: 'not_configured',
      message: 'Paddle is selected but the Paddle adapter is not implemented yet. No checkout was started and no charge was made.',
    };
  },

  verifyWebhook(rawBody: string, signature: string | null, cfg: ProviderConfig): WebhookVerifyResult {
    // Real HMAC verification against the stored webhook secret. NOTE: Paddle's
    // production signature header (Paddle-Signature: ts=...;h1=...) must be
    // parsed per Paddle docs when this adapter is implemented.
    return verifyHmacSignature(rawBody, signature, cfg.webhookSecret);
  },

  parseEvent(_rawBody: string): ParsedSubscriptionEvent {
    // STUB: a real implementation maps subscription.activated / .updated /
    // .canceled to the neutral type and pulls the price id + customer email.
    return { type: 'unknown', providerPriceOrProductId: null, customerEmail: null };
  },
};

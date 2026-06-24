/**
 * payments/adapters/paypro.ts
 *
 * PayPro adapter. STUB: implements the PaymentAdapter shape but makes NO live
 * PayPro API calls. `implemented = false`, checkout returns a safe
 * not-configured result, and parseEvent returns 'unknown' so the webhook never
 * takes the live plan-setting path yet. The signature primitive is real.
 *
 * To go live later, only this file changes: implement createCheckout (create a
 * PayPro order / checkout for `providerPriceId`) and parseEvent (map a PayPro
 * subscription notification to the neutral shape). The rest of the system is
 * untouched.
 *
 * No em dashes in this file.
 */
import type {
  PaymentAdapter, CheckoutRequest, CheckoutResult, ProviderConfig,
  WebhookVerifyResult, ParsedSubscriptionEvent,
} from '../types';
import { verifyHmacSignature } from '../signature';

export const payproAdapter: PaymentAdapter = {
  provider: 'paypro',
  implemented: false,

  async createCheckout(_req: CheckoutRequest, _cfg: ProviderConfig): Promise<CheckoutResult> {
    // STUB: no PayPro order is created. Returning not_configured keeps the
    // checkout a placeholder (no fake checkout, no charge).
    return {
      ok: false,
      status: 'not_configured',
      message: 'PayPro is selected but the PayPro adapter is not implemented yet. No checkout was started and no charge was made.',
    };
  },

  verifyWebhook(rawBody: string, signature: string | null, cfg: ProviderConfig): WebhookVerifyResult {
    // Real HMAC verification against the stored webhook secret. NOTE: PayPro's
    // production notification signature scheme must be confirmed against PayPro
    // docs when this adapter is implemented.
    return verifyHmacSignature(rawBody, signature, cfg.webhookSecret);
  },

  parseEvent(_rawBody: string): ParsedSubscriptionEvent {
    // STUB: a real implementation maps PayPro subscription lifecycle events to
    // the neutral type and pulls the product id + customer email.
    return { type: 'unknown', eventId: null, providerPriceOrProductId: null, userRef: null, customDataPlanKey: null, customerEmail: null };
  },
};

/**
 * payments/adapters/paddle.ts
 *
 * Paddle (Paddle Billing) adapter. IMPLEMENTED in sandbox-capable form:
 *
 *  - createCheckout returns an 'open_overlay' instruction the browser uses to
 *    open Paddle.js hosted checkout for the plan's price id. It carries ONLY the
 *    publishable client-side token (never a secret) plus the price id, the
 *    sandbox flag, and custom data (user_id + plan_key) so the webhook can map
 *    the purchase back to the user. No server-side Paddle API call is made here
 *    (overlay checkout is opened client-side), so no live/secret key is used.
 *
 *  - verifyWebhook verifies the Paddle-Signature header per Paddle docs: the
 *    signed payload is `${ts}:${rawBody}` HMAC-SHA256 under the notification
 *    destination secret key, compared in constant time to h1.
 *
 *  - parseEvent maps Paddle Billing events to the neutral shape:
 *      transaction.completed / subscription.created / subscription.activated -> activated
 *      subscription.updated                                                   -> updated
 *      subscription.canceled                                                  -> cancelled
 *    It pulls the event id (idempotency), the first item's price id, the
 *    custom_data user_id + plan_key, and any customer email. It NEVER throws:
 *    malformed input returns type 'unknown'.
 *
 * Sandbox vs live is driven by cfg.sandbox: the browser sets the Paddle sandbox
 * environment when true. No live production endpoints or keys are used while in
 * sandbox mode.
 *
 * No em dashes in this file.
 */
import type {
  PaymentAdapter, CheckoutRequest, CheckoutResult, ProviderConfig,
  WebhookVerifyResult, ParsedSubscriptionEvent, SubscriptionEventType,
} from '../types';
import { verifyPaddleSignature } from '../signature';

// Paddle Billing event_type -> neutral subscription event type.
function mapEventType(eventType: string): SubscriptionEventType {
  switch (eventType) {
    case 'transaction.completed':
    case 'subscription.created':
    case 'subscription.activated':
      return 'activated';
    case 'subscription.updated':
      return 'updated';
    case 'subscription.canceled':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

// Pull the first item's price id from a Paddle event data object.
function firstPriceId(data: Record<string, unknown> | undefined): string | null {
  const items = (data?.items as Array<Record<string, unknown>> | undefined) ?? [];
  for (const it of items) {
    const price = it?.price as Record<string, unknown> | undefined;
    const id = (price?.id ?? it?.price_id) as string | undefined;
    if (id) return id;
  }
  return null;
}

export const paddleAdapter: PaymentAdapter = {
  provider: 'paddle',
  implemented: true,

  async createCheckout(req: CheckoutRequest, cfg: ProviderConfig): Promise<CheckoutResult> {
    // The publishable client-side token is required to open Paddle.js. Fail
    // gracefully (no crash) if it is missing.
    if (!cfg.clientToken) {
      return {
        ok: false,
        status: 'error',
        message: 'Paddle is selected but no client-side token is configured. Add the Paddle client-side token in Admin > Payments.',
      };
    }
    // A missing price id for this plan/interval is a graceful failure.
    if (!req.providerPriceId) {
      return {
        ok: false,
        status: 'error',
        message: 'This plan does not have a Paddle price id for the selected billing interval yet. Set the Paddle price IDs in the Plan Builder.',
      };
    }
    // Hand the browser exactly what Paddle.js needs (all client-safe). The
    // webhook maps the purchase back via custom_data.user_id + plan_key.
    return {
      ok: true,
      status: 'open_overlay',
      provider: 'paddle',
      clientToken: cfg.clientToken,
      priceId: req.providerPriceId,
      sandbox: cfg.sandbox,
      email: req.userEmail,
      customData: { user_id: req.userId, plan_key: req.planKey },
      message: 'Opening Paddle checkout.',
    };
  },

  verifyWebhook(rawBody: string, signature: string | null, cfg: ProviderConfig): WebhookVerifyResult {
    // Paddle scheme: HMAC-SHA256 over `${ts}:${rawBody}` under the notification
    // destination secret. A 5-minute timestamp tolerance gives signature-layer
    // replay protection; the webhook route's idempotency table is the definitive
    // guard against re-applying a duplicate event.
    return verifyPaddleSignature(rawBody, signature, cfg.webhookSecret, 300);
  },

  parseEvent(rawBody: string): ParsedSubscriptionEvent {
    const empty: ParsedSubscriptionEvent = {
      type: 'unknown', eventId: null, providerPriceOrProductId: null,
      userRef: null, customDataPlanKey: null, customerEmail: null,
    };
    try {
      const body = JSON.parse(rawBody) as Record<string, unknown>;
      const eventType = String(body.event_type ?? '');
      const eventId = (body.event_id as string | undefined) ?? null;
      const data = body.data as Record<string, unknown> | undefined;
      const custom = (data?.custom_data as Record<string, unknown> | undefined) ?? {};
      const customer = data?.customer as Record<string, unknown> | undefined;
      const email = (customer?.email as string | undefined)
        ?? (data?.customer_email as string | undefined)
        ?? null;
      return {
        type: mapEventType(eventType),
        eventId,
        providerPriceOrProductId: firstPriceId(data),
        userRef: (custom.user_id as string | undefined) ?? null,
        customDataPlanKey: (custom.plan_key as string | undefined) ?? null,
        customerEmail: email,
      };
    } catch {
      // Malformed body: never throw, the route stops on type 'unknown'.
      return empty;
    }
  },
};

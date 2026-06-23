/**
 * payments/registry.ts
 *
 * The single place that maps a provider key to its adapter. The checkout route
 * and the webhook route resolve the active adapter through here, so adding a
 * provider is: write an adapter + add one line here.
 *
 * No em dashes in this file.
 */
import type { PaymentAdapter, PaymentProvider } from './types';
import { paddleAdapter } from './adapters/paddle';
import { payproAdapter } from './adapters/paypro';

const ADAPTERS: Record<PaymentProvider, PaymentAdapter> = {
  paddle: paddleAdapter,
  paypro: payproAdapter,
};

export const PAYMENT_PROVIDERS: PaymentProvider[] = ['paddle', 'paypro'];

export function getAdapter(provider: PaymentProvider): PaymentAdapter {
  return ADAPTERS[provider];
}

/** All adapters (used by the structure verifier + admin status display). */
export function allAdapters(): PaymentAdapter[] {
  return PAYMENT_PROVIDERS.map((p) => ADAPTERS[p]);
}

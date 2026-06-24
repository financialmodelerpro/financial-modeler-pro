import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadPaymentSettings, maskPaymentSettings } from '@/src/shared/payments/config';
import type { ActiveProvider, PaymentProvider } from '@/src/shared/payments/types';

// Admin payment config API. Reads/writes the payment_settings row (mig 167).
//
// GET  returns the MASKED view only (booleans for "secret is set"), never the
//      raw secret values, so secrets never reach the client.
// PATCH writes the active provider, sandbox flags, and secrets. Secrets are
//      WRITE-ONLY: a blank field leaves the stored secret unchanged (so the
//      masked UI never has to round-trip a secret to update other fields).

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

const PLATFORM = 'real-estate';

export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = getServerClient();
  const row = await loadPaymentSettings(sb, PLATFORM);
  return NextResponse.json({ config: maskPaymentSettings(row) });
}

const PROVIDERS: PaymentProvider[] = ['paddle', 'paypro'];

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json() as {
      active_provider?: ActiveProvider;
      paddle?: { api_key?: string; api_secret?: string; webhook_secret?: string; client_token?: string; sandbox?: boolean };
      paypro?: { api_key?: string; api_secret?: string; webhook_secret?: string; sandbox?: boolean };
    };

    const updates: Record<string, unknown> = { platform_slug: PLATFORM, updated_at: new Date().toISOString() };

    if (body.active_provider !== undefined) {
      const ap = String(body.active_provider);
      if (!['none', 'paddle', 'paypro'].includes(ap)) {
        return NextResponse.json({ error: 'Invalid active_provider' }, { status: 400 });
      }
      updates.active_provider = ap;
    }

    for (const provider of PROVIDERS) {
      const p = body[provider];
      if (!p) continue;
      // Secrets are write-only: only overwrite when a non-empty value is sent.
      if (typeof p.api_key === 'string' && p.api_key.trim() !== '') updates[`${provider}_api_key`] = p.api_key.trim();
      if (typeof p.api_secret === 'string' && p.api_secret.trim() !== '') updates[`${provider}_api_secret`] = p.api_secret.trim();
      if (typeof p.webhook_secret === 'string' && p.webhook_secret.trim() !== '') updates[`${provider}_webhook_secret`] = p.webhook_secret.trim();
      if (typeof p.sandbox === 'boolean') updates[`${provider}_sandbox`] = p.sandbox;
    }
    // Paddle client token is publishable (shown in the UI): a blank value clears
    // it; a value replaces it. Only paddle has this column (mig 170).
    if (body.paddle && typeof body.paddle.client_token === 'string') {
      updates.paddle_client_token = body.paddle.client_token.trim() === '' ? null : body.paddle.client_token.trim();
    }

    const sb = getServerClient();
    let { error } = await sb.from('payment_settings').upsert(updates, { onConflict: 'platform_slug' });
    // Schema-tolerant: if mig 170 (paddle_client_token) is not applied yet, retry
    // without that column so the rest of the config still saves.
    if (error && /paddle_client_token/.test(error.message)) {
      const rest = { ...updates }; delete (rest as Record<string, unknown>).paddle_client_token;
      ({ error } = await sb.from('payment_settings').upsert(rest, { onConflict: 'platform_slug' }));
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Return the fresh masked view so the UI updates its "set" indicators.
    const row = await loadPaymentSettings(sb, PLATFORM);
    return NextResponse.json({ ok: true, config: maskPaymentSettings(row) });
  } catch {
    return NextResponse.json({ error: 'Failed to save payment config' }, { status: 500 });
  }
}

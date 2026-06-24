/* eslint-disable no-console */
/**
 * simulate-paddle-webhook.ts (founder test tool, manual)
 *
 * Sends a correctly-SIGNED synthetic Paddle Billing webhook to the real webhook
 * route so the founder can prove, WITHOUT a card: signature verification, the
 * shared setUserPlan apply, idempotency (run twice), and cancel -> baseline.
 *
 * It reads the stored paddle_webhook_secret from payment_settings (so the
 * signature matches what the route verifies) and signs `${ts}:${body}` exactly
 * like Paddle. It does NOT call Paddle; it only posts to your own endpoint.
 *
 * Requires: mig 170 + 171 applied, active_provider = paddle in /admin/payments,
 * the webhook secret set, and a real test user id. The plan key must exist and
 * carry a Paddle price id (or pass --price to map by price id).
 *
 * Usage (PowerShell), against local or prod:
 *   npx tsx scripts/simulate-paddle-webhook.ts --user <USER_UUID> --plan pro --url http://localhost:3000
 *   npx tsx scripts/simulate-paddle-webhook.ts --user <USER_UUID> --plan pro --url https://app.financialmodelerpro.com
 *   add --cancel to send subscription.canceled (drops to baseline)
 *   run the SAME command twice to prove idempotency (2nd -> skipped:true)
 *
 * No em dashes in this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

async function main() {
  const userId = arg('user');
  const planKey = arg('plan', 'pro');
  const base = arg('url', 'http://localhost:3000').replace(/\/$/, '');
  const priceId = arg('price', 'pri_simulated');
  const cancel = has('cancel');
  const eventId = arg('event-id', `evt_sim_${crypto.randomBytes(6).toString('hex')}`);
  if (!userId) { console.error('Missing --user <USER_UUID>'); process.exit(2); }

  const { getServerClient } = await import('../src/core/db/supabase');
  const sb = getServerClient();
  const { loadPaymentSettings } = await import('../src/shared/payments/config');
  const settings = await loadPaymentSettings(sb, 'real-estate');
  if (settings.active_provider !== 'paddle') console.warn(`WARNING: active_provider is "${settings.active_provider}", route will reject unless it is "paddle".`);
  const secret = settings.paddle_webhook_secret;
  if (!secret) { console.error('No paddle_webhook_secret stored. Set it in /admin/payments first.'); process.exit(2); }

  const body = JSON.stringify({
    event_id: eventId,
    event_type: cancel ? 'subscription.canceled' : 'subscription.activated',
    occurred_at: new Date().toISOString(),
    data: {
      id: 'sub_simulated',
      items: [{ price: { id: priceId } }],
      custom_data: { user_id: userId, plan_key: planKey },
      customer: {},
    },
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const h1 = crypto.createHmac('sha256', secret).update(`${ts}:${body}`, 'utf8').digest('hex');

  const url = `${base}/api/payments/webhook/paddle`;
  console.log(`POST ${url}\n  event_type=${cancel ? 'subscription.canceled' : 'subscription.activated'} event_id=${eventId} user=${userId} plan=${planKey}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Paddle-Signature': `ts=${ts};h1=${h1}` },
    body,
  });
  console.log(`HTTP ${res.status}:`, await res.text());
  console.log('Tip: run the SAME command again to confirm idempotency (skipped:true).');
}
main().catch((e) => { console.error(e); process.exit(1); });

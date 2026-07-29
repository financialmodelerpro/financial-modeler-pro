/**
 * scripts/diagnose_price_parity.ts
 *
 * READ-ONLY. Now that price.read works, compare what the pricing page DISPLAYS
 * (entitlement_plans.price_monthly / price_annual / currency) against what LIVE
 * Paddle will actually CHARGE for the linked price id. A mismatch means the user
 * is quoted one number and billed another.
 *
 * GETs + SELECTs only. Nothing written.
 *
 * Usage: npx tsx --env-file=.env.local scripts/diagnose_price_parity.ts
 */

import { getServerClient } from '../src/core/db/supabase';
import { loadPaymentSettings, providerConfigFrom } from '../src/shared/payments/config';
import { paddleApiBase } from '../src/shared/payments/paddleApi';

async function get(base: string, apiKey: string, path: string): Promise<{ status: number; json: any }> {
  const resp = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  let json: any = null;
  try { json = await resp.json(); } catch { json = null; }
  return { status: resp.status, json };
}

async function main() {
  const sb = getServerClient();
  const row = await loadPaymentSettings(sb, 'real-estate');
  const cfg = providerConfigFrom(row, 'paddle');
  const key = cfg.apiKey ?? '';
  const base = paddleApiBase(cfg.sandbox);
  if (!key) { console.log('no key'); return; }

  const { data: plans } = await sb
    .from('entitlement_plans')
    .select('plan_key, label, active, price_monthly, price_annual, currency, paddle_price_id_monthly, paddle_price_id_annual')
    .eq('platform_slug', 'real-estate')
    .order('display_order');

  console.log(`Comparing catalog price vs LIVE Paddle price (${base})\n`);
  console.log('plan     interval  catalog        paddle          match  price id');
  for (const p of (plans ?? []) as any[]) {
    for (const interval of ['monthly', 'annual'] as const) {
      const id = interval === 'monthly' ? p.paddle_price_id_monthly : p.paddle_price_id_annual;
      const catalog = interval === 'monthly' ? p.price_monthly : p.price_annual;
      if (!id) {
        console.log(`${String(p.plan_key).padEnd(8)} ${interval.padEnd(9)} ${String(catalog ?? '-').padEnd(14)} ${'(no price id)'.padEnd(15)} -`);
        continue;
      }
      const r = await get(base, key, `/prices/${id}`);
      if (r.status !== 200) {
        console.log(`${String(p.plan_key).padEnd(8)} ${interval.padEnd(9)} ${String(catalog ?? '-').padEnd(14)} HTTP ${r.status}`);
        continue;
      }
      const d = r.json?.data ?? {};
      const amountMinor = Number(d.unit_price?.amount);
      const cur = d.unit_price?.currency_code;
      const paddleMajor = Number.isFinite(amountMinor) ? amountMinor / 100 : NaN;
      const cyc = d.billing_cycle ? `${d.billing_cycle.frequency}/${d.billing_cycle.interval}` : 'one-off';
      const catNum = catalog === null || catalog === undefined ? NaN : Number(catalog);
      const match = Number.isFinite(catNum) && Math.abs(catNum - paddleMajor) < 0.005 ? 'YES' : 'NO';
      console.log(
        `${String(p.plan_key).padEnd(8)} ${interval.padEnd(9)} ` +
        `${`${catNum || '-'} ${p.currency ?? ''}`.padEnd(14)} ` +
        `${`${paddleMajor} ${cur}`.padEnd(15)} ` +
        `${match.padEnd(6)} ${id}  [${d.name ?? '-'}] cycle=${cyc} status=${d.status}`,
      );
    }
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });

/**
 * GET /api/cron/auto-launch-check
 *
 * Called by Vercel cron (see vercel.json — `*​/5 * * * *`). Secured by the
 * CRON_SECRET Authorization header, same pattern as /api/cron/certificates.
 *
 * For each hub (training + modeling) it reads the four settings keys:
 *   {hub}_coming_soon                — current toggle
 *   {hub}_launch_date                — scheduled launch ISO timestamp
 *   {hub}_auto_launch                — admin opt-in for auto-flip
 *   {hub}_last_auto_launched_at      — audit timestamp of the last firing
 *
 * Fires when coming_soon==='true' AND auto_launch==='true' AND launch_date
 * is set AND launch_date <= now. On firing:
 *   - coming_soon        → 'false'    (the actual launch)
 *   - auto_launch        → 'false'    (one-shot; admin re-opts-in manually)
 *   - last_auto_launched_at → now ISO (audit + UI readout)
 *
 * Safety invariants:
 *   - Never turns coming_soon ON — launches are one-way.
 *   - Never touches a hub that isn't opted into auto_launch.
 *   - Manual toggle via /admin remains authoritative and works any time,
 *     even if the cron is broken.
 *   - Idempotent: rerunning after a fire is a no-op (coming_soon is already
 *     false, so the guard short-circuits).
 */

import { NextRequest } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface HubSpec {
  label:            string;
  comingSoonKey:    string;
  launchDateKey:    string;
  autoLaunchKey:    string;
  lastLaunchedKey:  string;
}

const HUBS: HubSpec[] = [
  {
    label:           'training',
    comingSoonKey:   'training_hub_coming_soon',
    launchDateKey:   'training_hub_launch_date',
    autoLaunchKey:   'training_hub_auto_launch',
    lastLaunchedKey: 'training_hub_last_auto_launched_at',
  },
  {
    label:           'modeling',
    comingSoonKey:   'modeling_hub_coming_soon',
    launchDateKey:   'modeling_hub_launch_date',
    autoLaunchKey:   'modeling_hub_auto_launch',
    lastLaunchedKey: 'modeling_hub_last_auto_launched_at',
  },
];

interface FireResult {
  hub:        string;
  launched:   boolean;
  reason?:    string;
  launchDate?: string;
  firedAt?:   string;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getServerClient();
  const allKeys = HUBS.flatMap(h => [h.comingSoonKey, h.launchDateKey, h.autoLaunchKey, h.lastLaunchedKey]);

  try {
    const { data, error } = await sb
      .from('training_settings')
      .select('key,value')
      .in('key', allKeys);
    if (error) throw error;
    const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));

    const nowMs  = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const results: FireResult[] = [];

    for (const hub of HUBS) {
      const comingSoon = map.get(hub.comingSoonKey) === 'true';
      const autoLaunch = map.get(hub.autoLaunchKey) === 'true';
      const launchDate = (map.get(hub.launchDateKey) ?? '').trim();

      if (!comingSoon) { results.push({ hub: hub.label, launched: false, reason: 'already_live' }); continue; }
      if (!autoLaunch) { results.push({ hub: hub.label, launched: false, reason: 'auto_launch_off' }); continue; }
      if (!launchDate) { results.push({ hub: hub.label, launched: false, reason: 'no_launch_date' }); continue; }

      const launchMs = Date.parse(launchDate);
      if (!Number.isFinite(launchMs)) {
        results.push({ hub: hub.label, launched: false, reason: 'invalid_launch_date', launchDate });
        continue;
      }
      if (launchMs > nowMs) {
        results.push({ hub: hub.label, launched: false, reason: 'not_yet', launchDate });
        continue;
      }

      // All guards pass — flip the hub LIVE and record the audit timestamp.
      const upsertRows = [
        { key: hub.comingSoonKey,   value: 'false' },
        { key: hub.autoLaunchKey,   value: 'false' },
        { key: hub.lastLaunchedKey, value: nowIso },
      ];
      const { error: upErr } = await sb.from('training_settings').upsert(upsertRows, { onConflict: 'key' });
      if (upErr) {
        console.error(`[cron/auto-launch-check] ${hub.label} upsert failed:`, upErr.message);
        results.push({ hub: hub.label, launched: false, reason: `upsert_failed: ${upErr.message}`, launchDate });
        continue;
      }
      console.log(`[cron/auto-launch-check] AUTO-LAUNCHED hub=${hub.label} launchDate=${launchDate} firedAt=${nowIso}`);
      results.push({ hub: hub.label, launched: true, launchDate, firedAt: nowIso });
    }

    return Response.json({ ok: true, checkedAt: nowIso, results });
  } catch (e) {
    console.error('[cron/auto-launch-check]', e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
